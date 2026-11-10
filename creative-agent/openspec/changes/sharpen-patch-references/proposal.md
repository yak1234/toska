# Sharpen patch references: a reference stretched past 2x is sharpened, not refused

Status: APPROVED by the artist (2026-11-10: "yes", then "build all the features").

## Why

On a painted canvas a reference transfer whose target is more than 2x its source is refused (`stretchRefusal`,
after-the-underpainting goal 2): stretched dabs and edges read as blobs at actual pixels. The refusal tells the painter to
attach a sharper reference, which it cannot do by itself.

- **Istanbul (2026-11-10, 12000x4000).** The left half needs a new dock painted from an AI reference of 2175x1450 over
  6000x4000 (2.8x). The painter's first transfer of the right side asked 616 source px over 2000 canvas px and was
  refused at 3.2x. It then made three more AI references to get under 2x, and the night was spent there.
- **Sharpen exists, for one picture only.** `goal-sharpen.ts` sharpens the whole-picture goal 4x on this computer
  (Real-ESRGAN, nothing uploaded). A reference placed over a part of the canvas never gets it.

## Goals

1. A transfer (`paint_from_reference`, `paint_reference_edges`, `paint_reference_surface`) that would be refused for its
   stretch sharpens its reference 4x first and then paints from the sharpened picture, in the same call.
2. The reference becomes the sharpened picture as the goal does: same id, larger pixels, `sharpened` records what it was.
   The call's source rect (and focal rects) are scaled; later calls in the old pixels are scaled as the goal's are
   (`staleGoalSource`). The painter is told the new size and the factor in the tool's answer.
3. A reference larger than the sharpener takes (2 million pixels) is reduced to that first, then sharpened 4x: Istanbul's
   2175x1450 dock reference becomes about 6240x4160, the most the reference tools read.
4. The setting "Sharpen the goal" decides: Never refuses as today. Always and Ask both sharpen (the call would otherwise
   fail; there is no card for a patch).
5. The call waits, with the progress on the status line; Stop ends it. A failure refuses as today, with the reason.
6. Once sharpened, a reference is not sharpened again: a transfer still past 2x is refused and says so.

## Non-goals

- No card, no side-by-side review, no remembered answer per reference.
- Not for a reference part (its bounds are in the original's pixels), nor the whole-picture goal (goal-sharpen.ts owns it).
- No change to the 2x limit, to goal sharpening, or to the first underpainting transfer (it may stretch, as before).
- No cache across chats: the sharpened file lives in the chat folder (`goal-sharpen/`).

## Decisions (mine, the artist is not a painter)

- Reducing a 3 MP reference to 2 MP before a 4x sharpening loses little (net 3.2x) and keeps the sharpener's memory limit.
- The stretch is re-checked after sharpening against the same 2x.
