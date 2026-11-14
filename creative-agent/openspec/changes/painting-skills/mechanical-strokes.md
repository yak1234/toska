# Painting skills, part: hand strokes that do not come out mechanical

Status: part of the `painting-skills` change (2026-11-14). Tasks M.0, M.1, M.2, M.4 and M.5 are built and unit-tested;
nothing has run in Toska yet (M.7, M.8). Everything here is Claude's proposal until the artist confirms it; the artist
asked for it to be written down ("write context and what needs to be done as an openspec in the toska folder").

## Context: what happened

Test chat 2 of the WikiArt baseline (Degas, a pastel of two women in a gallery, 4576 x 6000; notes in
`../../results/notes.md`):

1. Move 1 copied colour and placement with one `paint_from_reference` call (dE 51.5 to 0.3). The directional pastel
   hatching came out as soft dabs.
2. Move 2 was asked: "Rework it so the brushwork matches the original's in each area: stroke size, direction and edges."
   The painter titled its move "Rebuild brushwork per area: floor sweeps, wall drags, skirt and bodice pulls, dress
   folds", ran `paint_reference_surface` (sharpening the original 4x), `sample_canvas_colors`, `list_brushes`, then
   `paint_batch` with 1,070 strokes in about six minutes.
3. Luna undid the whole batch: "mechanical stripes, hard graphic look". Nothing of the move stayed. The chat then said
   "Luna sees little left to add here".

The painter read the painting correctly and could not make the marks. The same fault was recorded on New Moscow
(`stroke-generators/proposal.md`: flat_block 1.0, hard_graphic 1.0, stripes 0.94).

## Why the strokes were mechanical

| # | Cause | Evidence |
|---|---|---|
| 1 | The strokes came from the existing simple generator (`paint_recipe`, `src/stroke-generator.mjs`), not from typed coordinates: 7 recipes inside one `paint_batch`, each one rectangle with ONE direction word (`diagonal`, `vertical`, `horizontal`), a size range, an opacity range and `irregularity` 0.3 to 0.4. Parallel strokes clipped to a box cannot follow a skirt fold or a floor's perspective | the chat's `recipes/*.json` (for example "Floor: broad diagonal strokes", 240 strokes, region [0,3050,2450,2950], Bristles-3 Large Smooth); Luna's "stripes" |
| 2 | Every stroke had one pressure from start to end, so marks end as hard bars | Luna's "hard graphic look" |
| 3 | The catalogue brush has no chalk: no paper grain, no size response, no turn with direction | `list_brushes` offered only catalogue presets |
| 4 | Everything was painted before any check; the only verdict was on the whole batch | one batch, one undo |
| 5 | The rejection was not used: no second attempt with Luna's finding as the instruction | the move ended at the keep card |
| 6 | Nothing scores brushwork, so the dabbed copy counts as finished | "Luna sees little left to add" |

## What changes

1. **A real stroke generator replaces the rectangle recipe for brushwork.** The painter already states the gesture and
   lets code place strokes (correction 2026-11-14: an earlier draft of this file said it typed coordinates; the chat's
   records show recipes). What is missing is in the generator: strokes that follow the form (a direction field from
   the reference, as the surface pass has), a region that is the found part or a mask and not a box, length and bend
   that vary with the form, and soft falloff at the region's edge instead of a clip. For each area the painter gives
   direction (a word, an angle, or "follow the form"), length, looseness, density and material. This is the `seeds` and `mark`
   blocks of the proposal's Techniques (section 4) and the approved `stroke-generators` change; the surface pass
   (`generateSurfacePlan`) is the working start. `paint_batch` stays for the few placed accents it is good at.
2. **A pressure shape on every generated stroke**: light in, press, lift, with randomness (`mark`'s taper, swell, even).
   Needs a brush whose size or opacity follows pressure, which `make_brush` sets.
3. **Brushes with the material in them** (`make_brush`, proposal section 2): for pastel, paper texture, size on
   pressure, tip rotation on drawing angle.
4. **Swatch before area.** A gesture is painted first as a small swatch off the painting and compared with a close-up of
   the original; only a swatch that is closer than the starting point goes on the canvas.
5. **A rejection becomes a correction.** When Luna undoes a batch for a brushwork finding (stripes, hard graphic look,
   flat block, ellipses), the painter gets one more attempt at that area with the finding as its instruction (more
   variation, softer ends), not a finished move. One retry per area per move, then it reports what failed.
6. **Review per area, not per move.** Gesture strokes are sent as one batch per area so Luna can keep the floor and undo
   the dress.
7. **A brushwork score** (proposal section 5) so 1 to 6 are measured, and "little left to add" needs brushwork as well
   as colour.

## Order (cheapest first)

5 and 6 (retry and per-area review), then 1 and 2 (gesture strokes with pressure), then 3 (`make_brush`), then 4 (the
swatch needs the scratch document proved live), with 7 built beside 1 so each step is measured.

## Tasks

In `tasks.md`, section M.

## Done when

The Degas brushwork prompt leaves directional hatching on the canvas that Luna keeps, measured by the brushwork score
against the dabbed copy, and the same holds on two other paintings.
