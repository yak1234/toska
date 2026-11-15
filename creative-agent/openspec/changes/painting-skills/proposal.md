# Painting skills: the agent makes its own brushes, learns styles and builds stroke tools

Status: DRAFT (2026-11-14). The artist's decisions are marked "the artist"; everything marked "Claude's proposal" is
open until the artist confirms it. The library layout below assumes scheme A (two shelves), which the artist has not
picked yet. `mechanical-strokes.md` in this folder is the part built first (hand strokes that do not come out
mechanical); its first tasks are built, see `tasks.md` section M.

## Why

The artist (2026-11-14): "run almost like a scientific test run ... to have it recreate it and imagine what we'd learn
from the notes and the features we would need to build"; "what if it was allowed to create its own brushes and tools if
needed to improve the process"; "is there a way to really make the individual painting skills and for it to learn
painting styles and paint from all this?"; "I want all these to be organized by art style or art tools artists would
recognize".

Two baseline copies (WikiArt, 6000 px, `local-notes/wikiart-study/results/notes.md`) showed where Toska stands:

- Colour and placement are solved by one tool. One `paint_from_reference` call took Shishkin from dE 52.8 to 0.3 and
  Degas from 51.5 to 0.3. The likeness score cannot tell a good painting from a blurred copy.
- Brushwork is not solved. Shishkin's leaves and Degas's directional pastel hatching both came out as the same small
  soft dabs.
- Asked directly for brushwork, the painter understood the job (it named "floor sweeps, wall drags, skirt and bodice
  pulls") and stated it as seven `paint_recipe` calls, 1,070 strokes with catalogue brushes. Luna undid all of them:
  "mechanical stripes, hard graphic look". The intent was right; the generator could say only one direction word per
  rectangle, clipped at the rectangle, with one pressure (`mechanical-strokes.md`).
- Nothing measures brushwork, so a uniform dabbed copy counts as finished.

So the painter needs better means (brushes that make the mark, stroke tools that place many marks well), written
knowledge of how a style uses them, and a measure that rewards brushwork. Copying cannot prove any of that, so the
study also asks for changes to a painting and for new subjects in a learned style.

## The idea in one paragraph

A **brush** is a recipe: a base Krita preset plus engine settings, made by the painter with `make_brush`, tested on a
swatch beside a close-up of the original and kept only when it is closer than what it started from. A **style skill**
is a short written file for one style in one material ("Impressionism, soft pastel"): palette, which brush on which
surface, stroke length and direction, edges, build order. A **technique** is a stroke tool the painter builds from
declarative blocks when no brush setting can make the mark (pointillist dots, cross-hatching, woodcut lines), the way
Custom effects builds fog. All three live in one **library** organised by material and by style. A **study runner**
takes paintings through Learn, Copy, Tinker and Transfer and scores brushwork, so each addition is kept or dropped on
evidence. No model is trained and no agent-written code is ever run: brushes and techniques are checked data, skills
are text.

## Settled by the artist (2026-11-14)

1. Learning is A (brushes from engine settings plus written style skills) and B (self-built stroke tools). Not C
   (training a model on WikiArt).
2. The library is organised by art style and by tools artists recognise.
3. `paint_from_reference` stays and is valued. It decides colour and place; the style skill decides how paint goes on.
4. The copy baseline stops at two paintings. Toska is restarted when needed without asking, after checking that it is
   idle and nothing is unsaved.

## Goals

### 1. The library (scheme A, awaiting the artist's pick)

Two shelves, because a material's marks are the same in every style and a style may use several materials:

```
library/
  materials/<material>/            soft-pastel, oil, watercolour, ink, charcoal, gouache, tempera
    material.yaml                  name artists use, one line on what it is, base presets worth starting from
    brushes/<brush>.yaml + .png    recipe and its swatch              (stick-side, impasto, wash, pen-line)
    techniques/<technique>.yaml + .png                                (hatching, pointillist-dots, woodcut-lines)
  styles/<style>/<material>.md     one skill per style and material   (impressionism/soft-pastel.md)
  styles/<style>/<material>.after-<artist>.md   a variant, only when two hands differ too much for one recipe
  studies/<study id>/              what taught it: the painting's facts, the close-up crops, their measurements
```

- Names are the words painters use, lowercase with hyphens on disk, written out in the panel ("Soft pastel: stick
  side"). Style names start from WikiArt's 27.
- Every brush, technique and skill records `learned_from` (study ids), so the evidence is one step away.
- A skill names brushes and techniques as `<material>/<name>`; the loader refuses a skill that names one that does not
  exist, with the file and the name.
- Three places, later wins by name: bundled with the companion (`library/`), the artist's own (Toska's data folder,
  never a painting's folder), and a **study library** the runner writes to. Study items reach the artist's library
  only by an explicit promote step, so a hundred-painting run cannot fill the artist's shelves with rejects.
- Custom effects stay their own shelf (`effects/`): weather and atmosphere are not a material.
- WikiArt has no material field. The painter names the material when it studies a painting; the artist can move a
  skill to another material by renaming the file.

### 2. `make_brush`

- **Tool** (strict TypeScript, `src/brush-maker-tool.ts`): `make_brush { material, name, mark, base, settings, crop? }`.
  `mark` is one sentence on the mark it should make. `base` is a catalogue preset. `settings` is a small vocabulary,
  not raw engine keys:
  - `tip`: shape (round, rectangle), diameter, ratio, softness, spikes, density, angle, randomness;
  - `spacing`, `scatter` (amount, axes), `opacity`, `flow`, `build` (wash or build-up), `blend`;
  - `respond`: for size, opacity, flow, rotation, scatter, softness, ratio: which pen input drives it (pressure,
    speed, drawing angle, fade, distance, fuzzy per dab, fuzzy per stroke) and a curve of up to 5 points;
  - `smudge` (colour rate, smudge rate, smear or dull, radius), `bristle` (scale, shear, random, density, ink amount),
    `texture` (a library pattern, scale, strength).
- **Recipe**: the companion turns the settings into `{ base_preset, engine, properties }`. The plugin
  (`kritamcp/brush_maker.py`) checks that the base exists, that its engine is the recipe's, that every key belongs to
  that engine (engines ignore unknown keys silently, so an unchecked typo would look like success), that every value is
  in range, and that a tip definition parses. When a curve is set, both the sensor's own curve and the shared curve are
  written (the shared one otherwise wins).
- **Swatch**: one fixed sheet per brush (a pressure ramp, a curve, five parallel strokes, a dab cluster, two colours
  overlapped), painted by `paintStrokes` with `presetProperties` on one scratch document that has no view, made once
  per session, cleared between swatches and never closed mid-session. `brush_probe` is never called. The painter gets
  the swatch beside the crop.
- **Keep or discard**: Luna sees the base preset's swatch and the new one as A and B beside the crop, blind, and says
  which is closer in mark. Kept only when the new one wins. At most 4 tries per brush; a brush that never wins is not
  saved and the failure is recorded for goal 4.
- **Painting with it**: every tool that takes `preset` also takes `brush: "<material>/<name>"`: `paint_pass`,
  `paint_batch`, `paint_recipe`, and the dabs of `paint_from_reference` and `paint_reference_surface`. The plugin
  expands the name to base preset plus properties and always passes `size` (stroke bounds are computed from the base
  preset before properties apply). This is how the artist's decision 3 is met: the reference tool keeps choosing
  colour and place, with the skill's brush.
- **Later, not in this change's first pass**: a small fork API to save a library brush as a real Krita preset with a
  generated tip, so it also appears in Krita's own preset list.

### 3. Style skills

- **File**: Markdown with a checked header (`style`, `material`, `after`, `learned_from`, `brushes`, `techniques`,
  `palette` as up to 12 hex colours with a word each) and fixed sections, about 400 words at most:
  **Surfaces** (for each surface the style paints, such as skin, cloth, floor, foliage, sky: brush, stroke length as a
  share of the canvas, direction rule, pressure, how much strokes overlap, edge kind), **Build order**, **Edges**,
  **Avoid**.
- **Who writes it**: the Learn task (goal 6), or the artist in a chat with `/learn-style` and an attached painting.
  The artist can edit any skill by hand; it is checked on the next load.
- **How the painter gets it**: a host-side catalogue, one line per skill (style, material, cue), in the painter's tool
  help, and one tool `use_style { style, material }` that returns the skill. The prompt grows by a line per skill and
  is capped (beyond 30, only style names are listed). The host offers the matching skill when the artist's message or
  the goal's study note names a style; `/style <name>` asks for one outright.
- **Kept on evidence**: a skill from the study is kept when Copy with the skill scores higher on brushwork (goal 5)
  than Copy without it on the same painting, and Luna keeps the move.

### 4. Techniques: stroke tools the painter builds

When the best brush still loses its swatch check twice for the same mark, the mark is not a brush problem: it is a
placement problem (many dots, ordered lines). The painter then builds a technique.

- **Blocks** (plugin and companion code, tested like effect blocks; a fixed small set):
  - `seeds`: where marks start (grid, jittered grid, even scatter), with spacing as a share of the area;
  - `direction`: one angle, the reference's flow, around the area's centre, noise;
  - `mark`: dot, dash, line, curve, zigzag, with length, bend and a pressure shape (taper, swell, even);
  - `repeat`: the same again at an angle offset (cross-hatching), up to 3 times;
  - `tone`: density, length or pressure following the reference's or the canvas's lightness (denser hatching in the
    dark, thicker woodcut lines);
  - `colour`: sample the reference, sample the canvas, a palette, or split a sampled colour into purer neighbours
    (pointillism).
- **Recipe**: YAML like an effect recipe (name, cue, lesson, evidence, options with limits, blocks), read by the same
  expression reader and the same kind of schema. It produces strokes, painted by Krita's engine with a library brush
  on the move's own layer, one reversible pass.
- **One tool**: `paint_technique { technique, area, brush?, options }`, with the catalogue in the tool help, as
  `paint_effect` does.
- **A build**: 2 or 3 candidate recipes, each rendered on the scratch document (strokes need Krita's engine, so not in
  numpy as effects are), Luna chooses blind beside the crop, then the same Keep, Try again or Discard card. Budget and
  triggers sit in `policy.yaml`. In a normal chat a build starts only by `/new-technique`; the study starts one from
  the failed-brush rule above.
- **Not tracing** (the artist, 2026-10-23, carried over from `stroke-generators`): strokes fill and model areas; they
  start inside an area and stop before strong edges; no block follows an outline.
- **Claude's proposal**: this goal takes over `stroke-generators` (approved 2026-10-23, never built). Its
  `paint_generated_strokes` becomes `paint_technique` with bundled techniques (`flow-strokes`, `hatching`,
  `soft-fill`), and today's `paint_recipe` jitter generator becomes the `seeds` block.

### 5. A brushwork score (Claude's proposal)

- Measured on **close-up crops**, never the whole picture: 4 to 6 named surfaces per painting, chosen at Learn.
- Colour is left out. Per crop: the spread and strength of stroke direction, the size of marks (energy by scale), and
  edge density and sharpness. The distance between the original's crop and the canvas's gives 0 to 100.
- Luna gives the second opinion, blind: of two canvases' crops, which is closer in brushwork to the original's.
- **Calibrated before it is trusted**: an original against itself must score near 100; the two baseline copies (soft
  dabs) low; the 1,070 rejected stripes low; if it cannot order those, it is not used.
- For Tinker and Transfer there is no aligned original, so new paint is compared with the style's stored measurements
  for the same kind of surface.
- These are study scores, written as `study_brushwork` and `study_*`. They never grade or steer Luna at run time.

### 6. The study runner

- A developer script in the companion (`scripts/study-run.ts`), not part of the app. It drives the test driver
  socket, answers keep cards, enforces a time and cost budget per task, can be stopped and resumed, and never touches
  a document it did not open.
- **Per painting, four tasks** (Claude's proposal):
  1. **Learn**: look at the whole and at the crops, name the material, make brushes (goal 2), build a technique if
     needed (goal 4), write the skill (goal 3).
  2. **Copy**: a new canvas, the original attached, painted twice: without the skill and with it. Scored on brushwork
     in the crops, with likeness as a floor.
  3. **Tinker**: from the Copy result, one set change from a fixed list (add an object, change the light, extend the
     canvas). Scored on: the change is there (Luna), the rest is untouched (likeness outside the changed area), the
     new paint's brushwork matches the style.
  4. **Transfer**: a different subject in that style, with no original attached. Scored on brushwork against the
     style's measurements and on Luna picking the right style out of four, blind.
  Tinker and Transfer are the scores that mean something: a pixel copy cannot pass them.
- **Record** per task: the image, scores, tools called, time, cost, questions asked, faults. One table per run.
- **Langfuse tag `wikiart-study`** (the artist, 2026-11-15: "a special tag"; design approved the same day). Every
  trace of a study chat carries the tag, so one filter shows the whole study.
  - How: a second key in the test chat's environment allow-list (`src/test-env.ts`), `TOSKA_TRACE_TAG`, whose only
    allowed value is `wikiart-study`. `traceInfo` (`studio.mjs`) appends it to the tags when it is set, and Luna's
    decision traces carry it too. The runner starts each chat with `env: {TOSKA_TRACE_TAG: "wikiart-study"}`.
  - Keys: test chats were untraced, because Toska's project folder had no `.env`. The three Langfuse lines are copied
    there from `digital_art/.env`. This also traces the artist's own Toska chats, which stay untagged.
  - Considered and not chosen: a free `tags` list passed through the start command and stored on the chat (five files
    against two, for free-form tags nobody has asked for).
  - Not in this step: per-painting details (style, title, the original's and the canvas's dimensions) as trace
    metadata, and scores per chat. They come with the runner (6.1).
- **Scale**: the ten paintings in `originals/` first (Degas and Shishkin have baselines), then about 100 sampled
  through the rows API. Chagall (09) is in copyright: private tests only, never in a published file or image.
- **Run rules** (from earlier live tests): 6000 px on the long side, the usual test painter model, no other document
  open, idle checked before any restart.

### 7. Faults the baseline found, fixed first

- The painter asked the artist to attach the canvas after observing it itself, although told not to ask.
- One move, then it waits at the keep card despite "keep going": the runner answers the card; whether Autopilot should
  carry on by itself is checked against the mode's rules, not changed blindly.
- Custom effects part 1 is built and switched on but recorded as unbuilt: tick its tasks 1 to 8, correct its proposal,
  run its live check, and make kept effects (and this library) carry between test chats.

## Settings and safety

- **Settings › Painting skills (experimental)**: Enable (off for a new install) and Reset (removes the artist's own
  brushes, techniques and skills after a confirmation; bundled ones stay).
- A brush recipe can only set checked keys of its engine inside limits. A technique can only choose among the bundled
  blocks inside caps on stroke count and time. Neither can read or write files, reach the network or run code.
- A skill's text is long-form guidance by nature, so it is limited instead: a checked header, fixed sections, a length
  cap, and only local files (bundled, the artist's, the study's). There is no sharing or download.
- A bad file is reported by name and field and skipped; it never stops a chat.

## Build order (Claude's proposal)

1. Live checks that decide the mechanism: a viewless scratch document is safe; `presetProperties` rebuilds a tip and
   loads a texture pattern.
2. The library loader and `make_brush` with swatches.
3. The brushwork score, calibrated on the baseline images, because every keep-or-discard after this needs it.
4. Style skills and the Learn task.
5. The runner with Copy; rerun Degas and Shishkin against their baselines.
6. Tinker and Transfer.
7. Techniques, once the ten paintings show which marks brushes could not make.
8. The ten, then the hundred. The library in the panel's Brushes tab comes after the numbers say it is worth showing.

## Non-goals

- No model training, no fine-tuning, no dataset download beyond the sampled images.
- No agent-written code, scripts or plugins at run time.
- No change to how `paint_from_reference` chooses colour and place.
- No reference image placed as a plain layer.
- No sharing of brushes or skills between artists.
- No aids for painting by hand.

## Anti-goals (failure even if it technically works)

- A skill that raises the score while the painting looks worse to the artist.
- A library full of near-identical brushes, or of study rejects on the artist's shelves.
- A brush tool that reports success for a setting the engine ignored.
- A chat that stops to build brushes when the artist only asked for a quick change.
- The painter's prompt growing with every kept item.

## Done when

On the Degas pastel: Learn produces at least two soft-pastel brushes that win their swatch checks and an
"Impressionism, soft pastel" skill; Copy with the skill shows directional hatching in the floor and wall crops, scores
clearly higher on brushwork than the baseline dabs, and Luna keeps the move; Tinker adds a figure in the same hatching
with the rest unchanged; Transfer paints another subject that Luna picks as this style out of four. The same run on
the ten paintings gives one table, and the artist can open the library and find every item under a material or a
style they recognise.

## Open for the artist

1. The library scheme (A recommended) and whether "after <artist>" is an occasional variant.
2. The four tasks and the brushwork score.
3. The build order.
4. Techniques taking over `stroke-generators`.
5. Study items staying in a study library until promoted.
6. What Transfer paints: Claude's proposal is each painting's subject swapped with another painting's in the set
   (the Shishkin forest in Degas's pastel), so no new images are needed.
