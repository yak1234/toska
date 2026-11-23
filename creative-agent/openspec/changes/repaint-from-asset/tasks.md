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
  at 0.27-0.37. Run 2026-11-23, test chat 03c8c7e2, the artist's underpainting: the tower piece paired at 0.61 with
  three pieces left, and was painted from the asset inside its area: tiers, windows, the underpainting's place and
  size. Seen in the canvas previews, not yet by the artist on screen. In the same move the painter then ran Finish
  and a surface pass, which read the underpainting as the goal and took much of the asset's detail away again: 5.4.)
- [x] 5.2 A part of several pieces: each piece of the asset fitted to the piece of the area it matches (`pieces`, which
  parts things joined by a thin neck, and `matchPieces`); the area's other pieces keep their paint and the artist is
  told. From the outlines of the second live run (test chat 6b144fb6, the artist's own underpainting, "the tall golden
  tower" found as the tower, a facade slice and a strip of town): the tower pairs at 0.61 and three pieces are left.
  "The historic buildings" as a group still pairs nothing: the canvas pieces there hold more than the facade and the
  tower (5.3).
- [ ] 5.3 A refusal diagnosed, not just reported (the artist, 2026-11-16): the asset's outline trimmed to what matches
  when it spills; the decision model shown both crops and asked whether they are the same thing, to pair pieces;
  the area's unmatched part shown to the artist. Per piece: overlap, covered, spill, stretch, same-object.
- [x] 5.4 A repaint kept (`src/repaint-kept.ts`): each repainted area is kept in the chat with its fitted picture and
  its move; Finish, the surface and edge passes, a refinement, accents and a transfer from another picture are turned
  away where they would cover it (an undone move's area is forgotten; the fitted picture as the reference goes
  through). The tool and the move's note no longer tell the painter to finish the area. Run 2026-11-23, test chat
  in test-8: the tower repainted and the move ended at once, its detail kept. The painter tried no goal pass, so the
  refusal itself is proved by the tests only.

## 6 New Moscow

- [ ] 6.1 All twelve element images against the underpainting: a table of fit numbers, which pass, the results.
- [ ] 6.2 The limits (MIN_OVERLAP, MAX_UNEVEN) set from 6.1.

## 7 After

- [ ] 7.1 The fitted asset as the area's goal for the likeness check of its repaint.
- [ ] 7.2 A folder with no goal image: element notes placed against the canvas once it has an underpainting.
- [ ] 7.3 Outline warp for the parts 6.1 turns away.

## 8 A folder without a goal

The artist, 2026-11-16: a folder whose goal image is deleted, with an underpainting image in it, repaints each element
into its place on the underpainting.

- [x] 8.1 The scan: with no goal image, an image whose name says underpainting (underpainting.png, layout.png,
  block-in.png) is the top image, `goal_role: 'underpainting'`; a goal image still comes first; chosen in the Goal image
  list, an underpainting keeps its role.
- [x] 8.2 The plan is the host's own (`layoutPlanSteps`): the underpainting, then one step per element in file order;
  no planner turn, no stages card, and no Finish, Refine or Accents (they read the underpainting as the goal: 5.4, 7.1).
- [x] 8.3 An element step tells the painter to call `repaint_from_asset` with the element's image; its area card is the
  step's own and ends with the step. Another element's fitted picture may cross a repainted box (its area keeps it off).
- [x] 8.4 The panel's folder card says "Underpainting:" and what the plan does with it.
- [ ] 8.5 Live: the New Moscow folder without its goal, at 6000 x 4500.
- [ ] 8.6 "Repaint from this" on each element row; the role chosen in the panel (Goal, Underpainting, None) instead of
  by the file's name; Autopilot skipping a refused element and reporting it.
