# Brush carries paint: bristles that pick up, carry and leave colour

Status: approved 2026-11-01 ("I think the four proposals. Let's do that. Work on that."). Nothing is built yet. Split
from `paint-engine`.

Decisions made since (Claude's calls, explained to the user, who directs Toska but is not a painter; may be overruled):
- **Dirty brush** is never a preset default; the painter always chooses it.
- **Start on RGB** in parallel with `colour-mixing`; bristles switch to the shared module when it lands.
- **A/B scenes:** the benchmark set in `../../benchmark-scenes.md` (scenes 1, 4, 5), never New Moscow.

## Why

The artist (2026-11-01): "Group 3 needs to be mandatory. We keep pushing off the pigment work"; on switching on MyPaint's
pigment mode: "that is just switching on a new stroke call. I want it done with other features on top of that … that is
just the beginning."

Today each of the agent's dabs is laid down fresh, or smudged by one averaged colour for the whole tip. A real brush
behaves differently. It carries the paint it picked up, each bristle holds slightly different paint, and a brush that
wasn't washed leaves traces of the last colour. These traits are what make a stroke look painted. They also help the
agent directly: one stroke over two colours can leave streaks of both and blend the join. That is a richer stroke, and
the painting needs fewer strokes, so passes are shorter and there are fewer seams for the judge to catch.

The Realistic Paint Studio study (`local-notes/realistic-paint-study/`, git-ignored) gives the design basis:
- **Paint memory ("hale")**: `carried = pickup × hale + carried × (1 − hale)`, an exponential moving average per dab.
  The setting is reshaped by a curve (normal brushes `(1 − v)²`) so that the useful values spread across the slider.
- **Bristles ("vors")**: each bristle keeps its own carried colour and its own loaded or "dirty" colour. It picks up
  under its own tip, mixes with hale, then mixes in fresh paint by "colour amount". Brightness varies slightly per bristle.
- **Dirty brush**: leftover colour from the last stroke. Its strength resets to full on a new colour and drops by a
  fixed step after each finished stroke, so the brush "gets cleaner" (`carried = brush × strength + leftover × (1 − strength)`).

Krita already has parts of this. Color Smudge has smudge length (a paint memory with a linear setting). The Hairy engine
(`plugins/paintops/hairy/`) keeps a colour and an ink amount per bristle, with ink depletion and a one-time "soak ink"
from the layer, but its bristles never pick up paint as they move. The agent does not use Hairy today.

## What changes

1. **Paint memory as one reshaped setting.** In Color Smudge (beside smudge length) and in Hairy, one "paint memory"
   setting. Internally it is reshaped by a curve so that 0–1 spreads evenly from "lays fresh paint" to "drags the colour
   a long way". The curve is chosen by measurement, starting from `(1 − v)²`.
2. **Dirty brush.** A brush option with a strength and a fade step. Strength resets to full when the colour changes,
   drops by the step after each finished stroke, and stops at 0. It is off by default.
3. **Per-bristle paint in Hairy** (C++, `bristle.h/.cpp`, `hairy_brush.cpp`). Each bristle keeps a carried, a loaded and
   a dirty colour. On every step it picks up the canvas under its own tip, mixes that into its carried colour by paint
   memory, then mixes in its loaded colour by colour amount. An optional small brightness variation per bristle gives
   streaks. The existing ink depletion and soak options keep working. How two colours mix (pickup, carry, load) is
   delegated to the shared module from `colour-mixing`, so the bristles follow the preset's mixing model.
4. **A stroke-end hook.** The dirty-brush fade and the saving of leftover colour run once per finished stroke, through
   Krita's per-stroke data (as `KisColorSmudgeInterstrokeData` does today), not per dab.
5. **For the agent** (companion, strict TypeScript):
   - the painter chooses "drag the colour" or "lay fresh paint" (paint memory high or low), and "clean brush" or
     "dirty brush", as deliberate settings recorded in the step's plan, never as hidden preset defaults;
   - new Hairy and Color Smudge presets get measured catalog cards (probe strokes, as the 154 today, plus a two-colour
     probe that records whether both colours show as streaks) before the painter may choose them;
   - the planner is told when a dirty brush is still carrying an earlier colour, so a highlight pass does not pick up
     the shadow colour by accident.
6. **Per-stroke colour variation** (added 2026-11-01). Clip Studio varies hue, saturation and brightness once per
   stroke as well as per dab, so each stroke comes out slightly different; that answers the agent's repetitive marks.
   Krita already has the parts: the "Fuzzy Stroke" sensor (`KisDynamicSensorFuzzyPerStroke`,
   `plugins/paintops/libpaintop/sensors/`) can drive the HSV options (`KisHSVOption`). No new engine code: presets
   that use it, an agent setting "vary each stroke" (small / medium / off, mapped to measured HSV ranges), and catalog
   cards. Off unless the painter chooses it.
7. **Presets seeded from tuned values** (added 2026-11-01). New presets in this change start from the values the
   studies decoded (Realistic Paint Studio's 18 tools, Rebelle's 563 presets: paint memory, paint amount, dirty
   strength, bristle variation, opacity), mapped to Krita's settings, instead of guessed numbers. The mapped numbers go
   in a tracked file, `creative-agent/krita-creative-agent/src/preset-seeds.json` (values and their source app and tool
   only); the probe strokes and catalog cards then confirm or adjust them.
8. **An A/B test.** The same scene at 6000×4500, painted once with these brushes available and once without. Luna judges
   the two blind (offline scores labelled as offline), and the artist reviews both. We also record the stroke count and
   time for each run.

## Non-goals
- Defining mixing models (RGB, perceptual, spectral, pigment). That belongs to `colour-mixing`; this change only calls it.
- Wet paint, whole-stroke passes and fluid flow (`wet-paint`), and effects as live layers (`live-effects`).
- A new brush engine. This change extends Hairy and Color Smudge.
- GPU bristle simulation. The work stays on the CPU, as Krita's engines are today.

## Anti-goals (failure even if it technically works)
- With paint memory at "lay fresh paint" and the brush clean, the colour picked comes out different from the one laid.
- Colour from an earlier pass bleeds into a later one without the painter having chosen a dirty brush.
- Bristle strokes are so slow that a pass, or the artist's own strokes, lag on a 6000×4500 canvas.
- A setting the painter can choose before it has a measured catalog card.
- Changes reach into Krita's core so that the monthly KDE merge becomes painful.

## Constraints
- Depends on `colour-mixing` (the shared module and its models). Paint memory and the dirty brush can land with RGB
  mixing first, and bristles switch to the shared module once it exists.
- Fork-first. C++ stays inside `plugins/paintops/hairy/` and `plugins/paintops/colorsmudge/`. Python only where the
  plugin already drives Krita. New companion code is strict TypeScript.
- Builds only through `agent/build-macos.sh`. Tests run against Toska on copies, never the artist's documents. Live
  tests are full size (6000×4500).
- Windows and Linux are built on CI, so the engines contain no macOS-only code.

## Done when
1. A Hairy preset leaves streaks of both colours from one stroke over two colours, live in Toska on a probe canvas.
2. Paint memory is one setting in Color Smudge and Hairy, and a measured sweep shows an even spread from fresh to dragged.
3. The dirty brush resets on a new colour and fades by its step after each stroke, verified by unit tests and a live probe.
4. Every new preset and setting has a catalog card, and the painter chooses drag/fresh and clean/dirty explicitly.
5. The A/B test is run. Luna's blind verdict, the artist's verdict, stroke counts and times are recorded, and the
   artist decides whether the brushes stay on by default.

## Questions for the artist
1. Should the dirty brush ever be the default for some presets (oil-like ones), or always a choice the painter makes?
2. Should bristle brushes come before or after `colour-mixing`'s Color Smudge models, since they can start on RGB?
3. Which scene for the A/B test: New Moscow, or a fresh still life with clear colour joins?
