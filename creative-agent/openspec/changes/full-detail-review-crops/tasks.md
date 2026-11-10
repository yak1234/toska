# Tasks: full-detail review crops

Tests first, seen failing. Agent: `npm run -s test:unit`, `npm run -s typecheck`. Plugin: `uv run` with pyqt5 and pyqt6.

- [x] 1.1 `review_crops.py`: `pick_windows` (numpy: the most detailed and the median window, deterministic) and the
      `review_crops` operation (whole crop by scaled read, 1:1 tiles, painting tiles, guides refused, bounded reads).
      Test: `tests/test_review_crops.py` (real Qt in a child process, a stub document).
- [x] 1.2 One line in `creative_tools.py` beside `observe`.
- [x] 2.1 `blank-canvas.ts`: `detailPlan(map, canvas)` (the fresh box and the untouched painted ninths in canvas
      pixels), `parseReviewCrops`. `NewGround` carries `detail` and `tiles`. Unit tests.
- [x] 2.2 `visual-checks.ts` `newGroundCheck` takes `tiles`; labelled parts with their scale; wording added only with
      tiles (`visual-check-questions.json`). Unit tests.
- [x] 2.3 `studio.mjs` `newGroundImage`: `review_crops` first, the view crop on any failure; the route and tile boxes
      on the review record and in a diagnostic.
- [x] 3.1 Unit, typecheck and the plugin test pass.
- [ ] 3.2 Live in Toska on a copy of a large painting: the record says `detail: document`; time of the operation.
- [ ] 3.3 Labelled cases with 1:1 tiles; check `same_finish` at 0.5.

## Results (2026-11-10)

- 3.1: unit 1,401 pass, 1 skipped, 0 fail (with the sharpen-patch-references work in the tree); typecheck clean;
  `tests/test_review_crops.py` 5 pass under PyQt5 and PyQt6; the plugin suite passes.
- 2.3 has no unit test: the studio's route (`newGroundDetail`, the fallback to the view) is covered only by its parts.
- Not run: 3.2 (nothing was run in Toska) and 3.3. Luna was not asked anything with tiles. The wording without tiles
  is unchanged, so the ten labelled cases were not asked again.
