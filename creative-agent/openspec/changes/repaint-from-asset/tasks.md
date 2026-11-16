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
  painting, the result looked at.

## 6 New Moscow

- [ ] 6.1 All twelve element images against the underpainting: a table of fit numbers, which pass, the results.
- [ ] 6.2 The limits (MIN_OVERLAP, MAX_UNEVEN) set from 6.1.

## 7 After

- [ ] 7.1 The fitted asset as the area's goal for the likeness check of its repaint.
- [ ] 7.2 A folder with no goal image: element notes placed against the canvas once it has an underpainting.
- [ ] 7.3 Outline warp for the parts 6.1 turns away.
