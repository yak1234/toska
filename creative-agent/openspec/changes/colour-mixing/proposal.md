# Colour mixing: clean blends and colours the agent can plan by maths

Status: approved 2026-11-01 ("I think the four proposals. Let's do that. Work on that."). Nothing is built yet. Split
from `paint-engine`; supersedes the parked `pigment-mixing`.

Decisions made since (Claude's calls, explained to the user, who directs Toska but is not a painter; may be overruled):
- **Order:** MyPaint spectral → shared module → **Mixbox → Color Smudge**, so Color Smudge is changed once, with every
  model available (parts 3 and 4 below are built in that swapped order).
- **A/B scene:** a simple still life with clear colour joins first (mixing differences show plainly), New Moscow after.
- **Blending presets** switch to a new model only per preset, after its catalog card and A/B; never globally by default.
- `pigment-mixing` is kept as a pointer here, not deleted.

## Why

The artist (2026-11-01): "Group 3 needs to be mandatory. We keep pushing off the pigment work". On switching on MyPaint's
pigment mode: "that is just switching on a new stroke call. I want it done with other features on top of that … that is
just the beginning."

Toska paints with Krita's brush engines through the fork's C++ stroke job (`Node::paintStrokes`), choosing from 154
measured presets (`brush-catalog.json`). Every mix in those engines is a plain RGB average in the layer's colour space:
blue and yellow make olive grey, and the agent's blends and glazes go muddy. That is a known failure in its paintings
today. The agent also cannot predict a mix: it picks hex colours and finds out what they make only after it paints.

This change gives the agent two things:
- **Clean blends and glazes**: mixes that stay bright where real paint would, instead of greying out.
- **Colours it can plan by maths**: the same mixing code the brushes use can answer "what do these two make?" before
  a stroke is laid.

Study notes from 2026-11-01 (git-ignored, in `local-notes/`) give the design basis:
- **libmypaint 1.6.1** (bundled in Toska) already has spectral mixing: RGB to a 10-band spectrum, weighted geometric
  mean, back to RGB. Blue + yellow gives green. Krita never uses it: it calls the legacy `mypaint_brush_stroke_to`,
  which forces paint mixing to 0, and composites dabs itself (`pigment-study/mypaint-spectral.md`).
- **Clip Studio Paint** mixes every paint-mixing brush by an alpha-weighted average in a converted colour space, most
  likely linear light (`clip-studio-study/README.md`, Brush engine › Colour mixing).
- **Realistic Paint Studio** mixes in a tuned Lab (an extra 2/3 power on XYZ before Lab), so dark paint dominates, but
  blue + yellow still gives pinkish grey (`realistic-paint-study/findings-binary.md`, section 2).
- **Rebelle 8** uses **Mixbox**: four pigment amounts plus an RGB leftover, a cubic polynomial back to RGB. It has two
  switches, one for mixing on the brush and one for mixing inside the wet simulation (`rebelle-study/`, section 2).
- Only a pigment model like Mixbox turns complementary colours into browns. Spectral mixing still gives grey teal.

## What changes (four parts, built in this order)

1. **Spectral mixing in the MyPaint engine** (`plugins/paintops/mypaint/`, C++). Move to `mypaint_brush_stroke_to_2`
   and a `MyPaintSurface2` adapter, and port libmypaint's spectral dab blend into Krita's dab compositing. Then
   `paint_mode` works for both the colour the brush carries and each dab laid on the canvas. This is the starting point.
2. **A shared colour-mixing module in the fork (C++).** One place that mixes colours by a chosen model:
   - RGB (today's behaviour, the default, so existing presets do not change);
   - linear light (Clip Studio's approach);
   - perceptual (Realistic Paint Studio's tuned Lab);
   - spectral (MyPaint's, the same maths as part 1, which then calls this module);
   - pigment (Mixbox, part 4).
   It must not be named "pigment": Krita's colour library is already `libs/pigment`. The builder chooses the name.
   Pure functions with unit tests, no Qt widgets, so the agent's preview tool can use the same numbers.
3. **Mixing models in Color Smudge** (`plugins/paintops/colorsmudge/`). Most of the agent's blending, bristle, wet and
   knife presets run on this engine, so this is where mixing quality shows. A mixing-model option per preset, saved in
   the preset, using part 2.
4. **Mixbox as the pigment model**, built from the published Mixbox paper and code (SIGGRAPH Asia 2021, "Practical
   Pigment Mixing for Digital Painting"): RGB to four pigment amounts plus a leftover, mixed in that space, back to RGB.
   Complementary colours make browns, and unmixed colours come out exactly as picked. Following Rebelle, two switches:
   - **mix on the brush**: the colour the brush picks up and carries, and the dab laid on the canvas (used now);
   - **mix in wet paint**: mixing inside the wet buffer (defined now, used later by `wet-paint`).

Alongside, for the agent (companion, strict TypeScript):
- **Catalog cards first.** Each new mixing mode, and each preset that uses one, gets a measured catalog card (probe
  strokes, as the 154 today) before the painter may choose it.
- **`mix_colors` preview tool** (from the parked `pigment-mixing` idea): given two or more colours, amounts and a model,
  it returns the mixed colour under that model, using the module's numbers, so the painter can plan a blend before it paints.
- **Blending passes sample the paint below.** The plugin already turns on Color Smudge's `MergedPaint` for some passes
  (`creative_tools.py:846` and `:2025`; Color Smudge only, ignored in Lightness mode, checked at `:1258`). Confirm every
  blending pass on the agent's new, empty layers is covered, and add MyPaint presets once they mix.

**A/B measurement before parts 3 and 4.** After parts 1 and 2, the agent paints the same scene twice at 6000×4500, once
with the new mixing and once without, everything else fixed. Luna and the artist each judge the pair blind (which is
cleaner, which reads better). Parts 3 and 4 proceed when both prefer the new mixing; otherwise we stop and look at why.
The same A/B is repeated after part 4 for the pigment model.

## Sibling changes (not in this scope)
- `brush-carries-paint`: paint memory, a dirty brush and per-bristle colour in Hairy. Depends on this change.
- `wet-paint`: the wet stroke buffer and whole-stroke passes. Depends on this change and uses the "mix in wet paint" switch.
- `live-effects`: effects as live generator layers. Independent of this change.

## Non-goals
- Paint memory, dirty brushes, bristle colour, wet buffers, edge darkening, pooling or drying (the sibling changes).
- Kubelka–Munk with measured pigment tables, or a user-editable pigment set: Mixbox's fixed set is enough here.
- Changing how the planner composes or judges a painting.
- Changing layer blend modes, export or colour management outside the brush engines and the new module.
- Mixing modes in engines other than MyPaint and Color Smudge.

## Anti-goals (failure even if it technically works)
- A colour the artist or the agent picks and lays down unmixed comes out different from what was picked.
- Existing presets change how they paint without anyone choosing a new mixing model.
- `mix_colors` predicts one colour and the brush lays a different one under the same model.
- Mixing so slow that the agent's passes or the artist's own strokes lag on a 6000×4500 canvas.
- A new mode the painter can choose before it has a measured catalog card.
- Changes spread through Krita's core so that the monthly KDE merge becomes painful.

## Constraints
- Fork-first. C++ only in `plugins/paintops/mypaint/`, `plugins/paintops/colorsmudge/` and the one new module; Python
  only where the plugin already drives Krita; new companion code in strict TypeScript.
- Builds only through `agent/build-macos.sh`. Tests run against Toska on copies, never the artist's documents; live
  tests at full size (6000×4500).
- Windows and Linux built on CI: no macOS-only code in the engines or the module.
- No co-author lines in commits.

## Done when
1. MyPaint presets with `paint_mode` on mix blue and yellow to green in Toska, live, on a probe canvas.
2. The module's unit tests pass for all five models, including: unmixed colours round-trip exactly, and RGB matches
   today's output.
3. Color Smudge presets offer the mixing models, and the agent's blending presets use a measured non-RGB model.
4. Complementary colours mix to brown under Mixbox; both switches exist, and "mix on the brush" works live.
5. `mix_colors` agrees with a probe stroke under each model, within a small measured tolerance.
6. Every blending pass on a new, empty layer samples the paint below.
7. Every new mode has a catalog card, and the blind A/B shows Luna and the artist preferring the new mixing.

## Questions for the artist
1. Is "MyPaint → shared module → Color Smudge → Mixbox" the right order, or should Mixbox come before Color Smudge so
   Color Smudge gets all models at once?
2. For the A/B scene: one you choose, or a known test scene (New Moscow, or a simpler still life)?
3. Should the agent's blending presets switch to the new model by default once measured, or stay opt-in per preset?
4. Should `pigment-mixing` be deleted, or kept as a one-line pointer here?
