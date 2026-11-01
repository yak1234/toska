# Custom effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When painting an effect fails, Toska builds a YAML effect recipe from tested blocks, keeps it on approval, and the painter uses it through one `paint_effect` tool; ships with fog and snow; off by default.

**Architecture:** Plugin: six numpy/OpenCV blocks (`effect_blocks.py`, no Qt) behind two operations, `effect` (paints one layer in the move's group, like `snow`) and `effect_preview` (renders a PNG from the canvas view, no document touched). Companion: strict TypeScript under `src/effects/` — recipe schema and expression reader, library loader, the `paint_effect` tool, the failure policy, and the build loop (worker writes candidates, Luna picks blind, card). Panel: the build card, the setting with Reset, Auto-approve's Keep.

**Tech Stack:** TypeScript (strict), TypeBox 1.3.27, `yaml` (pinned direct dependency), Pi SDK `@earendil-works/pi-coding-agent`, Python numpy + OpenCV (plugin), PyQt5/PyQt6 via `qt_compat` (panel).

**Spec:** `creative-agent/openspec/changes/custom-effects/proposal.md`

## Global Constraints

- Off by default: setting `custom_effects` (boolean, default false). Off: no `paint_effect`, no build, `paint_snow` unchanged; after the second failure of one effect the chat says once "As a last resort, enable Custom effects in Settings."
- No agent-written code ever runs: recipes are YAML only; values are numbers or arithmetic on the recipe's own options (numbers, option names, `+ - * /`, parentheses, `min`, `max`); no `eval`.
- Blocks: `particles`, `wash`, `noise`, `caps`, `rays`, `texture`. Each paints only the effect's own new layer, never inside keep-clear shapes (default `["faces", "hair"]`), sized from the canvas, coloured from the scene light.
- Hard caps the engine enforces whatever a recipe says: particles ≤ 60 000 per call, ≤ 3 depth layers, opacity ≤ 1, block count ≤ 8, render time per call ≤ 30 s on 6000 × 4500 (checked by test at that size).
- `cue` ≤ 160 characters, `lesson` ≤ 300, `evidence` ≤ 300; they reach the painter only quoted ("this effect is for: …").
- Build budget (`effects/policy.yaml`): ≤ 3 candidates, one retry per invalid candidate, one Luna choice, 4 minutes; one build at a time; candidates render at ≤ 1024 px long side via `effect_preview`; no Krita document is opened.
- Trigger: the same effect failed twice in a chat (the new Luna "effect met" decision says no, or a token effort, or the artist asks again for an effect the painter called done); an Undo alone does not count; never when a library effect's cue matches; never again in the chat after Discard unless `/new-effect`.
- Card `effect_build`: Keep / Try again / Discard; after Keep, Remove effect. Auto-approve presses Keep after `max(the artist's Auto-approve delay, 20)` seconds and marks `auto_kept: true`; nothing waits for the card (moves carry on).
- Last resort: one AI texture through `requestAssetImage` (assets.mjs) only when the chat's AI image allowance permits; otherwise the card says how to allow it.
- Folders: bundled `krita-creative-agent/effects/` (`fog.yaml`, `snow.yaml`, `policy.yaml`); the artist's own in `<data dir>/effects/` (storage-paths.mjs), never the painting's folder. Reset deletes only the artist's folder, after a confirmation.
- Repo rules: new modules strict TS; plugin Qt via `qt_compat`; tests clean up temp files; companion tests `npm run test:unit`; plugin tests `uv run -q --with pyqt5 --with pillow --with numpy --with httpx --with opencv-python-headless python -m unittest discover -s tests -p 'test_effect*.py'` from `krita-creative-agent`; no co-author lines in commits.

## Review Focus

1. A hand-written recipe with a typo (unknown block, bad key, option out of range, unbalanced expression): skipped with a message naming file and field; every other effect still loads and the chat goes on. → Task 3 test `a broken recipe is skipped with its file and field named`.
2. A recipe asking for absurd work (`count: "1e9"`, 50 blocks, a huge blur): clamped to the caps and said, never a hang. → Task 1 test `test_caps_hold_on_a_6000_canvas`, Task 3 test `values beyond the caps are clamped and said`.
3. A recipe whose cue contains instructions ("ignore the artist …"): shown to the painter only inside a quoted list. → Task 5 test `cues reach the painter quoted, never as instructions`.
4. Keep pressed while a move paints, or Remove effect after the effect was used: the library changes; the painting is not touched (Undo is separate). → Task 7 test `Keep and Remove change only the library`.
5. Two builds for one effect, or a build in Autopilot without Auto-approve: never two at once; without Auto-approve the card waits and painting goes on. → Task 6 test `one build at a time`, Task 7 test `nothing waits for the card`.

---

### Task 1: The blocks (plugin, pure numpy)

**Files:**
- Create: `krita-mcp/krita-plugin/kritamcp/effect_blocks.py`
- Test: `krita-creative-agent/tests/test_effect_blocks.py`

**Interfaces:**
- Consumes: `snow_raster.scene_light(canvas)`, `snow_raster.plan_flakes`, `snow_raster.render_layer`, `snow_raster.settled`, `snow_raster.clear_weight` (reuse, do not copy).
- Produces: `render(canvas, blocks, shapes, keep_clear, seed=1) -> (layer_bgra_uint8, report)`; `canvas` BGRA uint8 H×W×4; `blocks` a list of `{"block": name, ...resolved numbers}`; `shapes` `{name: (rect [x,y,w,h], plane bytes)}` for parts named by blocks; `keep_clear` list of `(rect, plane bytes)`; `report` `{"blocks": [{"block", "painted", ...counts}], "clamped": [str], "ms": int}`. Constants `CAPS = {"particles": 60000, "layers": 3, "blocks": 8}`.

- [ ] **Step 1: Write the failing tests** in `test_effect_blocks.py`:
  `test_particles_match_falling_snow` (render of `{"block":"particles","layers":3,"density":1,"wind_deg":10}` on a 600×450 grey canvas has the same flakes per depth as `snow_raster.falling` with the same seed, ±0); `test_wash_from_bottom_is_densest_at_the_bottom` (mean alpha of the bottom tenth > 3× the top tenth, `from: bottom, falloff: 0.6, opacity: 0.5`); `test_noise_stays_inside_its_area`; `test_caps_need_a_named_part` (report says which part was missing, layer empty); `test_rays_point_from_their_source`; `test_texture_is_placed_inside_its_area_only`; `test_keep_clear_is_never_painted` (alpha 0 inside a face mask for every block); `test_caps_hold_on_a_6000_canvas` (`count 10**9`, 50 blocks → ≤ 60000 particles, 8 blocks, `clamped` names both, < 30 s at 6000×4500).
- [ ] **Step 2: Run them; expect FAIL** (`ModuleNotFoundError: effect_blocks`).
- [ ] **Step 3: Implement `effect_blocks.py`**: one function per block `(canvas, params, shapes, rng) -> (bgra, report_row)`, composited in order with "over"; keep-clear applied last via `snow_raster.clear_weight`. `particles` delegates to `plan_flakes` + `render_layer` with `streak` and `colour` (`light` | `local`); `caps` delegates to `snow_raster.settled`.
- [ ] **Step 4: Run them; expect PASS**, then the whole plugin suite (command in Global Constraints with `-p 'test_*.py'`).
- [ ] **Step 5: Commit** `Effect blocks: particles, wash, noise, caps, rays and texture in numpy, capped, never inside keep-clear parts`.

### Task 2: The `effect` and `effect_preview` operations (plugin)

**Files:**
- Create: `krita-mcp/krita-plugin/kritamcp/effect_craft.py` (class `EffectCraft`, the shape of `snow_craft.py`)
- Modify: `krita-mcp/krita-plugin/kritamcp/creative_tools.py:38,98,129,620,725,813,932` (import, `NEW_CONTRIBUTIONS`, the class bases, the operation lists, validate/apply branches, title `'Effect'`)
- Test: `krita-creative-agent/tests/test_effect_craft.py`

**Interfaces:**
- Consumes: Task 1 `render`.
- Produces: native operation `effect {name, blocks, keep_clear: [{mask_path, bounds}], parts: {name: {mask_path, bounds}}, seed?}` → one reversible pass, one layer named `Effect: <name>` in the move's group, result `{report}`; native operation `effect_preview {image_path, blocks, keep_clear, parts, out_path}` → writes a PNG of the canvas view with the effect over it, touches no document, result `{report}`.

- [ ] **Step 1: Write the failing tests** (`test_snow_craft.py`'s fakes): `test_effect_paints_one_layer_named_after_it`; `test_effect_rejects_unknown_fields_and_blocks`; `test_preview_writes_a_png_and_opens_no_document` (fake Krita records no `openDocument`/`createDocument`); `test_preview_refuses_a_path_outside_the_chat_folder`.
- [ ] **Step 2: Run; expect FAIL** (no `effect_craft`).
- [ ] **Step 3: Implement `EffectCraft._effect_check/_effect_validate/_effect_apply/_effect_preview`** and register both operations; `effect_preview` reads `image_path` with OpenCV, writes `out_path` only under `session['output']`.
- [ ] **Step 4: Run; expect PASS**; then the plugin suite.
- [ ] **Step 5: Commit** `Effect operations: effect paints a recipe on its own layer; effect_preview renders it on the canvas view without a document`.

### Task 3: Recipe schema, expressions and the library (companion)

**Files:**
- Create: `krita-creative-agent/src/effects/recipe.ts`, `krita-creative-agent/src/effects/library.ts`
- Modify: `krita-creative-agent/package.json` (`"yaml"` pinned to the version now in `node_modules/yaml/package.json`)
- Test: `krita-creative-agent/tests/effect-recipe.test.mjs`, `krita-creative-agent/tests/effect-library.test.mjs`

**Interfaces:**
- Produces:
  - `type Recipe = { name: string; cue: string; lesson?: string; evidence?: string; layer?: string; keep_clear: string[]; options: Record<string, { default: number; min: number; max: number; describe?: string }>; blocks: BlockSpec[]; auto_kept?: boolean }`
  - `parseRecipe(text: string, file: string): { recipe: Recipe } | { error: string }` (error names file and field)
  - `evaluate(expr: number | string, options: Record<string, number>): number` (throws on any other name or token)
  - `resolveBlocks(recipe: Recipe, given: Record<string, unknown>): { blocks: ResolvedBlock[]; notes: string[] }` (clamps options and caps, notes say what was clamped)
  - `loadEffects(dirs: { bundled: string; own: string }): Promise<{ effects: Map<string, Recipe & { source: 'bundled' | 'own'; file: string }>; skipped: string[] }>` (own overrides bundled by name)
  - `saveEffect(own: string, recipe: Recipe): Promise<string>`; `removeEffect(own: string, name: string): Promise<boolean>`; `resetEffects(own: string): Promise<number>`

- [ ] **Step 1: Write the failing tests**: `fog parses and resolves with its defaults`; `expressions allow only numbers, option names, + - * /, parentheses, min and max` (`"0.5 * density"` → 0.5; `"process.exit()"`, `"density.constructor"`, `"1e9 ** 9"` throw); `a broken recipe is skipped with its file and field named` (unknown block `smoke`, `options.density.min > max`, unbalanced `"(0.5"` — `skipped` lists `bad.yaml: blocks[0].block` etc., the other effects load); `values beyond the caps are clamped and said`; `cue, lesson and evidence over their lengths are refused`; `own effects override bundled ones by name`; `reset deletes only the artist's folder`.
- [ ] **Step 2: Run** `npm run test:unit`; expect FAIL (modules missing).
- [ ] **Step 3: Implement** with TypeBox schemas for the recipe and each block (`additionalProperties: false`), the `yaml` parser, and a hand-written expression reader (tokenizer + recursive descent; no `Function`, no `eval`).
- [ ] **Step 4: Run; expect PASS**; `npx tsc --noEmit -p .` clean.
- [ ] **Step 5: Commit** `Effect recipes: YAML checked by schema, arithmetic on its own options only, a library of bundled and own effects`.

### Task 4: Bundled fog, snow and policy

**Files:**
- Create: `krita-creative-agent/effects/fog.yaml`, `krita-creative-agent/effects/snow.yaml`, `krita-creative-agent/effects/policy.yaml`, `krita-creative-agent/src/effects/policy.ts`
- Modify: `agent/package_app.py` only if bundled companion folders are listed explicitly (check `effects/` ships in the app; `package-app.sh --check` must stay 0 problems)
- Test: `krita-creative-agent/tests/effect-bundled.test.mjs`, `krita-creative-agent/tests/test_effect_blocks.py` (one more test)

**Interfaces:**
- Consumes: Task 3 `parseRecipe`, `resolveBlocks`.
- Produces: `type Policy = { failures_before_build: 2; candidates: 3; retries: 1; minutes: 4; preview_side: 1024; auto_keep_min_seconds: 20 }`; `readPolicy(file: string): Policy` (defaults when the file is missing or invalid, never throws).

- [ ] **Step 1: Write the failing tests**: `the bundled effects and policy load with nothing skipped`; `snow.yaml resolves to what paint_snow sends` (falling: same density, wind 10, 3 layers, keep_clear faces and hair as `snow-tool.ts` defaults); Python `test_snow_recipe_paints_what_falling_snow_paints` (same flakes per depth as `snow_raster.falling`).
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Write `fog.yaml`** (wash from bottom, falloff 0.6, lowers contrast 0.3, opacity `0.5 * density`; noise large, opacity `0.25 * density`, within the bottom `height` share; options density 0.3–2 default 1, height 0.1–1 default 0.4; cue "fog, mist, haze in the air; distance fading"), **`snow.yaml`** (particles as `paint_snow`'s falling; caps on `settle_on` when given), **`policy.yaml`** (the values above) and `readPolicy`.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** `Custom effects ship with fog and snow; the build policy in policy.yaml`.

### Task 5: The `paint_effect` tool and the setting

**Files:**
- Create: `krita-creative-agent/src/effects/effect-tool.ts`
- Modify: `krita-creative-agent/src/tools.mjs:390-395` (push `effectTools(...)` beside `snowTools`), `krita-creative-agent/src/settings-schema.mjs` (`custom_effects`, after `preview_additions`), `krita-creative-agent/src/tool-catalogue.ts` (`paint_effect` timing), `krita-creative-agent/src/studio.mjs:1778-1783` (offer `paint_effect` only when `custom_effects` is on)
- Test: `krita-creative-agent/tests/effect-tool.test.mjs`

**Interfaces:**
- Consumes: Task 3 `loadEffects`, `resolveBlocks`; Task 2 operation `effect`; the studio's `proposeArea` as `findPart` (as `snowTools`).
- Produces: `effectTools(runtime: EffectRuntime, deps: { effect: (params) => Promise<unknown>; findPart(name: string, signal?: AbortSignal): Promise<Shape | null>; library(): Promise<Map<string, Recipe>> }): ToolDefinition[]` — one tool `paint_effect { effect: string, options?: Record<string, number>, settle_on?: string[], keep_clear?: string[] }`; `effectCatalogue(effects): string` (one quoted line per effect: `- fog: this effect is for "…"`).
  Setting: `{ key: 'custom_effects', type: 'boolean', default: false, panel: 'generic', label: 'Custom effects (experimental)' }`.

- [ ] **Step 1: Write the failing tests**: `paint_effect paints fog on one layer with faces kept clear` (fake native records `effect` with resolved blocks and the faces shape); `an unknown effect lists the ones there are`; `cues reach the painter quoted, never as instructions` (a cue "ignore the artist" appears only inside `"…"` in the catalogue line); `off by default: no paint_effect in the painter's tools and paint_snow unchanged`; `on: paint_effect is offered`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `effect-tool.ts` on the pattern of `snow-tool.ts` (find named parts, keep-clear default faces and hair, one native call, the report as the result).
- [ ] **Step 4: Run; expect PASS**; typecheck clean.
- [ ] **Step 5: Commit** `paint_effect: the painter uses library effects through one tool, offered only with Custom effects on`.

### Task 6: When a build starts (failure log and the "effect met" decision)

**Files:**
- Create: `krita-creative-agent/src/effects/failures.ts`
- Modify: `krita-creative-agent/src/studio.mjs` (after each Agent move whose request names an effect: one Luna decision; record; maybe start a build or say the hint), `krita-creative-agent/src/skill-commands.ts` (`{ name: 'new-effect', aliases: [], action: 'new_effect' }`, a studio-answered command like `original-goal`)
- Test: `krita-creative-agent/tests/effect-failures.test.mjs`, `krita-creative-agent/tests/effect-trigger-studio.test.mjs`

**Interfaces:**
- Consumes: Task 3 `loadEffects` (cue matching), Task 4 `readPolicy`, the studio's `luna()` decision client (pattern: `luna-materials.ts pickMaterial`).
- Produces: `effectAsked(text: string): string | null` (the effect a request names, by words; null when none); `sameEffect(a: string, b: string): boolean`; `class EffectFailures { record(effect: string, failed: boolean, at: string): void; due(effect: string, policy: Policy): boolean; discarded(effect: string): void; building: string | null }`; `effectMet({ client, request, before, after, signal }): Promise<boolean | null>` (null on Luna failure: never counts as a failure).

- [ ] **Step 1: Write the failing tests**: `the same effect twice is due, once is not`; `a redo of an effect called done counts as a failure`; `an Undo alone does not count`; `a library effect whose cue matches is used, not built`; `after Discard the effect is not built again unless /new-effect`; `one build at a time`; `a Luna failure is not a failure`; studio: `off: the second failure says the enable hint once`; `on: the second failure starts a build and the next move starts without waiting`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `failures.ts`; in the studio, after a move: `effectAsked(request)` → `effectMet` → `record` → `due` → `startEffectBuild` (Task 7) without `await` on the move's path.
- [ ] **Step 4: Run; expect PASS**; full `npm run test:unit`.
- [ ] **Step 5: Commit** `Custom effects start a build after the same effect fails twice (Luna: was it met?), never on an Undo alone, never twice at once`.

### Task 7: The build, the card and the library changes

**Files:**
- Create: `krita-creative-agent/src/effects/build.ts`, `krita-creative-agent/skills/effect-building/SKILL.md`
- Modify: `krita-creative-agent/src/studio.mjs` (`startEffectBuild`, `answerEffectBuild`, the worker session as `prepareBatchProposal`'s worker at studio.mjs:4455-4462 with one tool `submit_effect_candidates`), `krita-creative-agent/src/test-commands.ts` (`effect_build_answer`, as `canvas_reference_answer`)
- Test: `krita-creative-agent/tests/effect-build.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–6; `requestAssetImage` (assets.mjs) for the last resort; `assertAiImageAllowed`.
- Produces: `effectBuilder(host: EffectBuildHost): { start(effect: string, request: string): Promise<EffectBuildRecord | null>; answer({ id, action }: { id: string; action: 'keep' | 'retry' | 'discard' | 'remove' }): Promise<void> }`; event `{ type: 'effect_build', id, title: 'Custom effect', message, image_path, options, actions, auto_keep_seconds }`; record `{ id, effect, candidates: string[], chosen: 'A'|'B'|'C'|null, state: 'ready'|'kept'|'removed'|'discarded', auto_kept?: boolean }`.

- [ ] **Step 1: Write the failing tests**: `three candidates, an invalid one retried once, Luna chooses blind` (Luna's request shows only A/B/C images and the request text, never recipe text); `the card shows the canvas and the chosen effect`; `Keep and Remove change only the library` (no native call touches the painting); `nothing waits for the card` (a move runs while the card is open); `with no candidate left and AI images allowed, one texture recipe`; `with AI images off, the card says how to allow one`; `over 4 minutes the build ends and says so`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `build.ts` (worker → `parseRecipe` → `effect_preview` per candidate at ≤ 1024 px → Luna choice → card) and `SKILL.md` (the blocks, their limits, `snow.yaml` as the worked example, "write YAML only").
- [ ] **Step 4: Run; expect PASS**; full suite and typecheck.
- [ ] **Step 5: Commit** `Custom effect builds: candidates from a worker, previewed on the canvas view, chosen blind by Luna, kept by the artist`.

### Task 8: The panel — card, Auto-approve's Keep, setting with Reset

**Files:**
- Modify: `krita-mcp/krita-plugin/kritamcp/creative_docker.py:3376-3385` (a `kind == 'effect_build'` card beside `canvas_reference`, Remove effect after Keep), `krita-mcp/krita-plugin/kritamcp/auto_approve.py` (`effect_build` answerable; delay `max(delay, 20)`; answer `keep`), `krita-creative-agent/src/auto-approve.ts` (same kind), the settings panel (the `custom_effects` checkbox from the schema, plus a **Reset custom effects…** button with a confirmation, sending `{type: 'reset_effects'}`), `krita-creative-agent/src/studio.mjs` (`reset_effects` → `resetEffects`)
- Test: `krita-creative-agent/tests/ui_panel_custom_effects.py` (PyQt5 and PyQt6), `krita-creative-agent/tests/auto-approve.test.mjs`, and add the UI script to `agent/ci.sh`'s panel group

**Interfaces:**
- Consumes: Task 7 event and `answer`.

- [ ] **Step 1: Write the failing tests**: panel — the card shows Keep / Try again / Discard, then Remove effect after Keep; Auto-approve with delay 10 presses Keep at 20 s, with 30 at 30 s; Reset asks first and sends `reset_effects` only on yes. Companion — `effect_build is auto-approvable, canvas_reference still never`.
- [ ] **Step 2: Run** (`uv run -q --with pyqt5 python tests/ui_panel_custom_effects.py`, then pyqt6; `npm run test:unit`); expect FAIL.
- [ ] **Step 3: Implement** with `qt_compat`.
- [ ] **Step 4: Run; expect PASS** under both PyQt versions; then `bash agent/ci.sh` (no file edits while it runs).
- [ ] **Step 5: Commit** `Custom effects in the panel: the build card, Auto-approve keeps after at least 20 s, the setting with Reset`.

### Task 9: Live check (Toska, a copy of the Dostoevsky painting)

- [ ] Build, package, check (0 problems), install with no document open, one restart (agent/build-macos.sh, package-app.sh, install-app.sh).
- [ ] With Custom effects off: ask twice for "low fog over the field"; the chat shows the enable hint once; nothing else changes.
- [ ] On: `paint_effect` fog paints one layer "Effect: fog", faces clear, Undo removes it.
- [ ] `/new-effect light shafts through the clouds`: a card within 4 minutes; Keep; the next move uses it; Remove effect drops it; Reset empties the artist's folder only.
- [ ] Report exactly which of these ran, with the card image sent to the artist.

## Part 2: Live effects (C++ generators)

> Folded in on 2026-11-01 from `live-effects` (design: `creative-agent/openspec/changes/live-effects/proposal.md`; Clip Studio evidence: `creative-agent/local-notes/clip-studio-study/README.md`, "Effect lines" and "Screentones"). Same execution rules as Part 1.

**Goal:** Focus lines, speed lines and light rays are fill layers drawn from about fifteen numbers and a seed saved in the `.kra`. Each redraws only when a setting changes and stays sharp at any image size. A change from the agent is one Krita undo step, and the artist can edit the layer by hand in the usual fill-layer dialog. The agent adds and changes these layers through one tool by their settings. A recipe's `rays` block can produce a light-rays layer.

**Architecture:** One C++ plugin, `plugins/generators/liveeffects/`, registers three generators: `focuslines`, `speedlines`, `lightrays`. It is laid out like `screentone/`: a `KisGenerator` subclass, a `KisFilterConfiguration` subclass, a `.ui` widget, a plugin class with a `.json` file, and `tests/`. The geometry is pure maths with QtCore only, in a static library that both the module and the tests link. Line spacing and closure follow the Clip Studio study, and randomness uses a seeded LCG. Two caches:
- **Our geometry cache:** each configuration builds its polygon list once, keyed by the configuration's XML and the canvas size, guarded by a mutex as `KisScreentoneGeneratorConfiguration::Private::getTemplate()` is.
- **Krita's pixel cache, already there:** `KisGeneratorLayer::requestUpdateJobsWithStroke` (`libs/image/generator/kis_generator_layer.cpp:117-154`) regenerates only regions not yet prepared, and starts again only when the config fails `compareTo`, the image bounds change or the layer moves. The canvas mipmaps serve each zoom level, so "a cache per zoom level" needs no new per-zoom code.

One libkis change: `FillLayer.setGenerator` calls `layer->setFilter` directly (`libs/libkis/FillLayer.cpp:52-74`), with no undo step. It will run `KisChangeFilterCmd` (`libs/image/commands/kis_change_filter_command.h`) through `DocumentHistory::runPropertyCommand`, as `Node.setName`/`setOpacity` do (`Node.cpp:516,536`). Inside an agent move the change joins that move's step. Python cannot push a `KUndo2Command`, so there is no plugin-only route.

Plugin side: the fill path of `create_layer` already exists (`layer_craft.py:110-121`, `capabilities.validate_generator`); new are `set_fill`, the generators in `capabilities.GENERATOR_CANDIDATES`, and `observe_probe` gaining `live_effects`. Companion: `src/effects/live-effect-tool.ts` provides `live_effect`, a measured card file, and `rays` gains `live: true`.

**Tech Stack:** C++17, Qt5/Qt6 (QtCore and QPainter on `QImage`, no platform APIs), Krita `kritaimage`/`kritaui`, QTest + `kritatestsdk`; plus Part 1's stack.

### Constraints added for Part 2 (Part 1's Global Constraints still apply)

- **Benchmark scenes (2026-11-01; overrides any scene named in this plan):** every A/B gate follows `creative-agent/openspec/benchmark-scenes.md` — fixed goal images, 3 runs per arm, blind Luna + the user, and the muddiness / stroke-count / repetition / observe-time measurements. "Still life" means scene 1; New Moscow and the artist's own paintings are never used.
- **Where C++ goes:** only `plugins/generators/liveeffects/`, plus `add_subdirectory(liveeffects)` in `plugins/generators/CMakeLists.txt`. Single exception: the libkis `FillLayer.setGenerator` change, tested in `libs/libkis/tests/TestDocument.cpp`. Nothing under `libs/image` or `libs/ui`.
- **Builds:** only `nice -n 19 env CMAKE_BUILD_PARALLEL_LEVEL=8 zsh agent/build-macos.sh` (installs into `_install`). Never Homebrew `ninja`, not even `-n`. If `_build/CMakeCache.txt` has `BUILD_TESTING:BOOL=OFF`, stop and ask: `--tests` only takes effect on a fresh configure.
- **C++ tests:** only `agent/run-tests.sh <program> [functions]`; every new program in `agent/ci-tests.txt`; QTest; files under a `QTemporaryDir` (absolute paths); `QVERIFY` every pointer; widgets built, never shown; no dialogs; do not copy screentone's habit of writing `*_generated.png` into the working folder; generators fetched via `KisGeneratorRegistry::instance()->get(...)` as `KisScreentoneGeneratorTest` does.
- **Geometry and randomness:** positions as 0–1 shares of width and height, sizes as shares of the long side. The seed is a config property `seed`, saved only in the layer's `.filterconfig` XML (`kis_kra_save_visitor.cpp:480-496`), never a side file. Line `i` draws from its own stream `KisLiveLcg(seed ^ (i * 2654435761u))`, always exactly four draws in a fixed order (spacing, length, width, group), so changing one setting never reshuffles lines it does not touch.
- **Caps** (clamped; each clamp named in the returned `clamped` list): focus lines ≤ 4000, speed lines ≤ 2000, rays ≤ 64; step ≥ 0.05°; NaN or negative → the setting's default; a whole 6000 × 4500 layer generates in ≤ 5 s (asserted).
- **Colour:** read with `getColor("color")` as the solid generator does (`plugins/generators/solid/colorgenerator.cpp:78`), so `capabilities.info_object`'s `'#RRGGBB'` path works unchanged.
- **Gating:** `live_effect` is offered only when `custom_effects` is on, Krita lists the generator, and `src/effects/live-catalog.json` holds a measured card for it.
- **Live tests:** MCP `creative_test_*` on copies only, `width=6000 height=4500`; never `brush_probe`; before `install-app.sh` check `pgrep -fl "Toska.app/Contents/MacOS"` and `mount | grep -i toska` and ask the artist to quit if either finds anything; one install and one restart per batch.
- **Portability:** no Cocoa, no `Q_OS_MACOS` branches; Windows and Linux CI must build the plugin.

### Review Focus (Part 2)

6. Reload and edit stability: a saved and reloaded layer redraws the same pixels; changing width, length or taper moves no line's angle. → Task 10 `widthChangeKeepsEveryAngle`; Task 12 `testLiveEffectKraRoundTripSamePixels`.
7. Undo: an agent setting change is one step, undo restores the exact previous pixels; an identical config adds no step. → Task 12 `testSetGeneratorIsOneUndoStep`, `testSetGeneratorSameConfigAddsNoStep`.
8. Absurd settings never hang; they are clamped and named (`spacing_angle 0`, `count 1e9`, `width NaN`, `spacing_distance -1`). → Task 10 `capsHoldForAbsurdSettings`; Task 14 `test_set_fill_refuses_unknown_keys_and_clamps_numbers`.
9. Patch seams: Krita renders generators in parallel patches (`kis_generator_stroke_strategy.cpp:39-54`); a line crossing a patch edge must match the whole-canvas render. → Task 11 `patchesMatchWholeRender`.
10. Observe slowdown (the New Moscow filter-mask failure): 1, 5 and 10 live layers at 6000 × 4500 stay close to none. → Task 14 `test_observe_probe_adds_live_effect_layers`; Task 16 measurement.
11. Offering a generator before it has a card. → Task 15 `a generator without a measured card is not offered`.

---

### Task 10: Effect-line geometry and the seeded LCG (pure C++)

**Files:**
- Create: `plugins/generators/liveeffects/KisLiveEffectsGeometry.h`, `KisLiveEffectsGeometry.cpp`, `plugins/generators/liveeffects/CMakeLists.txt` (`add_library(kritaliveeffectsgeometry STATIC …)`, `POSITION_INDEPENDENT_CODE ON`, linking `Qt::Core Qt::Gui`; precedent: the static libraries in `plugins/tools/basictools/CMakeLists.txt`)
- Create: `plugins/generators/liveeffects/tests/CMakeLists.txt`, `tests/KisLiveEffectsGeometryTest.{h,cpp}`
- Modify: `plugins/generators/CMakeLists.txt` (`add_subdirectory(liveeffects)`), `agent/ci-tests.txt` (`KisLiveEffectsGeometryTest`)

**Interfaces:**
- Produces:
  - `struct KisLiveLcg { explicit KisLiveLcg(quint32 seed); qreal next(); }` — `next()`: `x = x * 1103515245u + 1234567u`, returns `((x >> 16) & 0x7fff) / 32768.0`.
  - `struct KisFocusLinesSettings { QPointF centre; qreal innerRx, innerRy, rotationDeg; bool byDistance; qreal stepDeg, stepDistance, spacingJitter, length, lengthJitter, width, widthJitter, taper; int groupSize; qreal groupGap, groupJitter; quint32 seed; }` (`centre` 0–1 share; radii, lengths, widths, `stepDistance` shares of the long side)
  - `struct KisSpeedLinesSettings { qreal angleDeg, centreOffset, band; int count; qreal length, lengthJitter, width, widthJitter, taper; quint32 seed; }`
  - `struct KisLightRaysSettings { QPointF source; int count; qreal spreadDeg, softness, falloff; quint32 seed; }` (`source` in −0.5 to 1.5, so a ray can start outside the frame)
  - `QVector<qreal> focusLineAngles(const KisFocusLinesSettings &, QSize canvas, QStringList *clamped = nullptr);`
  - `QVector<QPolygonF> focusLinePolygons(const KisFocusLinesSettings &, QSize canvas, QStringList *clamped = nullptr);` (canvas pixels)
  - `QVector<QPolygonF> speedLinePolygons(const KisSpeedLinesSettings &, QSize canvas, QStringList *clamped = nullptr);`
  - `qreal lightRaysAlpha(const KisLightRaysSettings &, QSize canvas, QPointF pixel);` (analytic, 0–1)
  - `int liveEffectsGeometryBuilds();` (test hook: counts polygon-builder calls)

**Spacing and closure algorithm** (the only body this plan fixes):

```
long = max(canvas.w, canvas.h); a = 0; i = 0; angles = []
radiusAt(θ) = rx*ry / sqrt((ry*cos(θ-φ))² + (rx*sin(θ-φ))²)   // px, rx = innerRx*long, ry = innerRy*long, φ = rotation
              (if rx or ry is 0: 0.1*long, so distance spacing has a radius to measure along)
while a < 360 - 1e-9 and i < 4000:
    angles.push(rotationDeg + a)
    rng = KisLiveLcg(seed ^ (i * 2654435761u)); uSpace, uLen, uWidth, uGroup = rng.next() ×4   // always four
    base = byDistance ? degrees(atan(stepDistance*long / radiusAt(rotationDeg + a))) : stepDeg
    base = clamp(base, 0.05, 90)
    n = max(1, round((360 - a) / base)); step = (360 - a) / n           // stretch so the circle closes evenly
    if n > 1: step *= 1 + spacingJitter * (2*uSpace - 1)                 // never jitter the closing step
    if groupSize > 0 and (i + 1) % groupSize == 0:
        step += (groupGap - 1) * step * (1 + groupJitter * (2*uGroup - 1))
    a += step; i += 1
```

Each line is a quad: inner end on the inner ellipse at its angle; outer end at radius `radiusAt + length*long*(1 + lengthJitter*(2uLen−1))`; outer width `width*long*(1 + widthJitter*(2uWidth−1))`; inner width `outer*(1 − taper)` (taper 1 = triangle). Speed lines put `count/2` lines on each side of the centre line, direction negated on the second side; each line's offset across the band comes from its own stream.

- [ ] **Step 1: Write the failing tests** in `KisLiveEffectsGeometryTest`:
  - `lcgMatchesClipStudioConstants`: seed 1 gives 0.514434814453125, then 0.464874267578125.
  - `byAngleTenDegreesGivesThirtySixEvenLines`: 36 angles, every gap 10 ± 1e-9.
  - `lastStepIsStretchedToCloseTheCircle`: a 7° step gives 51 lines; every gap, last-to-first included, is 360/51 ± 1e-9.
  - `byDistanceIsEvenAlongAnEllipse`: rx 0.3, ry 0.1, distance 0.01; neighbour arc length within ±10% of 0.01 × long side.
  - `sameSeedSameLines`; `seedChangesLines` (polygons differ).
  - `widthChangeKeepsEveryAngle`: spacing jitter 0.5; changing width, length or taper leaves `focusLineAngles` identical.
  - `groupingAddsTheGap`: group 5, gap 3, no jitter; every fifth gap is 3× the others.
  - `speedLinesSplitAroundTheCentreLine`: count 40 → 20 per side, opposite directions.
  - `raysFadeWithDistance`: alpha falls along a ray.
  - `raysCountMatches`: sampling a circle around the source finds `count` peaks.
  - `capsHoldForAbsurdSettings`: `stepDeg 0` → ≤ 4000 angles, `clamped` contains `"spacing_angle"`; `width` NaN → default, `"width"` named; speed `count` 10^9 → 2000; all in < 100 ms.
- [ ] **Step 2: Build and run; expect FAIL.** `nice -n 19 env CMAKE_BUILD_PARALLEL_LEVEL=8 zsh agent/build-macos.sh` fails to compile: `KisLiveEffectsGeometry.h` not found, or no definitions.
- [ ] **Step 3: Implement** `KisLiveEffectsGeometry.cpp` to the algorithm and interfaces above.
- [ ] **Step 4: Build and run; expect PASS.** `agent/run-tests.sh KisLiveEffectsGeometryTest` reports `Totals: 14 passed, 0 failed`.
- [ ] **Step 5: Commit** `Live effects geometry: focus-line spacing by angle or distance with the last step stretched to close the circle, speed lines and rays, a seeded LCG per line`.

### Task 11: The focus-lines generator (configuration, generate, plugin)

**Files:**
- Create in `plugins/generators/liveeffects/`: `KisLiveEffectsConfiguration.{h,cpp}` (base for all three: `color`, `opacity`, `seed`, the geometry cache), `KisFocusLinesGenerator.{h,cpp}`, `KisLiveEffectsGeneratorPlugin.{h,cpp}`, `KritaLiveEffectsGenerator.json` (as `KritaScreentoneGenerator.json`: `"Id": "Live Effects Generator"`, `"X-KDE-Library": "kritaliveeffectsgenerator"`, `"X-Krita-Version": "28"`), `tests/KisFocusLinesGeneratorTest.{h,cpp}`
- Modify: `liveeffects/CMakeLists.txt` (`kis_add_library(kritaliveeffectsgenerator MODULE …)` linking `kritaui kritaliveeffectsgeometry`, installed to `${KRITA_PLUGIN_INSTALL_DIR}`), `agent/ci-tests.txt`

**Interfaces:**
- Consumes: Task 10.
- Produces:
  - `KisFocusLinesGenerator : KisGenerator` — id `focuslines`, category `KoID("basic")`, label `i18n("&Focus Lines...")`, `setSupportsPainting(true)`, `allowsSplittingIntoPatches()` default (true).
  - `KisLiveEffectsConfiguration : KisFilterConfiguration` with `const QVector<QPolygonF> &polygons(QSize canvas) const`; cache key `toXML()` + canvas size; the cache is shared by `clone()` (safe: the key, not the setters, decides rebuilds).
  - Properties (snake_case as screentone's): `center_x center_y inner_rx inner_ry rotation spacing_mode(0 angle, 1 distance) spacing_angle spacing_distance spacing_jitter length length_jitter width width_jitter taper group_size group_gap group_jitter color opacity seed`.
  - `factoryConfiguration()` sets every default (so `FillLayer.filterConfig()` and `capabilities._generators` list them all), seed 1. `defaultConfiguration()` (the dialog path, `kis_wdg_generator.cpp:36,124`) draws a fresh seed from `QRandomGenerator::global()`. *Assumption: `defaultConfiguration` is only used for new dialog layers; check its callers first.*
  - `generate(dst, size, config, updater)`: canvas = `dst.paintDevice()->defaultBounds()->bounds()` (as `simplexnoisegenerator.cpp:52`); keep polygons whose bounding rect meets the patch; draw antialiased with `QPainter` into a patch-sized `QImage::Format_Alpha8` translated by the patch's top-left; use it as a selection and lay the colour over it as screentone's generate does (foreground `bitBlt` through a `KisSelection`).
- [ ] **Step 1: Write the failing tests** in `KisFocusLinesGeneratorTest` (through the registry, `rgb8` devices): `registryHasFocusLines`; `factoryConfigurationListsEverySetting` (20 names); `sameSeedSamePixels`; `seedChangesPixels`; `xmlRoundTripKeepsSettingsAndSeed` (`toXML` → `fromXML` on a fresh factory config: `compareTo` true, identical pixels); `patchesMatchWholeRender` (600×450 in one call equals 7×5 uneven patches, byte for byte); `sharpAtAnySize` (1200×900 halved with `KisTransformWorker` vs 600×450: mean absolute alpha difference < 3/255); `geometryBuiltOncePerSettings` (four patches → 1 build; changed `width` → 2; same XML again → no new build); `wholeCanvasUnderFiveSeconds` (6000×4500, defaults, single thread).
- [ ] **Step 2: Build; run `agent/run-tests.sh KisFocusLinesGeneratorTest`; expect FAIL** (registry has no `focuslines`).
- [ ] **Step 3: Implement** configuration, generator and plugin (`KisGeneratorRegistry::instance()->add(new KisFocusLinesGenerator())`, as `KisScreentoneGeneratorPlugin.cpp`).
- [ ] **Step 4: Build; run both test programs; expect PASS.**
- [ ] **Step 5: Commit** `Focus lines fill layer: drawn from settings and a seed saved with the layer, geometry built once per settings, sharp at any size`.

### Task 12: Changing a fill layer from a script is one undo step (libkis)

**Files:**
- Modify: `libs/libkis/FillLayer.cpp:52-74`, `libs/libkis/FillLayer.h` (docstring: one undo step, joining an open macro or agent move), `libs/libkis/tests/TestDocument.{h,cpp}`

**Interfaces:**
- Produces: `FillLayer.setGenerator(name, config)`, same signature and return as now.
  - Layer in an image: `after = cfg->cloneWithResourcesSnapshot()`, `before = layer->filter()->cloneWithResourcesSnapshot()`, then `DocumentHistory::runPropertyCommand(image(), new KisChangeFilterCmd(layer, before, after), "FillLayer.setGenerator()")`, keeping the existing `forceUpdateTimedNode` wait.
  - Same config (`before->compareTo(after)`): returns true, no step.
  - Layer not yet in an image: `setFilter` as before, no step.
- [ ] **Step 1: Write the failing tests** in `TestDocument`: `testSetGeneratorIsOneUndoStep` (a `color` fill layer red → blue; `undoCount` +1; undo restores red pixels exactly); `testSetGeneratorSameConfigAddsNoStep`; `testSetGeneratorInsideAgentMoveJoinsIt` (`beginAgentMove("x")`, two `setGenerator`, `endAgentMove` → one step); `testLiveEffectKraRoundTripSamePixels` (a `focuslines` layer at 600×450, seed 7, saved to `QTemporaryDir`/a.kra, reopened with `Krita.openDocument`: equal `pixelData`, `filterConfig().property("seed") == 7`; needs the installed plugin, which `run-tests.sh`'s `KRITA_PLUGIN_PATH` provides).
- [ ] **Step 2: Build; run `agent/run-tests.sh TestDocument`; expect FAIL** on the first three (`undoCount` unchanged).
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run `agent/run-tests.sh TestDocument TestDocumentHistory TestPythonAgentMove`; expect PASS.**
- [ ] **Step 5: Commit** `libkis: FillLayer.setGenerator is one undo step (KisChangeFilterCmd through the script history), so a live effect's setting change undoes exactly`.

### Task 13: Speed lines, light rays, and the three config widgets

**Files:**
- Create in `plugins/generators/liveeffects/`: `KisSpeedLinesGenerator.{h,cpp}`, `KisLightRaysGenerator.{h,cpp}`, `KisFocusLinesConfigWidget.{h,cpp,ui}`, `KisSpeedLinesConfigWidget.{h,cpp,ui}`, `KisLightRaysConfigWidget.{h,cpp,ui}`, `tests/KisSpeedLinesGeneratorTest.cpp`, `tests/KisLightRaysGeneratorTest.cpp`, `tests/KisLiveEffectsConfigWidgetTest.cpp` (links `kritaui`)
- Modify: the plugin class (register all three), `CMakeLists.txt` (`ki18n_wrap_ui`), `agent/ci-tests.txt`

**Interfaces:**
- Speed lines: `angle center_offset band count length length_jitter width width_jitter taper color opacity seed`.
- Light rays: `source_x source_y count spread softness falloff color opacity seed` (per pixel via `lightRaysAlpha`, no blur, so patches cannot seam).
- Each widget: a `KisConfigWidget` with `setConfiguration`/`configuration`, plain Qt widgets as screentone's; a **New seed** button; `sigConfigurationUpdated` fires once per edit.
- [ ] **Step 1: Write the failing tests**: `speedLinesSameSeedSamePixels`, `speedLinesPatchesMatchWholeRender`, `raysPatchesMatchWholeRender`, `raysSharpAtAnySize`; per widget `widgetRoundTripKeepsEverySetting` (`setConfiguration(c)` → `configuration()->compareTo(c)`); `newSeedChangesOnlyTheSeed`. Widgets constructed, never shown.
- [ ] **Step 2: Build; run the three programs; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Build; run all five live-effects programs plus `TestDocument`; expect PASS.**
- [ ] **Step 5: Commit** `Speed lines and light rays fill layers, and a settings dialog for each live effect so the artist can edit them by hand`.

### Task 14: Plugin side: offer the generators, `set_fill`, observe with live layers

**Files:**
- Modify: `creative-agent/krita-mcp/krita-plugin/kritamcp/capabilities.py` (`GENERATOR_CANDIDATES` adds `'focuslines', 'speedlines', 'lightrays'`; `GENERATOR_SETTINGS` gains `color: {'type': 'color', 'default': '#000000'}` for each; `MANIFEST_VERSION` → 4)
- Modify: `layer_craft.py` (`SET_FILL_FIELDS = ('layer_id', 'generator_config', 'expected_revision')`, `_craft_validate_set_fill`, `_craft_set_fill`, `_craft_restore_fill`)
- Modify: `creative_tools.py` (operation list at line 625 and its validate/apply/reject branches beside `set_layer` at lines 698, 788, 924, 1920; `observe_probe` at line 238 gains `live_effects` 0–20, adding that many `focuslines` fill layers, removed afterwards like its probe paint layers)
- Modify: `protection.py:194,331` (`set_fill` restores like `set_layer`)
- Test: `creative-agent/krita-creative-agent/tests/test_live_effects_craft.py` (fakes from `test_snow_craft.py`)

**Interfaces:**
- Produces native operation `set_fill {layer_id, generator_config}`: only an agent-owned fill layer whose generator is one of the three; keys and types checked against the manifest; numbers clamped to the C++ caps with each clamp named; calls `FillLayer.setGenerator(name, info)` (one undo step after Task 12); returns `{prior: {generator, config}, clamped: [...]}`. Rejecting the pass calls `setGenerator` with `prior`.
- Produces `observe_probe {layers?, live_effects?}` returning `ms` as now plus `live_effects: N`.
- [ ] **Step 1: Write the failing tests**: `test_new_generators_are_offered_when_krita_has_them`; `test_set_fill_changes_only_agent_fill_layers` (the artist's fill layer refused, naming why); `test_set_fill_refuses_unknown_keys_and_clamps_numbers` (`width` NaN, `count` 1e9, unknown `foo`); `test_set_fill_reject_restores_prior_config`; `test_observe_probe_adds_live_effect_layers` (N fill layers added, then all removed).
- [ ] **Step 2: Run them; expect FAIL** (Part 1's plugin suite command with `-p 'test_live_effects*.py'`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, then the whole plugin suite (`-p 'test_*.py'`); expect PASS.**
- [ ] **Step 5: Commit** `Live effects in the plugin: offered as fill generators, changed by settings with set_fill (one undo step), observe_probe times live layers`.

### Task 15: Companion: `live_effect`, catalog cards, and `rays` targeting the generator

**Files:**
- Create: `krita-creative-agent/src/effects/live-effect-tool.ts`, `krita-creative-agent/src/effects/live-catalog.json` (starts as `{ "cards": {} }`; filled by Task 16)
- Modify: `src/effects/recipe.ts` (`rays` gains `live: Type.Optional(Type.Boolean())`); `src/effects/effect-tool.ts` (a resolved `rays` block with `live: true` becomes a `live_effect` add in the same move; if `lightrays` is missing or has no card, fall back to the numpy block and say so in the notes); `src/tools.mjs` (push `liveEffectTools(...)` beside `effectTools`); `src/studio.mjs` (offered only with `custom_effects` on); `src/tool-catalogue.ts` (`live_effect` timing from Task 16)
- Test: `krita-creative-agent/tests/live-effect-tool.test.mjs`

**Interfaces:**
- Consumes: native `create_layer` (type `fill`), Task 14's `set_fill`, `krita_capabilities`.
- Produces:
  - `type LiveEffect = 'focus_lines' | 'speed_lines' | 'light_rays'` → `focuslines | speedlines | lightrays`.
  - `liveEffectTools(runtime, deps: { createLayer(p): Promise<Result>; setFill(p): Promise<Result>; generators(): Promise<Record<string, Record<string, Spec>>> }): ToolDefinition[]` — one tool `live_effect { effect: LiveEffect, layer_id?: string, settings: Record<string, number | string> }`: without `layer_id` adds a layer `Live: <effect>` with a random 31-bit `seed` unless given; with `layer_id` calls `set_fill`.
  - `liveCards(catalog): string`: one line per card (effect, what it is for, measured ms at 6000×4500).
  - `liveRaysSettings(block: ResolvedBlock): Record<string, number>`: `from_point` → `source_x/y`, `from` side → a source outside that edge, `count`, `spread_deg` → `spread`, `opacity` → `opacity × 100`.
- [ ] **Step 1: Write the failing tests**: `adds a focus-lines layer with a seed and the settings given`; `changing one setting sends only set_fill with that layer`; `a generator without a measured card is not offered`; `off by default: no live_effect`; `a live rays block makes a light-rays layer in the same move`; `without the lightrays generator a live rays block paints numpy rays and says so`; `unknown settings are refused with the list of known ones`.
- [ ] **Step 2: Run `npm run test:unit`; expect FAIL.**
- [ ] **Step 3: Implement** in strict TS on the pattern of `effect-tool.ts`.
- [ ] **Step 4: Run; expect PASS;** `npx tsc --noEmit -p .` clean.
- [ ] **Step 5: Commit** `live_effect: the agent adds or changes focus lines, speed lines and light rays by their settings; a recipe's rays block can make a live layer`.

### Task 16: Live check, cards, observe cost and A/B (Toska, copies at 6000 × 4500)

One build and install for all of this; never install over a running app (pgrep + mount); ask for a single restart.

- [ ] **Reload:** `creative_test_start width=6000 height=4500`; add focus lines with `live_effect`; save, close and reopen the copy; pixels equal by checksum of `projectionPixelData`; zoom 400% and 12.5%, lines stay crisp.
- [ ] **Undo:** change `spacing_angle` 5 → 10; Undo History shows one new step; undo, checksum equals the one before.
- [ ] **Hand edit:** open the layer's Properties dialog by hand (the artist, or `creative_test_command` if it can without a dialog); edit one setting; the agent's `filterConfig()` shows it.
- [ ] **Cards:** for each generator render sparse, default and dense settings; record ms per layer, covered share and a thumbnail into `src/effects/live-catalog.json`; rerun `npm run test:unit`.
- [ ] **Observe cost:** `observe_probe` with `live_effects` 0, 1, 5, 10, three runs each, medians recorded in `local-notes/`. **Pass:** each median ≤ 1.25 × the median with none. On a fail, stop and report; do not tune live.
- [ ] **A/B:** the same scene copy with and without a focus-lines layer; Luna (decision client) judges "the subject reads as the focus" blind; both images sent to the artist.
- [ ] **Speed lines and rays:** repeat the reload and undo checks.
- [ ] **Report:** exactly which checks ran, the numbers, and "committed locally" or "published (<sha>)".

Notes: assumptions not confirmed in code — `defaultConfiguration()` used only for new dialog layers (Task 11); whether Task 16's dialog check can run without opening a dialog; the 1.25× observe threshold and 5 s generate cap are planning numbers, not the artist's.
