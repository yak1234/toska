# Repaint from asset: tasks

Spec: `proposal.md`. Rules: tests first; new companion modules strict TypeScript; no plugin change; the reference
transfer, the shapes model and the area question unchanged. Limits are first values until 6.x sets them on real assets.

## 1 The fit

- [x] 1.1 `src/asset-fit.ts`: `measureFit(part, area, asset?)` (overlap, covered, uneven, scale, fits, why) and
  `fitAsset(asset, part, area)` (the area's proportions, see-through outside the part, never enlarged on its less
  stretched side, at most FITTED_PIXELS). Tests: `tests/asset-fit.test.ts`.

## 2 The tool

- [x] 2.1 `src/repaint-from-asset.ts`: `repaint_from_asset` over a host interface. No area: the area question, then stop.
  An area (or the artist's answer without one and a found outline): find the part in the asset, measure, refuse a poor
  fit with its reason and numbers, else keep the fitted picture and transfer it onto the area's box. An asset too small
  is sharpened once first when the host can. Tests with a stand-in host.

## 3 The studio

- [ ] 3.1 The host: the part found in an asset (find-it on the asset's bounded copy), the asset's pixels, the fitted
  picture kept in the chat as a reference of its own, the area's and a proposal's shape, the answer without an area.
  (Written; the answer without an area is tested. Finding in an asset and keeping the fitted picture need the shapes
  model, so they are proved by 5.1, not by a stand-in.)
- [x] 3.2 Offered when the chat has a picture; the goal the underpainting came from is turned away by the tool itself
  (its parts are a scoped transfer). In the tool lists and their tests.
- [x] 3.3 A move whose message names an attached asset: the painter's guidance names the tool, and `make_asset` is
  refused in that move unless the message asks for an AI image.

## 4 Words

- [x] 4.1 Skills `fix-region`, `image-asset`: when to call it; the tool’s own description (`reference-transfer` is at its 700-word cap and is left as it is).

## 5 Live

- [ ] 5.1 In Toska at 6000 x 4500: an underpainting, then one asset repainted into its area; the outline seen on the
  painting, the result looked at. (Run 2026-11-16, test chat d49670bb: the painter called the tool, the card asked, the
  part was found in the asset and the fit measured; both fits were refused, so nothing was painted. "The historic
  buildings" as a group, 0.30: rightly. The tower alone, 0.57 against 0.6: wrongly, its outline had holes. Holes are now
  filled and the limit is 0.5; from the run's saved outlines the tower fits at 0.65 and the three wrong pairings stay
  at 0.27-0.37. Still to see: the tower painted, with the fixed build.)
- [x] 5.2 A part of several pieces: each piece of the asset fitted to the piece of the area it matches (`pieces`, which
  parts things joined by a thin neck, and `matchPieces`); the area's other pieces keep their paint and the artist is
  told. From the outlines of the second live run (test chat 6b144fb6, the artist's own underpainting, "the tall golden
  tower" found as the tower, a facade slice and a strip of town): the tower pairs at 0.61 and three pieces are left.
  "The historic buildings" as a group still pairs nothing: the canvas pieces there hold more than the facade and the
  tower (5.3).
- [ ] 5.3 A refusal diagnosed, not just reported (the artist, 2026-11-16): the asset's outline trimmed to what matches
  when it spills; the decision model shown both crops and asked whether they are the same thing, to pair pieces;
  the area's unmatched part shown to the artist. Per piece: overlap, covered, spill, stretch, same-object.

## 6 New Moscow

- [ ] 6.1 All twelve element images against the underpainting: a table of fit numbers, which pass, the results.
- [ ] 6.2 The limits (MIN_OVERLAP, MAX_UNEVEN) set from 6.1.

## 7 After

- [ ] 7.1 The fitted asset as the area's goal for the likeness check of its repaint.
- [ ] 7.2 A folder with no goal image: element notes placed against the canvas once it has an underpainting.
- [ ] 7.3 Outline warp for the parts 6.1 turns away.
