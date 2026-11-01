# Live effects: focus lines, speed lines and light rays as layers the agent edits by settings

Status: approved 2026-11-01 and **folded into `custom-effects` as its C++ half** (the user: "for live effects … we
should fold into C++. That makes sense."). Its tasks live in `custom-effects/tasks.md`; this file keeps the design.
Decisions (Claude's calls): the artist can also edit these layers by hand through the usual fill-layer dialog; focus
lines first, then speed lines and light rays.

## Why

Part 7 of `paint-engine` asked for "effects as live layers". It does not depend on the other three parts split from
that proposal (`colour-mixing`, `brush-carries-paint`, `wet-paint`), so it is proposed on its own and can be built in
any order beside them.

Today an effect the painter adds is painted pixels. To draw focus lines the agent has to place hundreds of separate
marks, keep them evenly spaced, and get every one right. A later change ("fewer lines", "move the centre left") means
undoing and painting all of them again. Effects built with `custom-effects` (YAML recipes run by Python/numpy building
blocks through `paint_effect`) are better, but they still end as pixels with no memory of how they were made.

The Clip Studio study (`local-notes/clip-studio-study/`, Comic features › Screentones and Effect lines) shows the other
way. A screentone there is "about eight numbers, not an image": the dots are drawn from the settings at display and
export time, kept in a cache per zoom level, and drawn again only when a setting changes. Focus and speed lines are
separate generators, not brush strokes. Lines are spaced by angle or by distance along the outline, and the last step
is stretched so the circle closes evenly. Randomness comes from a seeded LCG whose seed is stored with the object, so
editing one setting does not reshuffle the lines.

Value to agents: high. The agent sets a few numbers instead of drawing hundreds of marks, and it can revise the effect
later by changing one of them.

## Why C++

Python can create fill layers with the generators Krita already has (screentone, pattern, gradient, multigrid pattern,
simplex noise, SeExpr, solid), but it cannot define a new generator type. A new generator is a C++ plugin registered
with `KisGeneratorRegistry`, so this work goes in `plugins/generators/`, beside the others.

Following `screentone`, each generator needs:
- a `KisGenerator` subclass with `generate()`;
- a `KisFilterConfiguration` subclass that holds the settings and the seed;
- a config widget (`.ui`) so the artist can edit the layer by hand;
- a plugin class that registers the generator, and a `.json` service file;
- a `CMakeLists.txt` entry and its own `tests/` folder.

Screentone's precomputed template (`KisScreentoneGeneratorTemplate`) is the model for the cache.

## What changes

1. **Three new fill-layer generators** (C++, `plugins/generators/`): focus lines, speed lines and light rays.
   - Focus lines: a centre or an ellipse; spacing by angle or by distance, with the last step stretched to close the
     circle; line length, width and taper; spacing jitter; grouping.
   - Speed lines: a direction, a line count split around a centre line, length and jitter.
   - Light rays: a source point or a side, ray count, spread, softness and falloff.
2. **Settings and a seed saved in the `.kra`**, in the layer's generator configuration. The same layer always redraws
   the same lines after a reload.
3. **A cache per zoom level.** The result is drawn again only when a setting changes. Geometry is stored relative to
   the canvas, so the layer redraws sharp at any size or zoom.
4. **One undo step per change.** The agent changes an effect by changing a setting, and that change is one Krita undo
   step. The lines are never repainted by hand.
5. **Agent side** (companion, strict TypeScript):
   - a tool that adds a live effect, or changes an existing one, by its settings;
   - a measured catalog card for each generator (probe renders, like the 154 brush cards) before the painter may choose
     it;
   - an A/B test: the same scene at 6000×4500, with and without the effect, judged by Luna.
6. **Link with `custom-effects`.** Recipes stay YAML and the building blocks stay Python. Once a generator exists, a
   recipe block may target it (for example, the `rays` block makes a light-rays layer), so the two changes do not
   duplicate work. live-effects is small and could be folded into `custom-effects` later (see questions).

## Non-goals

- Screentone changes: the existing generator stays as it is.
- Moving `custom-effects` blocks such as fog, snow or particles into C++.
- A general node or effect graph, or generators written at run time.
- Changes to colour mixing or brush engines (the sibling changes).

## Anti-goals (failure even if it technically works)

- Live effect layers that slow observes the way 10 live filter masks did on New Moscow (15+ minutes per observe).
- Lines that reshuffle when an unrelated setting changes, or after a reload.
- An effect that goes soft or blocky at full size or at high zoom.
- A generator the painter can choose before it has a measured catalog card.

## Constraints

- New code goes in `plugins/generators/`, with no changes to Krita's core, so the monthly KDE merge stays easy. New
  companion code is strict TypeScript.
- Builds go only through `agent/build-macos.sh`. Tests run against Toska on copies, never on the artist's documents,
  and live tests run at full size (6000×4500).
- Windows and Linux are built on CI, so there is no macOS-only code in the generators.

## Done when

1. A focus-lines layer saves, reloads with the same lines, and redraws sharp at any zoom.
2. Changing one setting from the agent is one undo step, and undo brings back the exact previous lines.
3. Observe time is measured with N live effect layers (1, 5 and 10) on a 6000×4500 canvas, and it stays close to the
   time without them.
4. Speed lines and light rays pass the same checks, and each generator has a catalog card.
5. The A/B test is run and reviewed by the artist.

## Questions for the artist

1. Should live-effects stay its own change, or be folded into `custom-effects` as its C++ half?
2. Are focus lines, speed lines and light rays the right first three, or should one come first on its own?
3. Should the artist be able to edit these layers by hand through the usual fill-layer dialog, or should they be
   agent-only at first?
