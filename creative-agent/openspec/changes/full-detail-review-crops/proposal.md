# Full-detail crops for the blank-canvas review

Status: APPROVED 2026-11-10 (the artist: "yes", then "build all the features").

## Why

Luna and the painter see the canvas as a view of 1568 px on the long side. Istanbul is 12000 x 4000, so its view is at
scale 0.131. The blank-canvas review (`blank-canvas-review`) cuts the new ground out of that view: a 6000 x 4000 px half
is judged from about 780 x 523 px. At that scale a faithful copy, a blurred enlargement and a coarse dab transfer look
alike, and `same_finish` compares the new ground with a painting shown just as small. Finish is a property of actual
pixels; the view cannot show it.

## Goals

1. The new-ground crop is rendered from the document, not cut from the view: the whole fresh box at up to 1024 px on
   its long side, read scaled in one call (`canvas_projection.read_scaled`), never a full-size read of a large area.
2. When that crop is still reduced, up to two detail tiles of the new ground at actual pixels (1:1, up to 1024 x 1024
   canvas px), chosen by the plugin from the crop itself: its most detailed window and its median one (deterministic).
3. Beside existing paint, up to two 1:1 tiles of the painting the batch did not touch, chosen by the same rule, so
   `same_finish` compares finish at one scale.
4. Luna is told what each image is and its scale. The calibrated question wording is unchanged when no tiles are sent;
   with tiles one sentence is added: what it reads as from the whole crop, finish from the 1:1 tiles.
5. Read-only: one new plugin operation, `review_crops`. No layer, selection, undo step or refresh. With the agent's
   guide lines showing it refuses (the review judges the painting without them) and the review uses the view as before.
6. Any failure of the detailed route (older plugin, stock Krita without the scaled read, guides, an error) falls back
   to the crop from the view. The review never fails for it.
7. The review record says which route was used (`detail`: `document` or `view`) and the tile boxes.

## Non-goals

- The painter's own view of the canvas (its close-ups already read regions).
- The BEFORE/AFTER move check of paint over paint: still the two views.
- New thresholds: `same_finish` keeps 0.5 until 1:1 tiles have labelled cases.

## Limits known before building

- The ten labelled Istanbul cases hold view-scale images only, so the tiles are not calibrated against them.
- Tiles are chosen by detail (mean gradient): on a sparse new ground a tile may show mostly empty canvas.
