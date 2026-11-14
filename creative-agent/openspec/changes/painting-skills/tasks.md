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
- [ ] M.7 Live, in Toska, on a copy: the Degas move 2 prompt again. Pass: Luna keeps at least the floor and one dress
      area, and the close-ups show directional hatching. Say exactly what ran.
- [ ] M.8 The same on Shishkin (leaf stipple) and one painting with smooth blending (Rembrandt), so the fix is not
      fitted to one picture.

## 0. Before building

- [x] 0.1 Release 0.2.0-prealpha finished (2026-11-14).
- [ ] 0.2 The artist picks the library scheme and confirms or changes the open points in the proposal.
- [ ] 0.3 Note in `stroke-generators/proposal.md` that this change takes it over (if the artist agrees).

## 1. Live checks that decide the mechanism

- [ ] 1.1 A document made with `Krita.createDocument` and no view: `paintStrokes` paints on it, pixels read back, the
      session checks (`creative_tools.py` around the session guard) pass, Toska stays up through 50 clears and repaints.
      It is never closed in the check.
- [ ] 1.2 `presetProperties` with a `brush_definition` override changes the tip (a round and a rectangle tip give
      measurably different swatches).
- [ ] 1.3 A sensor curve set through properties changes the stroke (pressure to size, on and off).
- [ ] 1.4 A texture pattern named in properties loads, or is recorded as not possible this way.
- [ ] 1.5 Which of `paint_from_reference` and `paint_reference_surface` can take a preset and properties for their
      dabs, read in code, then seen live.
- [ ] 1.6 Write what 1.1 to 1.5 showed into the proposal; change the mechanism where a check failed.

## 2. Library

- [ ] 2.1 `src/library/` (TypeScript): layout, name rules, the three places (bundled, artist's, study), later wins,
      a bad file reported by name and field and skipped. Tests.
- [ ] 2.2 `material.yaml` schema and the bundled materials (soft pastel, oil, watercolour, ink, charcoal, gouache,
      tempera) with base presets chosen from the brush catalogue.
- [ ] 2.3 Test chats take a library folder (the study library), so kept items carry between chats; the same switch
      for the effects folder.
- [ ] 2.4 Promote: copy a named study item, with what it depends on, into the artist's library.

## 3. make_brush

- [ ] 3.1 Settings vocabulary to engine properties (`src/brush-recipe.ts`), per engine, with ranges. Tests for every
      setting, the shared-curve rule and the tip XML.
- [ ] 3.2 `kritamcp/brush_maker.py`: check base, engine, keys, ranges, tip; expand `brush` to preset plus properties;
      always pass `size`. Tests.
- [ ] 3.3 The scratch document and the swatch sheet; PNG into the chat folder. Tests with the fake plugin; live once.
- [ ] 3.4 `make_brush` tool in `paintingTools()`, the Luna A/B check against the base swatch, 4 tries, save on a win.
- [ ] 3.5 `brush` accepted wherever `preset` is (`creative_validation.py`, `paint_pass`, `paint_batch`,
      `paint_recipe`, the reference tools as 1.5 allows).
- [ ] 3.6 Library brushes in `list_brushes` with their own cards; one line in the prompt on when to make a brush.
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
