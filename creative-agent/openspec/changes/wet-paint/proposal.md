# Wet paint: a wet stroke buffer, whole-stroke passes, then a fluid simulation

Status: approved 2026-11-01 ("I think the four proposals. Let's do that. Work on that."). Nothing is built yet. Split
from `paint-engine`.

Decisions made since (Claude's calls, explained to the user, who directs Toska but is not a painter; may be overruled):
- **Dry before observe = full dry:** the simulation runs until the wet region settles (with a time cap), so what the
  agent judges is what stays. Fast-dry (freeze as is) only when the cap is hit, and the observe says so.
- **Drips:** off for the agent at first; available to the artist's own strokes.
- **Papers:** one default paper first; the hot pressed / cold pressed / rough / Japanese set later.

## Why

The artist (2026-11-01): "Group 3 needs to be mandatory. We keep pushing off the pigment work"; "I want it done with
other features on top of that … that is just the beginning."

Krita paints every dab straight into the layer. That makes some things impossible: darkening a watercolour stroke along
its edge, holding a glaze to an even opacity, or letting paint flow, pool and dry into the paper. `paint-engine` left a
slot for fluid flow as a non-goal. It is now in scope, as a later stage.

Design basis (git-ignored notes in `local-notes/`):
- **Clip Studio Paint** (`clip-studio-study/`): watercolour edge as a whole-stroke pass. A box filter counts the empty
  pixels around each pixel (window 2 × radius + 1, running sums, so cost does not grow with radius). Pixels with many
  empty neighbours are near the edge and darken.
- **Realistic Paint Studio** (`realistic-paint-study/`): bristles paint into a wet stroke buffer that is merged at stroke
  end. A transparency ceiling per stroke means that once alpha reaches the ceiling, more dabs add nothing, which gives
  even glazes. A height texture mode `alpha − grain × (1 − alpha)` bites hardest where the paint is faint (dry brush).
- **Rebelle** (`rebelle-study/`): a CPU stable-fluids grid. Its layers are velocity (U, V), flow, water mass, suspended
  pigment, deposited wet pigment, and a dried glaze. It uses semi-Lagrangian advection, pressure projection and
  mass-conserving pigment transport. Drying evaporates water, absorbs extra into textured paper, and deposits pigment in
  proportion to the water lost. Paper is a few scalars (absorbency/dry speed, edge drying, paper influence, re-wet) plus
  a height map, and granulation is a tiled texture. Drips are optional particles. It offers explicit Wet, Dry and
  Keep-Wet tools.

## What changes

**Stage 1: wet stroke buffer and whole-stroke passes** (C++, in the paintop plugins).
1. A stroke paints into a wet buffer that merges into the layer at stroke end. Dabs in the same stroke can pick up
   from the buffer (still-wet paint).
2. Passes that run on the whole buffer before the merge:
   - watercolour edge darkening (box-filter count of empty neighbours, radius and strength settings);
   - an opacity ceiling per stroke, for even glazes and washes;
   - a height-mode paper grain, kept separate from the brush's own grain.
3. Measured catalog cards for every preset that uses a pass, before the painter may choose it.

**Stage 2: a CPU fluid simulation on a grid** (C++, new code in the fork's plugin folders).
1. Built from published research: Stam's "Stable Fluids" (1999) for advection and projection, and Curtis et al. (1997)
   "Computer-Generated Watercolor" for the shallow-water layer, the three pigment stages (suspended, deposited, dried),
   edge darkening and granulation. It is not built from any app's binary.
2. Per-cell state: velocity, water, suspended pigment, deposited pigment, and a dried layer composited "over" the paint.
3. Paper as a few scalars (absorbency/dry speed, edge drying, paper influence, re-wet) plus a height map that slows flow
   and absorbs water. A granulation texture with strength and contrast. Drips as an option, off by default.
4. Only the active region is simulated: the bounding box of wet cells plus a margin, never the whole 6000×4500 canvas.
5. Mixing inside wet paint uses the "mix in wet paint" switch from `colour-mixing`.

**Added 2026-11-01:**
- **Lifting paint.** A water mode that thins or removes paint where it passes (Realistic Paint Studio's water tools
  rewrite alpha as well as colour), so the agent can lighten or soften an area by lifting, not only by painting over.
  Stage 1 does it in the wet buffer (alpha may go down); stage 2 re-wets and carries pigment away. A painter tool `lift`
  with a strength, measured by a catalog card.
- **Presets seeded from tuned values.** Watercolour presets start from the decoded values (Rebelle's watercolour
  presets: water, opacity, spacing, paper influence; Realistic Paint Studio's Draw wet / Draw dry / Pure water: glaze
  ceiling 0.95, blur pickup, texture mode), recorded in `src/preset-seeds.json` (shared with `brush-carries-paint`),
  then confirmed by probe strokes.

**Agent controls (required).** Paint that keeps moving after the agent has looked breaks the paint→look→judge loop.
- Before every observe, wet paint is dried, or fast-dried, unless the step asked to keep it wet. The observe states
  whether anything is still wet.
- A seed per document (saved in the `.kra`) means the same strokes give the same result, so retries and tests repeat.
- Explicit tools for the painter: Wet (re-wet an area), Dry (dry an area or the layer now) and Keep wet (hold a region
  open for the next pass, with a deadline). They are recorded in the plan like any other step.
- Companion code for these is strict TypeScript, and each tool gets a measured card.

## Non-goals
- Mixing models. These come from `colour-mixing`; this change uses its switch.
- Paint carried on the brush and per-bristle colour (`brush-carries-paint`). Effects as live layers (`live-effects`).
- Impasto height and its lighting. This could be a later change.
- GPU simulation. Krita's engines run on the CPU and must build on all three platforms.

## Anti-goals (failure even if it technically works)
- What the agent judged changes afterwards: paint flows, blooms or dries differently after an observe.
- The same strokes and seed give a different result on a second run.
- The simulation lags the agent's passes or the artist's strokes on 6000×4500.
- Observes slow down the way 10 filter masks slowed New Moscow (15+ minutes each).
- Wet state silently spreads into layers or areas the plan did not touch (protected areas included).
- Changes reach into Krita's core so that the monthly KDE merge becomes painful.

## Constraints
- Depends on `colour-mixing`. Stage 1 can start on RGB.
- Fork-first. Work stays in plugin folders. Python only where the plugin already drives Krita. New companion code is
  strict TypeScript.
- Builds only through `agent/build-macos.sh`. Tests run against Toska on copies at 6000×4500, never the artist's
  documents. Live tests stay short, with a deadline on every wait.
- Windows and Linux are built on CI, so the engines contain no macOS-only code.

## Done when
1. Stage 1: a watercolour preset shows darkened edges and an even glaze ceiling from whole-stroke passes, and a
   dry-brush preset shows height-mode grain, live in Toska. All of them have catalog cards.
2. Stage 2: a wet wash flows, granulates and dries with darker edges on a probe canvas. The same strokes with the same
   seed give pixel-identical results.
3. Observes never see moving paint: dry-before-observe and the Wet / Dry / Keep wet tools are tested on real `/state`.
4. A 6000×4500 live test with wet strokes keeps pass and observe times within today's budget, and the artist reviews it.

## Questions for the artist
1. Should dry-before-observe be fast-dry (keeps the look, quick) or a full dry (truer, slower)?
2. Should drips be offered to the agent at all, or kept for the artist's own strokes?
3. Which papers first: one default, or the hot pressed / cold pressed / rough / Japanese set?
