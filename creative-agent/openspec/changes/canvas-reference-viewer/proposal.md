# Canvas reference viewer: see the change up close, mark it, describe the next edit

Status: approved by the artist (2026-10-31: "Yep these are all the features I want").

## Why

A live chat on the Dostoevsky painting (2026-10-31, chat e95c5139) failed three ways at once:

1. `/canvas-edit-ref Make the soldiers more detailed, also the soldier who is receiving the scroll should be visibly a more
   senior military general`. The image model made exactly that change (the soldier became a decorated general), but the
   difference area came out empty: the change is fine detail on small figures, below the ΔE 12 threshold. Measured on the
   chat's own pair: ΔE 12 finds 0 % at every size and blur tried; ΔE 6 finds the general and the men beside him (2.4 %).
2. With no area the card offered only Try again and Discard, and said "no clear change", which the artist could not check:
   the side-by-side picture is 400 px wide and cannot be opened larger.
3. The artist typed "yes go ahead". A typed message while the card waits is a new request, so the painter got "yes go
   ahead" without the reference, painted 12 blend strokes on the faces and said the request was already painted.

The artist: "I want it to actually be zoomable for me to be able to click on the image … something similar to ChatGPT's
edit image chat".

## What changes

A. **Fine changes are found.** The difference area is measured as before; when that finds nothing, a fine pass
   (`MASK_RULES.fine`, ΔE 6) runs. The card says when the area came from the fine pass.

B. **Never a dead end.** The card always offers Use as the target. With no area found and none marked, Use answers with how
   to mark one (click the picture). An area the artist marks is the area, whatever the comparison found.

C. **Typed answers reach the card.** While a card is open, a typed message answers it:
   - "yes", "go ahead", "use it", "ok" and the like: Use as the target;
   - "no", "discard", "cancel": Discard;
   - anything else: an edit of the reference in those words (as Describe edits below), never a move painted blind.
   The panel's status says so.

D. **The viewer.** Clicking the card's picture opens a window (its own window, never over the canvas):
   - the reference large; wheel or pinch zooms around the pointer, dragging pans; a zoom menu (Fit, 50 %, 100 %, 200 %);
   - Before / after: a toggle button, and holding Space shows the canvas;
   - Mark: drag a box, or switch to freehand and draw around a part; Clear removes it; the found area is shown in red;
   - Describe edits: a line along the bottom, sent with Return;
   - the card's answers: Use as the target, Use as the new goal (when offered), Try again, Discard.
   Remove background, erase and resize (ChatGPT's) are left out: they do not fit painting.

## Decisions (mine, the artist may change them)

- Describe edits edits the **reference** (the image model gets the current reference and the words), like ChatGPT's
  editor, so a good result is refined, not redrawn. The comparison stays against the canvas. Try again (no words) makes a
  new reference from the canvas, as before.
- A mark limits everything after it: the comparison (changes outside it are ignored) and the area used. Use with a mark:
  the found area inside the mark, or the whole mark when nothing was found inside it.
- Marks travel as polygons in 0–1 canvas coordinates (a box is four points), so they survive any view size.
- The canvas view the reference was made from is kept beside it (`canvas.png`) for Before / after.

## Out of scope

Editing with a brush mask sent to the image model (inpainting): the backends take a picture and words only.
