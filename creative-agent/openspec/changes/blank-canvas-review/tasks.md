# Tasks: blank-canvas review

Write each test first and see it fail. Agent tests: `npm run -s test:unit`, `npm run -s typecheck`. Plugin tests: `uv run`
with pyqt5 (and pyqt6 for panel scripts). Live steps on a copy of a painting, in Toska, with no painting running.

## 1. Measure (plugin)

- [ ] 1.1 `blank_canvas.py`: `change_map(before, after, width, height, tolerance)` on two RGBA thumbnails of one size:
      `fresh_share`, `removed_share`, `changed_share`, `fresh_box` (fractions of the view), and per ninth `empty_before`,
      `fresh`. Pure Python, no Qt. Tests: half-empty canvas with a copy added (fresh 1, removed 0); paint over paint
      (fresh 0); a painted half hidden (removed high); nothing changed; a JPEG-noisy empty area still counts as empty.
- [ ] 1.2 `change_map` operation in `creative_tools.py`: two images (base64 or paths inside the chat folder), decoded
      and reduced with Qt, answered from 1.1. Read-only, works while a pass is queued.

## 2. Decide (companion)

- [ ] 2.1 `src/blank-canvas.ts`: `batchKind(map)` (over | new_ground | mixed), `emptyCells(map)`, `factsText(map)`,
      `removed(map)`, `dropFreshFindings(findings, map)`. Thresholds exported. Unit tests for each.
- [ ] 2.2 `new_ground` question in `visual-check-questions.json`; `newGroundCheck` in `visual-checks.ts` (one request,
      the facts text, the crop). `moveCheck` takes optional `facts` and puts them first in `parts`.
- [ ] 2.3 `reviewHost.review` in `studio.mjs`: call `change_map`; by kind call `moveCheck`, `newGroundCheck` or both;
      crop through the existing `comparison_crop`; on any error fall back to today's `moveCheck` alone.

## 3. Act (review extension)

- [ ] 3.1 `luna-review.ts`: a `new_ground` verdict is recorded and never undone; the note names what it reads as.
      `artwork_removed` is undone like any finding. Tests in `tests/luna-review.test.mjs`.
- [ ] 3.2 `recordMoveReview`: the move keeps `new_ground` (last verdict); `needs_artist` is set when every batch was
      undone, Luna stopped the move, or the last three moves read `placeholder`. The card line says why.
- [ ] 3.3 Panel: the move card's Auto-approve offer is skipped while `needs_artist` (panel test under PyQt5 and PyQt6).

## 4. Transfers

- [ ] 4.1 "Uncertain outcome" carries the plugin's reason (`result.error`). Unit test.
- [ ] 4.2 Reproduce the first-chunk stop live on a copy of Istanbul; record the reason here.
- [ ] 4.3 Fix it, with a test that fails first.

## 5. Check it

- [ ] 5.1 Truth set: the chat's ten pairs with hand labels in `local-notes/`; a script runs the new review over them
      against Luna. Record the answers here.
- [ ] 5.2 Unit, typecheck and plugin suites pass.
- [ ] 5.3 Live in Toska on a copy of Istanbul: the painter's clone onto the empty half is kept; a transfer runs past its
      first chunk. State exactly what was run.
