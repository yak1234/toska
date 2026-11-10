
# Wet Paint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Stage 1: wash-mode strokes get whole-stroke passes before they merge: watercolour edge darkening, an even-glaze opacity ceiling and height-mode paper grain.
- Stage 2: a deterministic CPU wet simulation (Stam 1999 stable fluids plus Curtis et al. 1997 watercolour) on the active region only. Wet paint is dried before every observe, and the painter gets Wet / Dry / Keep wet tools.
- A `lift` tool thins paint: in stage 1 inside the buffer, in stage 2 by re-wetting and carrying pigment away.
- New presets start from decoded tuned values.

**Architecture:** Krita already paints a wash-mode stroke into a temporary target (`KisIndirectPaintingSupport`) and merges it in `KisPainterBasedStrokeStrategy::finishStrokeCallback`; that buffer is the wet buffer. One small hook calls a new `KisPaintOp::finishStroke(buffer, node)` just before the merge. Pure pass code lives in `plugins/paintops/libpaintop/wet/` and runs from `KisBrushBasedPaintOp` (pixel brush) and the Hairy op.

Stage 2 adds a cell grid (`KisWetGrid`) per layer, held by `KisWetLayerStore`. A wet stroke adds its buffer to the grid, advances a fixed number of ticks, and writes the grid's render back through the same merge (composite op COPY). So every pixel change happens inside a stroke transaction and is undoable. Drying is its own undoable stroke. Python and the companion reach the simulation through a tiny interface in `libs/image` and a fork-owned libkis file.

**Tech Stack:** C++17, Qt 5, Krita stroke/paintop API, QTest; Python plugin (PyQt via `qt_compat`); companion in strict TypeScript, TypeBox, `node --test`.

**Spec:** `creative-agent/openspec/changes/wet-paint/proposal.md` (with "Decisions made since").
- Research: Stam, "Stable Fluids", SIGGRAPH 1999; Curtis, Anderson, Seims, Fleischer, Salesin, "Computer-Generated Watercolor", SIGGRAPH 1997.
- Design notes (git-ignored): `creative-agent/local-notes/clip-studio-study/README.md` (Brush engine › Watercolor edge); `realistic-paint-study/findings-shaders-presets.md` (ceiling, height mode).
- Stage 2 takes nothing from any app binary.

## Global Constraints

- **Benchmark scenes (2026-11-01; overrides any scene named in this plan):** every A/B gate follows `creative-agent/openspec/benchmark-scenes.md` — fixed goal images, 3 runs per arm, blind Luna + the user, and the muddiness / stroke-count / repetition / observe-time measurements. "Still life" means scene 1; New Moscow and the artist's own paintings are never used.
- Paths are relative to the fork root `forks/toska` (branch `krita-agent`).
- C++ builds only via `nice -n 19 env CMAKE_BUILD_PARALLEL_LEVEL=8 zsh agent/build-macos.sh`. C++ tests only via `agent/run-tests.sh <TestName> [function]`. New test programs go in `agent/ci-tests.txt`. Tests use QTest, absolute paths in a `QTemporaryDir`, `QVERIFY` on every pointer, and never open a dialog.
- Plugin tests run from `creative-agent/krita-creative-agent` with `uv run -q --with pyqt5 --with pillow --with numpy --with httpx --with opencv-python-headless python -m unittest discover -s tests -p '<pattern>'`.
- Companion: new modules and tests are strict TypeScript (`.ts`, `.test.ts`); run `npm run test:unit` and `npm run typecheck`. Tests delete what they write.
- C++ stays in `plugins/paintops/libpaintop/wet/`, `plugins/paintops/hairy/` and `plugins/paintops/libpaintop/kis_brush_based_paintop.*`. Outside the plugins, only:
  - the hook in `libs/image/brushengine/kis_paintop.h` and `libs/ui/tool/strokes/kis_painter_based_stroke_strategy.cpp`, each marked `// Toska: wet-paint`;
  - the new files `libs/image/KisWetPaintInterface.*` and `libs/libkis/DocumentWetPaint.cpp`;
  - declarations in `libs/libkis/Document.h` and `Node.h`.
  
  No macOS-only code; no GPU.
- Every new setting defaults off; existing presets paint byte-identical.
- Dry before observe means a full dry until the paint settles, capped at 4000 ms by default (session setting `wet_cap_ms`). When the cap is hit, fast-dry (freeze the paint as it is) and the observe says `fast_dried: true`. Paint stays wet only through an explicit `keep_wet` with a deadline ≤ 600 s.
- The same strokes with the same seed give pixel-identical results. The seed is per document, in the annotation `toska-wet-seed`, saved in the `.kra`. Agent strokes never advance the simulation by wall-clock time.
- The simulation runs only on the active region (the bounding box of wet cells plus an 8-cell margin), never the whole canvas. Wet state never leaves its layer or the stroke's clip (stage mask, selection, protected features).
- `lift` strength is in [0.1, 1]. It works only on an agent-owned layer the painter names, never on the artist's layers or protected features.
- Presets start from `creative-agent/krita-creative-agent/src/preset-seeds.json`, created by brush-carries-paint Task 8a (schema, `readSeeds`, `seedFor`). This plan only appends watercolour entries.
- Drips are off for the agent (the plugin refuses `WetPaint/Drips`) and available in presets for the artist.
- One default paper: `03_default-paper.png` for height and `04_paper-C-grain.png` for granulation. The paper set comes later.
- Catalog cards come before the painter may choose any preset or tool. The A/B runs at 6000×4500 on a simple still life first (blind Luna, labelled offline, plus the artist), New Moscow after.
- Live tests:
  - Toska only, through MCP `creative_test_*`, on copies at `width=6000 height=4500`. Never the artist's documents, never `brush_probe`.
  - A deadline on every wait, and waiters checked on real `/state` first.
  - Never install over a running `~/Applications/Toska.app` (`pgrep` plus a mount check; ask the user to quit). One restart per batch.
- Commits: no co-author or AI lines; report "committed locally"; never push.

## Review Focus

1. A wet pass clipped to a stage region beside a protected feature: water and pigment never enter cells outside the stroke's clip. → Task 7 `testFlowStaysInsideTheClip`.
2. The artist paints a dry brush over still-wet paint, or presses Undo while the paint is wet: what Krita shows wins, and wet paint never reappears over it. → Task 7 `testForeignEditsWin`, `testUndoWhileWetDoesNotResurrect`.
3. A large wet wash cannot settle within the cap: the observe returns within cap + 500 ms and says it fast-dried. → Task 9 `test_cap_hit_reports_fast_dry`.
4. A `keep_wet` region past its deadline, or a second observe while it is still open: it is reported wet until the deadline and dried at the first observe after it. → Task 9 `test_keep_wet_expires`.
5. A wash touching the canvas border, or a layer in RGBA16 or Lab: no rim along the border, and the passes work in every colour space. → Task 1 `testCanvasBorderIsNotAnEdge`, Task 2 `testPassesInRgb16AndLab`.

## Assumptions to confirm in code

- `KisIndirectPaintingSupport::mergeToLayerImpl` reads the temporary composite op and opacity at merge time, so a `finishStroke` that sets COPY and opaque changes that merge. A Task 7 test pins it.
- Krita's wash mode (alpha darken, stroke opacity as the cap, flow per dab) already is the opacity ceiling. Task 3 pins it; if it fails, the pass clamps alpha.
- Patterns resolve by file name through the preset's `resourcesInterface()`, as `KisTextureOption` does. A missing paper is treated as flat, with one warning.
- Document annotations are saved in and loaded from `.kra`. The Task 8 round-trip test pins it.
- Hairy pickup comes from brush-carries-paint Task 4; Task 3 here depends on it.
- Colour-mixing module (see colour-mixing/tasks.md): `plugins/paintops/libpaintmix/`, static lib `kritapaintmix`, namespace `KisPaintMix`:
  - `Model { Rgb, LinearLight, Perceptual, Spectral, Pigment }`
  - `Rgb { float r, g, b; }` (straight, sRGB-encoded)
  - `mix2(Model, Rgb a, Rgb b, float t)`
  - `mixMany(Model, const Rgb*, const float* weights, int n)`
  - `Settings { Model model; bool mixOnBrush = true; bool mixInWetPaint = false; }`

---

## Stage 1: wet stroke buffer and whole-stroke passes

### Task 1: Whole-stroke passes (pure)

**Files:**
- Create: `plugins/paintops/libpaintop/wet/KisWetStrokePasses.h`, `.cpp`
- Modify: `plugins/paintops/libpaintop/CMakeLists.txt`, `plugins/paintops/libpaintop/tests/CMakeLists.txt`, `agent/ci-tests.txt`
- Test: `plugins/paintops/libpaintop/tests/KisWetStrokePassesTest.cpp`, `.h`

**Interfaces:**
- Produces: `namespace KisWetStrokePasses { void emptyCount(const quint8 *covered, int w, int h, int r, quint16 *out); void darkenEdges(KisPaintDeviceSP buffer, const QRect &imageBounds, int radius, qreal valueStrength, qreal alphaStrength); void paperGrain(KisPaintDeviceSP buffer, const QImage &paperGrey8, qreal strength, qreal scale); }`. `covered` and `out` are row-major `w×h`; `covered` holds 1 or 0, and the caller has already padded it by `r` on every side.
- Algorithm. The window and the counting are decided here; the darkening uses the buffer colour space's own darken op.
  ```
  covered(x,y) = alpha > 0; outside imageBounds counts as covered (the canvas border is never an edge)
  H(x,y) = Σ_{k=−r..r} (1 − covered(x+k,y))     running sum: H(x+1) = H(x) + e(x+r+1) − e(x−r)
  E(x,y) = Σ_{k=−r..r} H(x,y+k)                 the same, vertically → cost independent of r
  w      = min(1, 2·E / (2r+1)²)                 1 on a straight edge (half the window empty)
  for alpha > 0: colour darkened by valueStrength·w; alpha += (1 − alpha)·alphaStrength·w
  bands of 256 rows with an r-row halo; r clamped to [1, 64] so counts fit 16 bits
  paper: g = grey(⌊x/scale⌋ mod W, ⌊y/scale⌋ mod H) / 255, anchored at the image origin
         a' = clamp01((a − g·(1 − a))·strength + (1 − strength)·a)      (height mode: bites faint paint)
  order in apply: edges, then paper
  ```

- [ ] **Step 1: Write the failing tests:**
  - `testEmptyCountMatchesBruteForce`: random 64×48 coverage with r ∈ {1, 3, 8} equals the O(r²) count.
  - `testRimDarkensInteriorDoesNot`: a filled 200 px disc of mid grey, r 3, value 0.5; rim pixels are darker by ≥ 40/255 and pixels 10 px inside are unchanged.
  - `testCanvasBorderIsNotAnEdge`: a rect touching the image's left edge gets no darkening on that side.
  - `testCostIndependentOfRadius`: on a 2000×2000 buffer, time at r 32 ≤ 1.5 × time at r 2, medians of 3.
  - `testHeightGrainBitesFaintPaint`: paper of alternating 0/255 columns at strength 1; alpha 0.2 becomes 0 in the 255 columns, and alpha 1.0 is unchanged.
  - `testPaperIsAnchoredToTheImage`: two buffers offset by 7 px get the same grain at the same image pixel.
- [ ] **Step 2: Build and run** `agent/run-tests.sh KisWetStrokePassesTest`; expect a build failure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run;** expect `0 failed`.
- [ ] **Step 5: Commit** `Whole-stroke passes: watercolour edge by a box-filter count of empty neighbours, height-mode paper grain`.

### Task 2: The stroke-end hook, options, and the pixel brush

**Files:**
- Modify:
  - `libs/image/brushengine/kis_paintop.h/.cpp`: `virtual void finishStroke(KisPaintDeviceSP strokeBuffer, KisNodeSP node);` with a no-op default.
  - `libs/ui/tool/strokes/kis_painter_based_stroke_strategy.cpp:~422`: inside `if (indirect && indirect->hasTemporaryTarget())`, before `m_transaction->end()`, call it once on the first stroke info's `painter->paintOp()`, with `indirect->temporaryTarget()` and the node.
  - `plugins/paintops/libpaintop/kis_brush_based_paintop.h/.cpp`: read the options in the constructor; override `finishStroke` to run the passes when any is on, scaled by `KisLodTransform::lodToScale`.
  - `plugins/paintops/defaultpaintops/brush/kis_brushop_settings_widget.cpp`: add the "Wet paint" option page.
- Create: `plugins/paintops/libpaintop/wet/KisWetPaintOptionData.h/.cpp`, `KisWetPaintOptionModel.h/.cpp`, `KisWetPaintOptionWidget.h/.cpp`, `KisWetPaper.h/.cpp`
- Test: `libs/libkis/tests/TestStrokeJobs.cpp` (new functions), `plugins/paintops/libpaintop/tests/KisWetStrokePassesTest.cpp`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `struct KisWetPaintOptionData { bool edgeEnabled {false}; int edgeRadius {3}; qreal edgeValue {0.3}; qreal edgeAlpha {0.2}; bool paperEnabled {false}; qreal paperStrength {0.5}; qreal paperScale {1.0}; QString paper {"03_default-paper.png"}; /* stage 2, Task 7 */ bool simulate {false}; int cellSize {2}; int ticksPerStroke {6}; qreal water {1.0}; qreal absorbency {0.3}; qreal edgeDrying {0.5}; qreal paperInfluence {0.5}; qreal rewet {0.0}; qreal granulationStrength {0.3}; qreal granulationContrast {0.5}; QString granulation {"04_paper-C-grain.png"}; bool drips {false}; read/write; bool anyPass() const; }`, with keys `WetPaint/<Name>` (`WetPaint/EdgeEnabled`, `WetPaint/EdgeRadius`, …).
  - `KisWetPaper::grey(const QString &name, KisResourcesInterfaceSP) -> QImage`: Format_Grayscale8, cached by name; null means flat.
  - `void KisWetStrokePasses::apply(KisPaintDeviceSP, const KisWetPaintOptionData&, const QRect &imageBounds, qreal lodScale, const QImage &paper)`.

- [ ] **Step 1: Write the failing tests:**
  - `KisWetStrokePassesTest::testOptionRoundTrip`.
  - `testPassesInRgb16AndLab`: Task 1's rim test on RGBA16 and Lab16 buffers.
  - `TestStrokeJobs::testEdgePassRunsBeforeMerge`: `paintStrokes` with a pixel-brush wash preset and `presetProperties {"WetPaint/EdgeEnabled": true, "WetPaint/EdgeValue": 0.5}`; on the layer, the stroke's rim is darker than its centre. The same job without the property paints byte-identical to today.
  - `testBuildUpStrokesSkipThePasses`: in BUILDUP mode, `finishStroke` is never called and the layer is byte-identical.
- [ ] **Step 2: Build and run** `agent/run-tests.sh KisWetStrokePassesTest TestStrokeJobs`; expect FAIL.
- [ ] **Step 3: Implement.** The widget is one page: edge (enable, radius, value, alpha) and paper (enable, strength, scale). The stage 2 fields stay hidden until Task 7.
- [ ] **Step 4: Run;** expect `0 failed` in both programs, then run `agent/run-tests.sh kis_image_test` for the strategy change.
- [ ] **Step 5: Commit** `Wash strokes run whole-stroke passes on their buffer before the merge (one hook in the stroke strategy)`.

### Task 3: Glaze ceiling, Hairy passes, picking up still-wet paint

**Files:**
- Modify:
  - `plugins/paintops/hairy/kis_hairy_paintop.h/.cpp`: override `finishStroke` as in Task 2. In wash mode with pickup, sample the stroke buffer first, and the pickup source where the buffer is empty.
  - `plugins/paintops/hairy/kis_hairy_paintop_settings_widget.cpp`: the "Wet paint" page.
- Test: `plugins/paintops/libpaintop/tests/KisWetStrokePassesTest.cpp`, `plugins/paintops/hairy/tests/KisHairyPaintTest.cpp`

**Interfaces:**
- Consumes: Task 2; brush-carries-paint Task 4 (`HairyBrush::setPickupSource`).
- Produces: `HairyBrush::setWetBuffer(KisPaintDeviceSP)`, with sampling order buffer → source.

- [ ] **Step 1: Write the failing tests:**
  - `KisWetStrokePassesTest::testWashOpacityIsACeiling`: 20 overlapping dabs with `COMPOSITE_ALPHA_DARKEN`, opacity 0.5 and flow 0.3, into an empty device. Max alpha ≤ 128/255 + 1/255, and over the overlap region alpha's standard deviation is < 2/255.
  - `KisHairyPaintTest::testPicksUpStillWetPaint`: a wash stroke crossing its own earlier part carries that colour forward.
  - `testHairyEdgePass`: the rim is darker than the centre.
- [ ] **Step 2: Build and run** `agent/run-tests.sh KisWetStrokePassesTest KisHairyPaintTest`. Expect FAIL for the Hairy functions. The ceiling test passes if the assumption holds; if it fails, add `WetPaint/Ceiling` and clamp alpha in `apply`, and then it must pass.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run;** expect `0 failed`.
- [ ] **Step 5: Commit** `Hairy wash strokes: whole-stroke passes and pickup from the still-wet stroke buffer; the glaze ceiling pinned by test`.

### Task 3b: Lifting paint in the wet buffer (stage 1)

**Files:**
- Modify:
  - `plugins/paintops/libpaintop/wet/KisWetPaintOptionData.h/.cpp`: `qreal lift {0.0}`, key `WetPaint/Lift`.
  - `KisWetStrokePasses.h/.cpp`: `void liftMask(KisPaintDeviceSP buffer, qreal strength)`.
  - `plugins/paintops/libpaintop/kis_brush_based_paintop.cpp` and `plugins/paintops/hairy/kis_hairy_paintop.cpp`: in `finishStroke`, when `lift > 0`, run `liftMask` and set the node's temporary composite op to `COMPOSITE_ERASE` with opaque opacity.
- Test: `plugins/paintops/libpaintop/tests/KisWetStrokePassesTest.cpp`, `libs/libkis/tests/TestStrokeJobs.cpp`

**Interfaces:**
- Produces: `liftMask` turns buffer alpha `a` into `strength · boxBlur1px(a)` and ignores the colour channels. The merge then lowers the layer's alpha by at most `strength`, with a soft lifted edge. On layers with wet state, Task 7 replaces this.

- [ ] **Step 1: Write the failing tests:**
  - `testLiftMaskScalesAndSoftens`: a hard 1.0 square at strength 0.4 gives 0.4 inside, and the outer pixel ring is between 0 and 0.4.
  - `TestStrokeJobs::testLiftThinsPaintOnTheLayer`: an opaque red layer and a lift stroke with `presetProperties {"WetPaint/Lift": 0.5}`. Alpha under the stroke is 0.5 ± 2/255, the colour is unchanged, everything outside is unchanged, and one undo restores the layer.
- [ ] **Step 2: Build and run** `agent/run-tests.sh KisWetStrokePassesTest TestStrokeJobs`; expect FAIL. Implement; expect `0 failed`.
- [ ] **Step 3: Commit** `Lift: a wash stroke can thin the paint under it (alpha goes down), soft-edged`.

### Task 4: Stage 1 presets, probes and cards

**Files:**
- Create, in `krita/data/paintoppresets/`, authored in Toska's editor:
  - `t)_Toska_Watercolour_Edge.kpp`: pixel brush, wash, opacity 0.6, edge r 3 / value 0.35 / alpha 0.2;
  - `t)_Toska_Even_Glaze.kpp`: wash, opacity 0.35 as the ceiling, flow 0.25;
  - `t)_Toska_Dry_Brush_Grain.kpp`: Hairy, wash, paper strength 0.8;
  - `t)_Toska_Lift.kpp`: pixel brush, soft round, wash, `WetPaint/Lift` 0.5.
  
  These numbers are placeholders, replaced by `seedFor(name)`.
- Create: `creative-agent/krita-creative-agent/scripts/measure_wet_probe.py`
- Modify:
  - `creative-agent/krita-creative-agent/src/preset-seeds.json`: add watercolour entries, each with its `mapping` rule:
    - Rebelle's Watercolor Round and the PAINT_WATERCOLOR row (water, opacity, spacing, paper influence), from `findings-data.md` and `scratchpad/rebelle-data/brushes_flat.json`;
    - RPS "WC Draw wet", "WC Draw dry" and "WC Pure water": ceiling `transp` 0.95 → wash opacity; blur pickup → `unmapped`; texture mode 50 → `WetPaint/PaperEnabled`; paper value → `WetPaint/PaperStrength`.
  - `krita/data/paintoppresets/CMakeLists.txt`.
  - `creative-agent/krita-creative-agent/src/brush-catalog.json`.
  - `creative-agent/krita-mcp/krita-plugin/kritamcp/paint_settings.py` (brush-carries-paint Task 6): allow `WetPaint/*` except `WetPaint/Drips`.
- Test: `creative-agent/krita-creative-agent/tests/test_measure_wet_probe.py`, `tests/test_paint_settings.py`

**Interfaces:**
- Produces:
  - `rim_ratio(rgba, rect) -> float`: mean darkness of the outer 4 px band over the interior.
  - `glaze_evenness(rgba, rect) -> float`: alpha standard deviation over the overlap.
  - `grain_contrast(rgba, rect, faint_rect) -> float`.
  - Cards: `cards["t) Toska Watercolour Edge"]` and so on.

- [ ] **Step 1: Write the failing tests:**
  - synthetic `test_rim_ratio_of_a_dark_rim`, `test_glaze_evenness_of_a_flat_glaze`, `test_grain_contrast_is_higher_in_faint_paint`;
  - `test_drips_are_refused_for_the_agent`;
  - the companion's `preset-seeds.test.ts` (brush-carries-paint) stays green with the new entries.
- [ ] **Step 2: Run** with `-p 'test_measure_wet_probe*.py'` and `-p 'test_paint_settings*.py'`; expect FAIL. Implement; expect `OK`.
- [ ] **Step 3: Build, package (`--check` with 0 problems) and install** once. Check pgrep and the mount first, and ask the user to quit if needed. One restart.
- [ ] **Step 4: Probe live** at 6000×4500 on a blue|tan ground: the standard 40 px stroke, three overlapping glaze strokes, one faint dry-brush stroke, and lift strokes at 0.25 / 0.5 / 1.0 over an opaque patch.
  - Pass when `rim_ratio ≥ 1.15`; glaze std ≤ 3/255 with alpha ≤ the ceiling; grain contrast faint/strong ≥ 1.5; lifted alpha within 0.05 of 1 − strength.
  - Where a probe moves a seeded value, update the seed's value and note it in the card.
  - Write one-line cards; the lift card says what each strength removes.
- [ ] **Step 5: Commit** `Toska watercolour edge, even glaze, dry-brush grain and lift presets, seeded from tuned values, with measured cards`.
- [ ] **Step 6: Stage 1 A/B:** paint a simple still life twice, with the presets available and without. Blind Luna (offline) plus the artist judge it. Record verdicts, stroke counts and times in the change folder. Stage 2 starts after the artist has seen it.

## Stage 2: CPU fluid simulation

### Task 5: The grid and one tick (pure)

**Files:**
- Create: `plugins/paintops/libpaintop/wet/KisWetGrid.h`, `.cpp`
- Test: `plugins/paintops/libpaintop/tests/KisWetGridTest.cpp`, `.h` (add to `agent/ci-tests.txt`)

**Interfaces:**
- Produces:
  - `struct KisWetParams { int cellSize; qreal absorbency, edgeDrying, paperInfluence, rewet, granulationStrength, granulationContrast, density /*ρ 0.05*/, staining /*ω 1.0*/, damping /*μ 0.1*/, edgeFlow /*η 0.05*/; int jacobi /*30*/; bool drips; }`
  - `class KisWetGrid { public: KisWetGrid(const QRect &domainCells, const KisWetParams &, quint64 seed); void setPaper(const QImage &height, const QImage &granulation); void setAllowed(const QImage &mask /*per cell, 0 = never wet*/); void addStroke(const float *premulRgba, const QRect &pixelRect, qreal water); void tick(); bool settled() const; void fastDry(); void rewet(const QRect &cells, qreal water); void lift(const float *coverage, const QRect &pixelRect, qreal strength); void keepWet(const QRect &cells, qint64 untilTick); QRect activeCells() const; qint64 ticks() const; void render(const QRect &pixelRect, const float *basePremul, float *outPremul) const; double totalPigment() const; double totalWater() const; }`
  - Cell state:
    - water `w`;
    - staggered velocities `u` (x faces) and `v` (y faces);
    - suspended `g` and deposited `d` pigment, premultiplied RGBA with alpha as mass;
    - dried `y` (RGBA, composited "over");
    - allowed mask `A`;
    - keep-wet tick.
    
    Floats, double-buffered, with loops in fixed row-major order.
- One tick (`dt = 1`; every loop runs over the active box `B` only):
  ```
  0  B = bbox(w > ε) grown by 8 cells, ∩ domain;  ε = 1e-4;  M = (w > ε);  M' = box blur of M, radius 3 (Task 1's running sums)
  1  forces    u += −paperInfluence·∂h/∂x, v += −paperInfluence·∂h/∂y on faces between two wet cells (paper slope)
  2  advect    u, v ← semi-Lagrangian back-trace (Stam): sample at x − u(x), bilinear
  3  damp      u, v ×= (1 − μ); clamp |u|, |v| ≤ 0.5 cell per tick
  4  project   s = η·(1 − M')·M;  s ← s − mean_wet(s)        (Curtis "flow outward", made compatible)
               solve ∇²p = div(u) + s by `jacobi` iterations, p = 0 on dry cells; u −= ∇p on wet–wet faces
               every face touching a cell with M = 0 or A = 0 is 0 (walls)
  5  move      donor-cell upwind: per face, flux = face velocity × donor amount, all fluxes from the old arrays;
               a cell's outflows scaled by min(1, amount / Σout); w and all four g channels move together
               (exactly mass-conserving)
  6  transfer  (Curtis) γ = granulationStrength · contrast(t);  per wet cell, on mass:
               down = g·(1 − h·γ)·ρ,  up = d·(1 + (h − 1)·γ)·ρ / ω,  g −= down − up,  d += down − up (clamped ≥ 0)
  7  dry       w ← max(0, w − e·(1 + edgeDrying·(1 − M')) − absorbency·(1 − h)·[w < 0.25]),  e = 0.01
  8  rewet     when rewet > 0: dry cells next to wet ones with d > 0 gain rewet·mean(neighbour w)·0.1
  9  settle    a cell with w ≤ ε and no keep-wet: d += g, g = 0, y = over(y, d with alpha 1 − exp(−4·mass)), d = 0
  10 drips     (when on) a cell with w ≥ 2 starts a drop when pcg32(x, y, tick, seed) / 2³² < 0.0005;
               drops move one cell down per tick, carrying 0.5 water, leaving 0.05 per cell, stopping at A = 0
  ```
  - `settled()` is true when no cell outside keep-wet has `w > ε` and no drop is alive.
  - `fastDry()` runs step 9 on every cell outside keep-wet and removes the drops.
  - `render` composites the base, then `y` over it, then the wet preview `d + g` over that (alpha `1 − exp(−4·mass)`), bilinear from cells to pixels.

- [ ] **Step 1: Write the failing tests:**
  - `testMassIsConserved`: a wet disc, 200 ticks with drying off; total pigment and water stay within 1e-4 relative.
  - `testSettlesAndDeposits`: a wash settles within 2000 ticks; afterwards `w == 0` everywhere and `totalPigment` equals what was added.
  - `testEdgesDarken`: after a uniform disc settles, the rim band's dried mass is ≥ 1.2× the interior's.
  - `testGranulationFollowsPaper`: striped paper with granulation 0.8 gives deposited mass differing between stripes by ≥ 20%; granulation 0 gives < 2%.
  - `testSameSeedSameResult`: two grids with the same input and seed render byte-identical; the seed changes the result only with drips on.
  - `testOnlyTheActiveRegionWorks`: a 2000×2000-cell domain with a 50×50 wet blob ticks within 2× the time of a 100×100 domain.
  - `testNothingEntersForbiddenCells`: with half the grid at `A = 0`, water, g and d there stay 0.
  - `testFastDryFreezes`: after `fastDry`, `render` is within 1/255 of the preview and the grid is settled.
  - `testKeepWetCellsStayWet`.
  - `testLiftCarriesPigmentAway`: on a settled wash, `lift` 0.5 over half of it. Those cells get water; half of their dried and deposited mass becomes suspended; after one tick, a quarter of the suspended mass is removed (the brush blots it). Once settled again, the lifted half holds 0.5–0.8 of its former mass and the other half is unchanged.
- [ ] **Step 2: Build and run** `agent/run-tests.sh KisWetGridTest`; expect a build failure.
- [ ] **Step 3: Implement**, single-threaded; Task 11 parallelises it.
- [ ] **Step 4: Run;** expect `0 failed`.
- [ ] **Step 5: Commit** `Wet grid: stable-fluids flow with Curtis edge flow, pigment transfer, granulation and drying, on the active region`.

### Task 6: Mixing inside wet paint

**Files:**
- Modify: `plugins/paintops/libpaintop/wet/KisWetGrid.h/.cpp` (`KisWetParams::mix`), `plugins/paintops/libpaintop/CMakeLists.txt` (link `kritapaintmix`)
- Test: `plugins/paintops/libpaintop/tests/KisWetGridTest.cpp`

**Interfaces:**
- Consumes: `KisPaintMix::Settings` from the stroke's preset, through the reader colour-mixing/tasks.md defines. The grid stores it at `addStroke`; the first stroke of a wet episode sets it. Until the module lands, mixing is RGB.
- Produces: `KisWetParams::mix` (a `KisPaintMix::Settings`).
  - With `mixInWetPaint` and a non-RGB model: when an inflow (step 5) or a stroke (`addStroke`) meets pigment in a cell, the cell colour becomes `KisPaintMix::mix2(model, cell, incoming, m_in / (m_cell + m_in))`, computed on straight colours (un-premultiplied from the cell, re-premultiplied after).
  - Inflows apply in fixed face order: x faces, then y faces, row-major. Mass still sums.
  - RGB keeps the premultiplied sum, byte-identical to Task 5.

- [ ] **Step 1: Write the failing tests:**
  - `testRgbModelUnchanged`.
  - `testWetMixUsesTheModel`: blue and yellow washes flowing together under `Model::Pigment` with `mixInWetPaint` end greener than under RGB.
  - `testMixInWetPaintOffKeepsRgb`: `Model::Pigment` with the switch off is byte-identical to RGB.
  - `testWetMixIsDeterministic`.
- [ ] **Step 2: Run** `agent/run-tests.sh KisWetGridTest`; expect FAIL. Implement; expect `0 failed`.
- [ ] **Step 3: Commit** `Wet paint mixes by the colour-mixing module's "mix in wet paint" model`.

### Task 7: The layer store and wet strokes

**Files:**
- Create: `plugins/paintops/libpaintop/wet/KisWetLayerStore.h/.cpp`, `KisWetDryStrokeStrategy.h/.cpp`; `libs/image/KisWetPaintInterface.h/.cpp` (new fork files; add them to `libs/image/CMakeLists.txt`)
- Modify: `plugins/paintops/libpaintop/kis_brush_based_paintop.cpp` and `plugins/paintops/hairy/kis_hairy_paintop.cpp` (the simulate path in `finishStroke`), `KisWetPaintOptionWidget.cpp` (show the stage 2 fields)
- Test: `libs/libkis/tests/TestStrokeJobs.cpp` (new functions)

**Interfaces:**
- Consumes: Tasks 2, 5, 6.
- Produces:
  - `class KRITAIMAGE_EXPORT KisWetPaintInterface { public: virtual ~KisWetPaintInterface(); virtual QVariantMap state(KisImageSP) const = 0; virtual QVariantMap dry(KisImageSP, KisNodeSP layerOrNull, int capMs, bool honourKeepWet) = 0; virtual bool rewet(KisNodeSP, const QRect &pixels, qreal water) = 0; virtual bool keepWet(KisNodeSP, const QRect &pixels, int ms) = 0; static KisWetPaintInterface *instance(); static void setInstance(KisWetPaintInterface *); };`. `KisWetLayerStore` implements it and registers itself when `kritalibpaintop` loads (`Q_CONSTRUCTOR_FUNCTION`).
  - `KisWetLayerStore::addStroke(KisNodeSP, KisPaintDeviceSP buffer, KisSelectionSP clip, const KisWetPaintOptionData&, quint64 seed)`, `reconcile(KisNodeSP)`, `renderInto(KisNodeSP, KisPaintDeviceSP buffer) -> QRect`.
  - Per layer, the store holds:
    - the grid;
    - a base snapshot: the layer pixels in the active region before the first wet stroke, grown as the region grows;
    - the last rendered pixels;
    - the union of the strokes' clips (`A`).
  - `state()` returns `{"wet": bool, "layers": [{"layer": name, "id": uuid, "rect": [x, y, w, h], "keep_wet_until_ms": int|null}]}`.
  - `dry()` returns `{"dried": [names], "fast_dried": bool, "ms": int, "still_wet": [...]}`. It runs as one undoable stroke named "Paint dried": `KisWetDryStrokeStrategy` ticks until settled or the cap, then calls `fastDry`, and writes `render` through a `KisTransaction`.
  - Seed: `image->annotation("toska-wet-seed")` (decimal text); when it is missing, the seed is 1.
- Lift on a layer with wet state: `finishStroke` with `lift > 0` calls `grid.lift(buffer alpha, rect, lift)` and renders through the COPY merge instead of Task 3b's erase. On a layer without wet state, Task 3b applies.
- Simulate path in `finishStroke` (`simulate` on, device LOD 0; LOD previews only run Task 2's passes):
  1. `reconcile`: pixels that differ from the last render are foreign edits; the base adopts them and their cells are cleared.
  2. `addStroke`.
  3. Run `ticksPerStroke` ticks.
  4. Clear the buffer.
  5. `renderInto` over the active rect.
  6. Set the node's temporary composite op to COPY with opaque opacity, so the merge writes exactly the render. The stroke's undo step holds the flow so far.

- [ ] **Step 1: Write the failing tests**, each with a wash preset and `presetProperties {"WetPaint/Simulate": true}`:
  - `testWetStrokeFlowsAndIsUndoable`: after the job the layer differs from a plain wash; one undo restores the layer byte-identical to before.
  - `testFlowStaysInsideTheClip`: the job's selection is a rect; no layer pixel outside it changes, including after `dry`.
  - `testForeignEditsWin`: a BUILDUP stroke over wet paint, then `dry`; the BUILDUP stroke's pixels are unchanged.
  - `testUndoWhileWetDoesNotResurrect`: wet stroke, undo, `dry`; the layer equals the pre-stroke layer.
  - `testDryIsOneUndoStep`.
  - `testSameSeedSameResultThroughJobs`: two documents with the same strokes and the same annotation seed, then `dry`; the projections are byte-identical.
  - `testWetStateStaysOnItsLayer`: another layer's pixels never change.
  - `testLiftOnWetLayerUsesTheGrid`: lift over a dried wet wash; the grid's pigment mass drops, the rim stays, and one undo restores.
- [ ] **Step 2: Build and run** `agent/run-tests.sh TestStrokeJobs`; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `agent/run-tests.sh TestStrokeJobs KisWetGridTest kis_image_test`; expect `0 failed`.
- [ ] **Step 5: Commit** `Wet strokes feed a per-layer simulation; its render merges through the stroke, drying is one undo step`.

### Task 8: Scripting API (libkis)

**Files:**
- Create: `libs/libkis/DocumentWetPaint.cpp` (add it to `libs/libkis/CMakeLists.txt`)
- Modify, with doc comments in the house style:
  - `libs/libkis/Document.h`: `QVariantMap wetPaintState() const; QVariantMap dryWetPaint(int capMs = 4000, bool keepWet = true);`
  - `libs/libkis/Node.h`: `bool rewetPaint(const QRect &rect, qreal water); bool keepPaintWet(const QRect &rect, int ms);`
- Test: `libs/libkis/tests/TestDocumentWetPaint.cpp` (plus `CMakeLists.txt` and `agent/ci-tests.txt`)

**Interfaces:**
- Consumes: Task 7 `KisWetPaintInterface`.
- Produces: the four calls, GUI thread only. Without the interface (no plugin loaded), `wetPaintState()` returns `{"wet": false}` and the other calls refuse with `qWarning`. `keepPaintWet` clamps `ms` to [1000, 600000].

- [ ] **Step 1: Write the failing tests:**
  - `testStateWhenNothingIsWet`.
  - `testDryReportsLayers`.
  - `testKeepWetIsHonouredAndExpires`: with a 1 s keep, `dryWetPaint` leaves the region wet; after 1.2 s it dries it.
  - `testCapForcesFastDry`: a 1 ms cap on a large wash gives `fast_dried: true`, then `wet: false`.
  - `testRewetMakesPaintWet`.
  - `testSeedAnnotationSurvivesKra`: set `toska-wet-seed`, save a `.kra` under the `QTemporaryDir`, reopen it, and get the same value.
- [ ] **Step 2: Build and run** `agent/run-tests.sh TestDocumentWetPaint`; expect FAIL. Implement; expect `0 failed`.
- [ ] **Step 3: Commit** `Scripting: wet paint state, dry with a cap, re-wet and keep wet, per document and layer`.

### Task 9: Dry before observe, and the Wet / Dry / Keep wet / Lift operations (plugin)

**Files:**
- Create: `creative-agent/krita-mcp/krita-plugin/kritamcp/wet_craft.py` (`WetCraft`, in the shape of `snow_craft.py`)
- Modify:
  - `creative-agent/krita-mcp/krita-plugin/kritamcp/creative_tools.py:2206`: in `_creative_observe`, call `self._wet_before_observe(doc, session)` before `refreshProjection` and put its report in `observation['wet']`.
  - The class bases and operation lists: `wet`, `dry`, `keep_wet`, `lift`.
  - `creative_begin`: set `toska-wet-seed` when it is missing, to a random value in [1, 2⁵³).
- Test: `creative-agent/krita-creative-agent/tests/test_wet_craft.py`

**Interfaces:**
- Consumes: Task 8.
- Produces:
  - `observation['wet'] = {"dried": [names], "fast_dried": bool, "ms": int, "still_wet": [{"layer", "rect", "until"}]}` on every look, including the image a pass returns, which also goes through `_creative_observe`.
  - Operations:
    - `wet {layer_id, region | shape, water 0.1–1}`;
    - `dry {layer_id?}`;
    - `keep_wet {layer_id, region, seconds 1–600}`;
    - `lift {layer_id, strokes, strength 0.1–1}`: a stroke job on that layer with `t) Toska Lift` and `presetProperties {"WetPaint/Lift": strength}`, clipped by the protection mask like `paint_pass`.
  - Each operation is recorded in `session['passes']`. `dry` is an undo step; `wet` and `keep_wet` are not paint. All of them work only on agent-owned layers and are refused on stock Krita.

- [ ] **Step 1: Write the failing tests**, with a fake `Document` that has the four calls:
  - `test_observe_dries_first_and_says_so`
  - `test_cap_hit_reports_fast_dry`: the fake returns `fast_dried`; the observation carries it, and the total time is ≤ cap + 500 ms with the fake's delay.
  - `test_keep_wet_expires`: still listed before the deadline, dried at the first look after it.
  - `test_wet_refuses_artist_layers`
  - `test_keep_wet_caps_at_600_seconds`
  - `test_seed_set_once_per_document`
  - `test_lift_needs_an_agent_layer_and_a_strength`
  - `test_lift_keeps_out_protected_features`
- [ ] **Step 2: Run** with `-p 'test_wet_craft*.py'`; expect FAIL. Implement; expect `OK`. Then run the plugin suite with `-p 'test_*.py'`.
- [ ] **Step 3: Commit** `Every look dries wet paint first (capped, fast-dry reported); Wet, Dry, Keep wet and Lift operations`.

### Task 10: The painter's wet tools (companion)

**Files:**
- Create: `creative-agent/krita-creative-agent/src/wet-tools.ts`
- Modify:
  - `src/tools.mjs:390-395`: push `wetTools(...)` beside `snowTools`;
  - `src/settings-schema.mjs`: `{ key: 'wet_paint', type: 'boolean', default: false, label: 'Wet paint (experimental)' }`;
  - `src/tool-catalogue.ts`: timings;
  - `src/brush-catalog.json`: `tools` cards;
  - the observation formatting in `src/runtime.mjs` (`resultContent`): the wet line.
- Test: `creative-agent/krita-creative-agent/tests/wet-tools.test.ts`

**Interfaces:**
- Consumes: Task 9 operations and `observation.wet`.
- Produces:
  - `wetTools(runtime: WetRuntime): ToolDefinition[]`, with four tools:
    - `wet_area { layer_id: string; region?: [x, y, w, h]; inside_shape?: Shape; water: number }`
    - `dry_paint { layer_id?: string }`
    - `keep_wet { layer_id: string; region: [x, y, w, h]; seconds: number; reason: string }`
    - `lift { layer_id: string; strokes: Stroke[]; strength: number }`, using the `paint_pass` stroke schema. It is usable from stage 1 on and needs only the `t) Toska Lift` card.
    
    Each tool is offered only with `wet_paint` on and a card in `catalog.tools`.
  - `wetNote(wet: WetReport | undefined): string | null`, one of:
    - "Dried before this look."
    - "Fast-dried: the paint did not settle within N s, so it froze as it was."
    - "Still wet until HH:MM:SS (keep_wet): <layer>"

- [ ] **Step 1: Write the failing tests:**
  - `off: no wet tools`
  - `on with cards: four tools`
  - `a tool without a card is not offered`
  - `keep_wet over 600 s is refused before the call`
  - `lift needs its card and a strength in [0.1, 1]`
  - `the note says fast-dried`
  - `the note lists what is still wet`
- [ ] **Step 2: Run** `npm run test:unit`; expect FAIL. Implement; then `npm run test:unit` and `npm run typecheck` are clean.
- [ ] **Step 3: Commit** `The painter's Wet, Dry and Keep wet tools, the lift tool, and a wet line on every look, behind Wet paint`.

### Task 11: Speed and determinism at 6000×4500

**Files:**
- Modify: `plugins/paintops/libpaintop/wet/KisWetGrid.cpp`. Split the rows of the active box into fixed bands run on `KisSharedThreadPool`-style `QtConcurrent`. Jacobi stays double-buffered, so results do not depend on the thread count.
- Test: `plugins/paintops/libpaintop/tests/KisWetGridTest.cpp`

- [ ] **Step 1: Write the failing tests:**
  - `testThreadsGiveIdenticalResult`: 1 vs 8 threads render byte-identical.
  - `testFullCanvasWashSettlesInBudget`: a 3000×2000 px wash at cell size 2 on a 6000×4500 domain settles, or fast-dries, within 4000 ms; record the time.
- [ ] **Step 2: Run** `agent/run-tests.sh --timeout 600 KisWetGridTest`; expect FAIL (time). Implement; expect `0 failed`.
- [ ] **Step 3: Commit** `Wet grid runs its bands in parallel with identical results`.

### Task 12: Stage 2 presets, live test, cards, A/B

- [ ] Create `krita/data/paintoppresets/t)_Toska_Wet_Wash.kpp` (pixel brush, wash, `WetPaint/Simulate`, default paper, granulation 0.3, drips off) and add it to the install list. Seed it from `preset-seeds.json`: Rebelle watercolour water and paper influence → `WetPaint/Water` and `WetPaint/PaperInfluence`. Write one-line cards from the probe for the preset and for the Wet, Dry and Keep wet tools, and update the lift card for wet layers.
- [ ] Build, package (`--check` with 0 problems) and install once (check pgrep and the mount; ask the user to quit). One restart.
- [ ] Test live at 6000×4500 (`creative_test_start`; a deadline on every wait):
  - First read real `/state` to confirm the `wet` field appears on a look.
  - Paint a wet wash pass on a probe ground; the look reports `dried`, and the wash shows flow, granulation and a darker rim (`rim_ratio ≥ 1.15`).
  - Paint the same pass on two copies with the same seed; the PNG hashes are equal.
  - `keep_wet` for 60 s; the next look lists the region as still wet. `dry_paint`; it is dried.
- [ ] Timing: pass and look times with the wet preset stay within today's budget (the same strokes painted with `t) Toska Watercolour Edge`), plus at most the cap. Record both.
- [ ] A/B: paint the simple still life at 6000×4500 with wet paint available and without. Blind Luna (offline) plus the artist judge it; then New Moscow. Record verdicts, stroke counts and times; the artist decides the defaults.
- [ ] Commit the presets and cards: `Toska wet wash preset; wet tools carded after the live probe`.