# Painting skills: tasks

Spec: `proposal.md` and `mechanical-strokes.md` in this folder. Section M (hand strokes that do not come out
mechanical) is built first and partly done; sections 1 to 10 are not started. Order follows the proposal's build order
(Claude's proposal, open). New companion modules and tests are strict TypeScript; plugin tests run through
`run-tests.sh`; every test removes what it writes. After plugin changes: build, package, install, relaunch, once per
batch.

## M. Hand strokes that do not come out mechanical (`mechanical-strokes.md`)

- [x] M.0 Read both generators and rendered the seven Degas recipes offline (a plain line rasteriser over the move 1
      result, not Krita's engine; images in `local-notes/wikiart-study/results/offline-render/`). The old generator
      reproduces what Luna rejected: boxes of parallel bars, over the faces and hands too. The same recipes with
      `follow_form` and colour from the original follow the skirt's folds and the floor, with no box.
- [x] M.1 Luna's review (`extensions/luna-review.ts`) judges one painting call at a time and undoes its passes, at most
      twice a move, then stops the move; the painter was told only "reach the same goal another way". The seven
      recipes went in one `paint_batch`, so they got one verdict. Brushwork faults by finding id: `stripes`,
      `hard_graphic`, `flat_block`, `ellipses`.
- [x] M.2 A batch undone for a brushwork fault is sent back with the fault as its correction (`brushworkCorrection`:
      follow the form, pressure taper, the element's shape, one area per call). The existing cap of two undos a move
      is the retry limit. Test in `tests/luna-review.test.mjs`. Not built: a retry the host starts itself when the
      painter ends its move instead.
- [ ] M.3 Review per area. Today only by the painter sending one `paint_recipe` call per area (the tool's description
      and the correction say so). Not built: a verdict per action inside one `paint_batch`.
- [x] M.4 `src/gesture-strokes.ts`, used by `paint_recipe` for every recipe (generator version 2): `direction
      follow_form` (a direction field from the goal image where it sits on the canvas, else from the canvas last seen;
      strokes stop at strong edges, sharp turns and the area's boundary), `angle` in degrees, `inside_shape` (the
      element's own mask; paint thins out toward its boundary instead of being cut), `colour_from form`. Length,
      angle, bend and spacing always vary (a floor under the recipe's irregularity). Tests:
      `tests/gesture-strokes.test.ts` (10).
- [x] M.5 Pressure shapes `taper` (default), `swell`, `even`, with jitter, on every generated stroke. Same test file.
- [x] M.6 (part) The tool's description names `follow_form`, `inside_shape` and one call per area. The painter's
      prompt is unchanged: it is at its size cap (`tests/prompt.test`), and the guidance belongs to the tool. Not done:
      a tool-choice scenario in `scripts/tool-choice-scenarios.json`.
- [ ] M.7 Live, in Toska: the Degas move 2 prompt again. First run 2026-11-14 (test chat be88ca00, 4576 x 6000, Luna
      on Guide, build of 590129be): **not passed.**
      - The painter used the new fields unprompted: 7 recipes, 1,720 strokes, all `colour_from form` and `pressure
        taper`, 4 of 7 `follow_form` (the floor and the seated dress), words for the wall and the skirt, no
        `inside_shape`, boxes as before. The form was read from the goal image (0.80 to 0.92 of it directed).
      - Luna undid the batch: "hard graphic look" and "texture over forms". No "mechanical stripes" this time.
      - The undo was right. The strokes were 200 to 480 px long, 50 to 100 px wide and 0.5 to 0.9 opaque: the wall's
        sweeps carried its pink across the picture frames and the standing woman's arm.
      - Before the recipes the painter called `paint_finish` (it did not in the baseline), which Luna kept: the
        canvas now has pleats in the skirt and hatching on the floor, the best brushwork result so far, from a tool
        that already existed.
      - Still one `paint_batch`, so one verdict; after the undo the move ended ("Luna sees little left to add"), so
        the correction was never acted on.
      Fix after the run: a stroke ends where the image's colour changes from its seed's (`COLOUR_CHANGE`), and takes
      the seed's colour; test added. Not yet rerun.
- [ ] M.8 The same on Shishkin (leaf stipple) and one painting with smooth blending (Rembrandt), so the fix is not
      fitted to one picture.

## 0. Before building

- [x] 0.1 Release 0.2.0-prealpha finished (2026-11-14).
- [x] 0.2 (part) The artist picked the library scheme: A, two shelves, materials and styles (2026-11-15, "yes"), and
      `make_brush` as the next thing built. Still open for the artist: the proposal's points 2 to 6.
- [ ] 0.3 Note in `stroke-generators/proposal.md` that this change takes it over (if the artist agrees).

## 1. Live checks that decide the mechanism

- [x] 1.1 A document made with `Krita.createDocument` and no view: `paintStrokes` paints on it and pixels read back
      (2026-11-15: 0 views, job done in 107 ms, 32,730 opaque pixels; 50 clears and repaints, the same count every
      time, the document never closed). Run in the installed Toska's own `kritarunner` (build 136f5ecc) in a temporary
      home, so the engine and the fork's API are the real ones. Not yet seen: the session checks in `creative_tools.py`
      and the running Toska window staying up; they need the plugin code and are part of 3.3.
- [x] 1.2 `presetProperties` with a `brush_definition` override changes the tip: one 200 px dab of `b) Basic-5 Size`
      covers 31,024 px with its round tip, 40,000 px with `MaskGenerator type="rect"`, 20,000 px with `ratio="0.5"`.
- [x] 1.3 A sensor curve set through properties changes the stroke. A pressure ramp 0.1 to 1 at size 80: as saved the
      stroke is 1 px high at its start and 74 px at its end; `PressureSize` false gives 80 and 80 (a boolean and the
      string `false` both work); a steeper `SizeSensor` curve gives 0 and 66 (set with `SizeUseSameCurve` false and
      `SizecommonCurve` written too, as the proposal says).
- [x] 1.4 A texture pattern named in properties loads: `Texture/Pattern/Enabled`, `Name` and `PatternFileName`
      ("Canvas 04", `Crumpled_Paper.pat`) turn a flat 200 px stroke (alpha deviation 0) into a textured one (deviation
      40, 160,387 pixels changed). No MD5 was needed; libkis's `Resource` does not expose one.
- [ ] 1.5 (part) Read in code: `paint_from_reference` and `paint_reference_surface` send every chunk as a `paint_pass`
      with a `preset` (`reference-tool.mjs`, the pass arguments), and nothing in the plugin accepts properties from a
      caller (`_creative_stroke_job` builds `presetProperties` from the mixing options only). So `brush` accepted by
      `paint_pass` and expanded in `_creative_stroke_job` reaches both tools' dabs in one place. Seen live: with 3.5.
- [x] 1.6 What 1.1 to 1.5 showed is in the proposal ("What the live checks showed"). No check failed, so the
      mechanism stands. The script and its results: `local-notes/wikiart-study/mechanism-checks/`. A constraint for
      3.3: `numpy` is not importable in `kritarunner` (the plugin's `vendor.py` adds it), so the checks measured with
      plain bytes.

## 2. Library

- [ ] 2.1 `src/library/` (TypeScript): layout, name rules, the three places (bundled, artist's, study), later wins,
      a bad file reported by name and field and skipped. Tests.
- [ ] 2.2 `material.yaml` schema and the bundled materials (soft pastel, oil, watercolour, ink, charcoal, gouache,
      tempera) with base presets chosen from the brush catalogue.
- [ ] 2.3 Test chats take a library folder (the study library), so kept items carry between chats; the same switch
      for the effects folder.
- [ ] 2.4 Promote: copy a named study item, with what it depends on, into the artist's library.

## 3. make_brush

- [x] 3.1 Settings vocabulary to a recipe (`src/brush-recipe.ts`, tests in `tests/brush-recipe.test.ts`): tip (shape,
      diameter, ratio, softness, spikes, density, angle, randomness), spacing, scatter, opacity, flow, build, blend,
      respond (seven settings, seven pen inputs, a curve of 2 to 5 points), smudge and texture, each inside a range and
      refused with its field named. Engines: `paintbrush` (101 of Toska's 137 presets) and `colorsmudge` (16). Key
      names come from the presets themselves (`local-notes/wikiart-study/mechanism-checks/engine-keys.json`). The tip
      goes to the plugin as a change (`replace` with a new generated tip, or attributes set on the base preset's own
      tip), because spacing and angle live inside the base's `brush_definition`, which only the plugin can read. Left
      out: `bristle` (one bristle preset, no checked vocabulary; refused with a message). Not yet seen live: the
      texture strength keys and the `distance` input.
- [x] 3.2 (part) `kritamcp/brush_maker.py` (`expand`, pure, 12 tests in `tests/test_brush_maker.py`): the recipe's
      fields, the base preset's engine, every key (a key of the engine in `brush_engine_keys.json`, not another
      engine's, and of a form a recipe may set), every value (switches, ranges, one pen input with a curve), the tip
      change applied to the base's `brush_definition` (a generated tip replaced or patched; an image tip takes spacing
      and angle only), the pattern's file name added, and the blend mode handed back as the job's own option.
      Found on the way and fixed in 3.1: the flow response has no switch, and Color Smudge has no flow curve, softness
      response or build mode; pixel-brush presets carry leftover smudge keys, so one-engine keys are listed by hand.
      Seen on the real engine 2026-11-15 (the installed Toska's `kritarunner`, recipes from `brush-recipe.ts` through
      `expand` into `paintStrokes`; `local-notes/wikiart-study/mechanism-checks/chain.json`): tip shape and ratio,
      softness, spacing, size response off and steeper, opacity, flow, opacity following pressure, scatter, a texture
      and a fuzzy rotation each change the swatch measurably. Settled with the swatch sheet (3.3): the smudge settings do work (a strong and a weak smudge rate
      differ in 223,693 pixels of the sheet; the first check was at fault, it gave the blender nothing to drag), and
      texture strength is out of the vocabulary: 0.2 laid a third of the ink of 1, so it fades the paint, not the
      texture. Still to do here: the brush registry and `brush` wired into `paint_pass` (3.5).
- [ ] 3.3 (part) The scratch document and the swatch sheet. Built: the operation `brush_swatch {preset | recipe,
      out_path, size?}` (`kritamcp/brush_craft.py`, registered in `cmd_creative` beside `effect_preview`); one fixed
      sheet (`brush_maker.swatch_sheet`: a pressure ramp, an S curve, five swelling strokes, twelve dabs from light to
      full, two colours crossed) painted on a 1600 x 1000 scratch document with no view, cleared before each swatch, a
      PNG into the chat folder. A blender gets two colours in stripes to drag, since it lays no paint of its own.
      Tests: `tests/test_brush_swatch.py`. Seen on the real engine 2026-11-15 (the installed Toska's `kritarunner`
      with the plugin's own numpy and OpenCV; sheets in `local-notes/wikiart-study/mechanism-checks/swatches/`): ten
      swatches, each readable; the same brush twice gives the same file byte for byte.
      Two things the real run showed, both fixed: (1) Krita lists a document with no view among its documents, so the
      scratch document would have appeared in the panel's list and tripped "no other document open":
      `creative_document_identity.open_documents` now leaves hidden documents out (`hide_document`). (2) Held while
      the process shut down, the scratch document crashed it at exit (exit 139, "tiles have leaked"); the plugin now
      lets go of it on Qt's `aboutToQuit` (`_brush_release`), and with that the runner exits cleanly.
      Still to do: seen in the running Toska (a swatch through the bridge, the window staying up, the panel's
      document list unchanged, quitting clean), which needs a build, a package and an install. In the runner's fresh
      profile `k) Blender Basic` could not load its own texture pattern (a warning per stroke); to look at in Toska.
- [ ] 3.4 (part) `make_brush` (`src/brush-maker-tool.ts`, 9 tests): the base preset's sheet and the new brush's
      (`brush_swatch`, which now also names the base's engine), Luna's blind choice between them as A and B in a drawn
      order (the mark's sentence, a close-up of the reference when `crop` is given, never a setting or which sheet is
      which), saved only when the new one wins, 4 tries a brush in a chat, a brush that never wins refused and recorded
      (`brush_failed` event, for goal 4). Sheets that come out the same are not a brush and Luna is not asked.
      The library's brushes shelf (`src/library/brushes.ts`, 6 tests; this is 2.1 for brushes only): scheme A,
      `<data folder>/library/materials/<material>/brushes/<name>.yaml` with its swatch `.png`, the file in the
      vocabulary's own words, its recipe worked out again on every load, a bad file skipped with its file and field.
      Offered only with the new setting **Painting skills (experimental)** on (`painting_skills`, off by default; this
      is 10.2's Enable) and in Toska (swatches are stroke jobs).
      Claude's calls, for the artist to change: (1) with no decision model, or no answer, the brush is kept marked
      `unjudged` and the result says so, so that an artist without Decision checks can still make brushes; the proposal
      said "kept only when the new one wins". (2) Every call counts as a try, a kept one too.
      Still to do: live in Toska (3.7), and Reset for the setting (10.2).
- [ ] 3.5 (part) Painting with a made brush. A pass names it where a preset goes, as `"<material>/<name>"`
      (`src/pass-brush.ts`, wrapped around `paint_pass` last, so `paint_batch` and the mixing policy get it too): the
      pass paints with the brush's base preset and carries its recipe as `brush_recipe`; the plugin checks it again
      (`validate_pass`, `brush_craft._brush_for_pass`: the recipe's base must be the pass's preset) and sets its
      properties on the stroke job, what the pass itself asks (a mixing model, a blender's overlay) winning; a recipe
      that does not check paints nothing; Toska only. Tests: `tests/pass-brush.test.ts`, `tests/test_brush_pass.py`.
      Claude's call: the brush goes in the `preset` field, not a separate `brush` field as the proposal said, so every
      tool that already takes a preset can name one without a new field each. Still to do: `paint_recipe` and the
      reference tools (they read the preset's catalogue card before the pass is made; not yet looked at), and live.
- [x] 3.6 Library brushes in `list_brushes`: with painting skills on, the result carries `made_brushes` (the value
      to give as `preset`, the material, the mark, the base preset, who judged it; at most 40) and a line on how to
      paint with one (`madeBrushCards`, `tests/brush-library.test.ts`). When to make a brush is said in `make_brush`'s
      own description, which the painter reads with the tool; no line was added to the prompt.
- [ ] 3.7 Live: one brush made, kept and painted with on a 6000 px canvas.

## 4. Brushwork score

- [x] 4.1 (part) `src/brushwork-score.ts`: per crop, direction histogram and local agreement, contrast by scale, edge
      density and sharpness, colour left out; `brushworkScore(original, canvas)` 0 to 100. In the companion on decoded
      crops, not in the plugin. Tests on synthetic marks (`tests/brushwork-score.test.ts`, 4): the same marks 100,
      marks blended away, turned, coarser or replaced by stipple each at least 15 lower. Not wired to anything.
- [ ] 4.2 Calibration. First try 2026-11-14, on what exists: **it does not order them, so the score is not to be used
      yet.** Degas, five crops: the dabbed copy 81 to 88, an offline render of the rejected stripes 80 to 90, an
      offline render of `follow_form` 73 to 81; Shishkin's dabbed copy 87 to 89. Two reasons, both about the material
      and one about the score:
      - the saved results are 1,196 px copies of 6,000 px canvases and the offline renders are plain lines, not
        Krita's engine: a crop is about 230 px, where brushwork hardly shows. Calibration needs the canvas's own
        pixels (a region look at full size) from a live run;
      - the WikiArt original is itself 1,382 x 1,812 px, drawn 3.3 times larger on the canvas: its close-ups are
        about 270 px across. What separates the original from the dabbed copy at that size is real but small (fine
        contrast 0.28 to 0.35 of the total against 0.18 to 0.24; 2 to 5 times the edge density), and the parts'
        mapping to a score is too lenient to show it (most parts read 0.9).
      Next: crops at canvas resolution from M.7, then set the mapping so the dabbed copy lands well below the
      original, and only then use it. For the study: prefer larger sources than WikiArt's (museum open-access
      images) for anything that learns brushwork from close-ups.
- [ ] 4.3 Luna's blind pair question for brushwork in a crop, checked against 4.2.
- [ ] 4.4 Names: `study_brushwork`, `study_*`; nothing reads them at run time.

## 5. Style skills and Learn

- [ ] 5.1 Skill header schema, section check, length cap, references to brushes and techniques resolved. Tests.
- [ ] 5.2 Catalogue in the tool help (capped), `use_style`, `/style`, the host's offer when a style is named.
- [ ] 5.3 Learn as a skill for the painter (instructions only): choose crops, name the material, make brushes, write
      the skill. `/learn-style` for the artist.
- [ ] 5.4 Live on Degas: brushes kept, skill written, files where the scheme says.

## 6. Runner: Copy

- [ ] 6.1 `scripts/study-run.ts`: driver socket, keep-card answers, budgets, stop and resume, a record per task. The
      waiter's exit conditions checked on real `/state` first, with a deadline.
- [x] 6.1a The Langfuse tag `wikiart-study` (proposal goal 6): `TOSKA_TRACE_TAG` in `src/test-env.ts` (one allowed
      value), appended by `traceInfo`, on decision traces and on the closing `end-chat` trace; the tool's description
      names it; unit tests (`tests/trace-tag.test.ts`). Langfuse keys in Toska's project folder `.env`. Live
      2026-11-15, installed build 136f5ecc, 6000 x 4500: test chat baac921e started with the key, all 7 of its traces
      (20 observations, `end-chat` among them) found in Langfuse by the tag; test chat c73e270f started without it,
      5 traces, none tagged; a made-up tag finds nothing. Langfuse's old traces API is refused for this organisation:
      read with `/api/public/v2/observations` and a `tags` filter. Left for later: a comment in `test-companion.ts`
      names only the older key; the driver and Python client tests do not exercise the new key; a Toska launched from
      a shell that exports the key would tag the artist's chats too.
- [ ] 6.2 Fix: the painter asking for the canvas it has already observed.
- [ ] 6.3 Copy without and with the skill on Degas and Shishkin; table against the baselines.

## 7. Tinker and Transfer

- [ ] 7.1 The fixed change list and the Transfer subjects (as the artist decides).
- [ ] 7.2 Scores: change present, rest untouched, new paint against the style's measurements; Luna's style pick of four.
- [ ] 7.3 Both on Degas and Shishkin.

## 8. Techniques

- [ ] 8.1 Blocks (`seeds`, `direction`, `mark`, `repeat`, `tone`, `colour`) with tests; the not-tracing rule as a test.
- [ ] 8.2 Recipe schema and engine reusing the effects reader; `paint_technique`; bundled `flow-strokes`, `hatching`,
      `soft-fill`.
- [ ] 8.3 The build: candidates on the scratch document, Luna's blind choice, the card, `policy.yaml`,
      `/new-technique`, the failed-brush trigger in the study.
- [ ] 8.4 Live: hatching on Degas; a dot technique on a pointillist painting from the hundred.

## 9. The study

- [ ] 9.1 The ten (Chagall private): one table, a page of findings, the features they call for.
- [ ] 9.2 The artist looks at the ten before the hundred is sampled.
- [ ] 9.3 About 100 through the rows API; the same table.

## 10. Owed around it

- [ ] 10.1 Custom effects: tick tasks 1 to 8, correct the proposal's status, run task 9 live.
- [ ] 10.2 Settings › Painting skills (experimental): Enable and Reset.
- [ ] 10.3 The library in the panel's Brushes tab, by material and by style (after 9.1).
- [ ] 10.4 Later: fork API to save a library brush as a real preset with a generated tip.
