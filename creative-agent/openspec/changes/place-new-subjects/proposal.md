# Place new subjects: a made image is painted in, and a found outline is really selected

Status: APPROVED by the artist (2026-11-10: "it struggles to place the ships ... it doesn't know where to place it", and
"I don't see anything on my end when the model does that").

## Why

Istanbul repaint chat, 2026-11-10, after the plan's four steps were met. The artist asked for four more warships "in the
water" from generated image assets.

- **The made images could not be painted in.** The painter made four ship images and cut two out. The place-subject skill
  paints an image with `paint_from_reference`; the move's OPEN ROUTES line said "Not now: paint_from_reference on a region
  of at most 20% of the canvas (off from step 3 of 4)". The late-plan rule exists so the goal image is not stamped again;
  a new image is not that. The painter filled flat polygon ships twice, Luna undid both (hard graphic look, flat block),
  and the move ended with "this step's tools only fill flat shapes".
- **It asked the artist to select ships that did not exist.** Luna read the message as about one part of the picture, so
  the painter was told to call `ask_for_selection` for "the new British and French warships in the water". Two moves ended
  empty on that card. The artist's answer ("paint in sea in the front please") was then read as a new request to paint
  the sea.
- **"It is selected on your painting now", and nothing was.** The card with the found outline arrives inside the painter's
  turn, 19 ms before its move closes. The panel sets no selection while the agent writes (`agent_writing_reason`), said so
  on the status line, which the next status replaced at once, and dropped the outline.

## Goals

1. A made image (role `asset`) that no colour transfer has painted yet is placed with `paint_from_reference` at any plan
   step, on a region of at most 20% of the canvas. Once painted it is a reference like any other. The stretch limit holds.
2. Late in a plan the OPEN ROUTES line names the transfers that stay open (a new made image, a focal patch) and says the
   refusal is for the goal image or a painted reference.
3. The steer to `ask_for_selection` excepts something the message asks to add that is not in the picture yet: the painter
   chooses its place and size (place-subject).
4. A found outline that could not be selected because the agent's move was still open is kept and selected as soon as
   Krita takes it; "Use this" pressed before then says why and keeps it. The artist's own selection made meanwhile stays
   until they press.

## Added the same day (the artist: "fix that right now")

"More soldiers" from a canvas reference, then "get rid of the middle soldier" (chat 0226a3af).

5. **The change area holds the whole figures.** The area was the pixels differing by ΔE 12 or more: the soldiers' cast
   shadows. The khaki figures on the warm dock differed less, so rows of soldiers were outside the area and others were
   cut (one arm was painted). A weaker difference (ΔE 6, `MASK_RULES.spread`) now belongs to a clear one it touches; a
   weaker difference alone is still the model drifting. Replayed on the saved canvas and reference of this chat: every
   soldier inside, no sky or smoke patches; on the ships reference of the same chat: the same ships, with the flag that
   had been cut.
6. **A found outline is not accepted by Auto-approve.** The card with the shapes model's outline carries no recommended
   answer. For "middle soldier" the outline was a spot at the dock's right edge and was accepted in five seconds.
   This replaces the hands-free answer of 2026-10-25 for this card only.
7. **The painter looks before it paints in a found area.** The area's context says it is the shapes model's outline, that
   it is often wrong, and to observe its bounds first and paint nothing when it shows something else.

## Not in this change

- Reading an answer to a question as the answer, not as a new request (the "paint in sea in the front" turn).
- Where a new subject should go when the artist names a place in words: the painter decides from the canvas.
