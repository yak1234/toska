## Why

An artist who has an underpainting on the canvas and a folder of element images (New Moscow: a sky, a tower, a bridge,
a car, each drawn large on its own) wants to say "repaint the tower from this image" and have it painted there, in brush
strokes. Today that does not happen. An element step paints from the **goal image** inside the element's area; the
element image itself is only described in a note. With no goal image, or with one loose image attached, the painter had
no tool that maps an image's part onto the canvas's part, so it asked the image model for a new, aligned picture instead
(chat c6928c35, 2026-11-16: two made images, both flagged as having moved content, one painted from anyway, the tower
left slightly less like the goal).

The artist's words (2026-11-16): the underpainting gives the positions of everything, the assets are all there, so
"this asset, this region" should just work; it must repaint, never place the image; and it is the same thing as the
selection question Toska already asks ("Is this the tower?").

## What Changes

- **Repaint from asset**: a host step, `repaint_from_asset(reference_id, part, preset)`. It
  1. asks for the part's area on the canvas exactly as `ask_for_selection` does (the shapes model's outline proposed and
     selected on the painting; the artist confirms or adjusts it), unless an area is already set;
  2. finds the same part in the asset with the shapes model (an asset that is its part all over, such as a sky filling
     its frame, is used whole);
  3. measures the fit of the asset's shape, stretched onto the canvas area's box, before any paint: how much of the two
     outlines is shared, how unevenly it is stretched, how much it is enlarged. A poor fit paints nothing and says why;
  4. writes the fitted picture (the asset's part in the area's proportions, see-through outside the part) into the chat
     and transfers it with the existing reference transfer, scoped to the area. **The canvas's outline wins**: nothing
     outside the area changes, and where the stretched part does not reach, the paint already there stays.
- **The painter is kept on this route**: in a move whose message names an attached asset, the painter is told to call
  `repaint_from_asset`, and `make_asset` is refused in that move with a pointer to it (the artist can still ask for an
  AI image in words).
- **Later in this change**: the fitted asset as the area's own goal for the likeness check; notes for a folder with no
  goal image placed against the canvas; bending (an outline warp) for parts a plain stretch does not fit.

## Approaches considered

- **A. Box fit** (chosen first): the part's box stretched onto the area's box, clipped to the area. Uses the transfer as
  it is. Right for upright single things; wrong for tilted or receding ones, which the fit measure catches.
- **B. Outline warp**: the asset bent so its outline lands on the canvas's. Handles tilt and perspective; bends inner
  detail when the shapes differ much. Built after A, for the assets A's measure turns away.
- **C. Matching details between the pictures**: dropped; an underpainting is soft dabs with nothing crisp to match.

The artist chose: the underpainting's shape wins over the asset's (2026-11-16); A first, then B where needed.

## Non-goals

- Never the asset as an image layer, and never an AI image made in its place unless the artist asks.
- The asset is never the painting's goal: only its own area's, and only for its repaint.
- No change to the reference transfer, the shapes model or the area question.

## Impact

- `krita-creative-agent/src/asset-fit.ts` (new): the fit measure and the fitted picture.
- `krita-creative-agent/src/repaint-from-asset.ts` (new): the tool and its host interface.
- `krita-creative-agent/src/studio.mjs`, `tools.mjs`: the host (find in an asset, keep the fitted picture, the artist's
  answer without an area), the tool offered when the chat has an asset or a reference besides its goal, the move's
  guidance and the `make_asset` refusal.
- Skills `reference-transfer`, `fix-region`, `image-asset`: say when to use it.
- No plugin change; no Krita restart beyond the usual install.
