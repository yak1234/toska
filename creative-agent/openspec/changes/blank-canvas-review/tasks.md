# Tasks: blank-canvas review

Write each test first and see it fail. Agent tests: `npm run -s test:unit`, `npm run -s typecheck`. Plugin tests: `uv run`
with pyqt5 (and pyqt6 for panel scripts). Live steps on a copy of a painting, in Toska, with no painting running.

## 1. Measure (plugin)

- [x] 1.1 `blank_canvas.py`: `change_map(before, after, width, height, tolerance)` on two RGBA thumbnails of one size:
      `fresh_share`, `removed_share`, `changed_share`, `fresh_box` (fractions of the view), and per ninth `empty_before`,
      `fresh`. Pure Python, no Qt. Tests: half-empty canvas with a copy added (fresh 1, removed 0); paint over paint
      (fresh 0); a painted half hidden (removed high); nothing changed; a JPEG-noisy empty area still counts as empty.
- [x] 1.2 `change_map` operation in `creative_tools.py`: two images (base64 or paths inside the chat folder), decoded
      and reduced with Qt, answered from 1.1. Read-only, works while a pass is queued.

## 2. Decide (companion)

- [x] 2.1 `src/blank-canvas.ts`: `batchKind(map)` (over | new_ground | mixed), `emptyCells(map)`, `factsText(map)`,
      `removed(map)`, `dropFreshFindings(findings, map)`. Thresholds exported. Unit tests for each.
- [x] 2.2 `new_ground` question in `visual-check-questions.json`; `newGroundCheck` in `visual-checks.ts` (one request,
      the facts text, the crop). `moveCheck` takes optional `facts` and puts them first in `parts`.
- [x] 2.3 `reviewHost.review` in `studio.mjs`: call `change_map`; by kind call `moveCheck`, `newGroundCheck` or both;
      crop through the existing `comparison_crop`; on any error fall back to today's `moveCheck` alone.

## 3. Act (review extension)

- [x] 3.1 `luna-review.ts`: a `new_ground` verdict is recorded and never undone; the note names what it reads as.
      `artwork_removed` is undone like any finding. Tests in `tests/luna-review.test.mjs`.
- [x] 3.2 `recordMoveReview`: the move keeps `new_ground` (last verdict); `needs_artist` is set when every batch was
      undone, Luna stopped the move, or the last three moves read `placeholder`. The card line says why.
- [x] 3.3 Panel: the move card's Auto-approve offer is skipped while `needs_artist` (panel test under PyQt5 and PyQt6).

## 4. Transfers

- [x] 4.1 "Uncertain outcome" carries the plugin's reason (`result.error`). Unit test.
- [x] 4.2 Reproduce the first-chunk stop live on a copy of Istanbul; record the reason here.
- [x] 4.3 Fix it, with a test that fails first.

## 5. Check it

- [x] 5.1 Truth set: the chat's ten pairs with hand labels in `local-notes/`; a script runs the new review over them
      against Luna. Record the answers here.
- [x] 5.2 Unit, typecheck and plugin suites pass.
- [x] 5.3 Live in Toska on a copy of Istanbul: the painter's clone onto the empty half is kept; a transfer runs past its
      first chunk. State exactly what was run.

## Results (2026-11-10)

- 4.2 Reproduced on a copy of Istanbul (test chat, Luna off): a 38,644-stroke `paint_from_reference` onto the empty half
  painted its first 1024 strokes, then the second chunk was refused with `canvas_changed`. The checkpoint's revision was
  hashed from a canvas recomposited by area, the next chunk's check from a whole recomposite; on empty canvas they differ.
  Why the two recomposites differ there is not found (the observation now reports `area_refresh_differed` when they do).
- 4.3 Commit 05d0eeb6: the checkpoint recomposites the whole image where that takes at most 1.5 s; a refusal names what
  changed. Tests `test_native.py` (written after the code, not seen failing first).
- 5.1 Luna on the ten pairs of the chat: `new_ground` agreed with the hand labels on 9 of 10 (the crude hatched rebuild
  read "picture" 0.86); `same_finish` 0.91-0.92 for the clones, 0.26 for the blended strip, 0-0.03 for the rest.
- 5.2 Unit 1,403 pass, 0 fail, 1 skipped; plugin 1,258 pass, 3 skipped; typecheck clean (at bc46ce14).
- 5.3 Live in the installed Toska on a copy of Istanbul, painter hf:moonshotai/Kimi-K3.1-Pro, Luna Guide: the picture
  moved to the empty half (clone, transform, hide the source) measured fresh 0.4961 and removed 0.9922, read "picture"
  0.84 with same finish 0.91 from the document crop, and was kept. Before the fixes of 8d217af0 and bc46ce14 the same
  move was undone twice as artwork removed (the 1:1 parts misled Luna; they are off, REVIEW_TILES).
- Added after the proposal: a batch that empties one place and leaves a picture of the same finish on what was empty
  canvas is a move, kept on the new ground's reading alone (`relocated`).
