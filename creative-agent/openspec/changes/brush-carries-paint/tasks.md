# Brush carries paint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Color Smudge and Hairy each get one reshaped "paint memory" setting and a dirty brush that resets on a new colour and fades after each finished stroke. Hairy bristles each pick up, carry and lay their own colour. Presets can vary each stroke's colour through Krita's existing Fuzzy Stroke sensor. New presets start from decoded tuned values (`preset-seeds.json`). The painter chooses drag/fresh, clean/dirty and stroke variation explicitly, and only from measured cards.

**Architecture:** The shared pieces live in `plugins/paintops/libpaintop/`, which both engines already link:
- the paint-memory curve;
- the dirty-brush state and its `KisInterstrokeData`, which gives the per-stroke hook (`endTransaction()` runs once per finished stroke, as in `KisColorSmudgeInterstrokeData`);
- one colour-mix seam, `KisCarriedPaint`, which mixes in RGB today and calls the colour-mixing module once that lands.

Hairy keeps a carried colour per bristle and samples the paint under each bristle's tip: the layer, or the merged image for the agent's new empty layers. Agent stroke jobs (`libs/libkis/StrokeJob.cpp`, fork-owned) keep interstroke data between a pass's strokes when the preset asks for a dirty brush. Per-stroke colour variation needs no engine code: the plugin expands one abstract setting into Krita's own HSV-option keys, driven by the `fuzzystroke` sensor. The companion turns the painter's choices into `preset_properties`. The plugin whitelists them and passes them to `Node.paintStrokes` as `presetProperties`, which it already supports.

**Tech Stack:** C++17, Qt 5, Krita paintop API (`KisPaintOp`, `KisInterstrokeData`, `KoMixColorsOp`, `KisOverlayPaintDeviceWrapper`), QTest; Python plugin (PyQt via `qt_compat`); companion in strict TypeScript, TypeBox, `node --test`.

**Spec:** `creative-agent/openspec/changes/brush-carries-paint/proposal.md` (with "Decisions made since"); sibling `creative-agent/openspec/changes/colour-mixing/proposal.md`.

## Global Constraints

- **Benchmark scenes (2026-11-01; overrides any scene named in this plan):** every A/B gate follows `creative-agent/openspec/benchmark-scenes.md` — fixed goal images, 3 runs per arm, blind Luna + the user, and the muddiness / stroke-count / repetition / observe-time measurements. "Still life" means scene 1; New Moscow and the artist's own paintings are never used.
- Paths are relative to the fork root `forks/krita-master` (branch `krita-agent`).
- C++ builds only via `nice -n 19 env CMAKE_BUILD_PARALLEL_LEVEL=8 zsh agent/build-macos.sh` (never Homebrew ninja). C++ tests only via `agent/run-tests.sh <TestName> [function]`. Add every new test program to `agent/ci-tests.txt`. Tests use QTest, absolute paths in a `QTemporaryDir`, `QVERIFY` on every pointer, and never open a dialog.
- Plugin tests run from `creative-agent/krita-creative-agent` with `uv run -q --with pyqt5 --with pillow --with numpy --with httpx --with opencv-python-headless python -m unittest discover -s tests -p '<pattern>'`.
- Companion: new modules and tests are strict TypeScript (`.ts`, `.test.ts`); run `npm run test:unit` and `npm run typecheck`. Every test deletes what it writes.
- C++ stays in `plugins/paintops/hairy/`, `plugins/paintops/colorsmudge/`, `plugins/paintops/libpaintop/` and the fork-owned `libs/libkis/StrokeJob.cpp`. No macOS-only code (Windows and Linux are built on CI).
- Existing presets paint exactly as before. Every new setting defaults off: `PaintMemory/Enabled` false, `DirtyBrush/Enabled` false, `HairyPaint/Pickup` false, `HairyPaint/ColorAmount` 1.0.
- Dirty brush is never a preset default; the painter always chooses it. Start on RGB; the colour-mixing module replaces only the body of `KisCarriedPaint`.
- Stroke variation (`vary_stroke`: off / small / medium) is off unless the painter chooses it. Its ranges come from measurement.
- This plan creates `creative-agent/krita-creative-agent/src/preset-seeds.json` (Task 8a). It is shared with wet-paint, which adds its watercolour entries.
- The paint-memory curve starts as `dragShare(m) = 1 − (1 − m)²`. The sweep in Task 8 may change it.
- No setting or preset reaches the painter before its measured catalog card. The switch `brush_carries_paint` (boolean, default false) gates everything for the A/B; the artist decides the default afterwards.
- Live tests:
  - Toska only, through MCP `creative_test_*`, on copies at `width=6000 height=4500`. Never the artist's documents, never `brush_probe`.
  - A deadline on every wait, and each waiter's exit condition checked on real `/state` first.
  - Never install over `~/Applications/Toska.app` while it runs (`pgrep` plus a mount check; ask the user to quit). One restart per batch.
- Performance: no lag at 6000×4500. A Hairy stroke with pickup costs at most 2× the same stroke without pickup (Task 4 test).
- Commits: no co-author or AI lines; report "committed locally"; never push.

## Review Focus

1. With paint memory 0 and a clean brush, the laid colour is exactly the colour picked (byte-equal in RGBA8), in both engines. → Task 3 `testFreshLaysPickedColour`, Task 4 `testFreshBristlesLayLoadedColour`.
2. On the agent's own new, empty layer, Hairy pickup must read the paint below (the merged image). Otherwise it picks up transparency and the stroke greys out. → Task 4 `testPickUnderReadsMergedImage`.
3. A dirty brush on a new layer, or after a preset without a dirty brush, starts clean (no colour from an earlier pass). → Task 2 `testIncompatibleDataStartsClean`, Task 6 `test_dirty_state_does_not_cross_layers`.
4. Undoing a dirty-brush stroke restores the brush's previous strength and leftover. → Task 2 `testUndoRestoresBrushState`.
5. The painter names a setting with no card, or a `t)` preset with no card. → Task 7 tests `uncarded choice is refused` and `uncarded Toska preset is refused`.

## Assumptions and spec notes

- **Strength direction.** The proposal's formula `carried = brush × strength + leftover × (1 − strength)` is confirmed in the binary study. Under it, strength 1 is a clean brush and each stroke's fade makes the brush *dirtier*. The proposal's words "gets cleaner" describe the opposite. This plan implements the formula. The user may flip it with one line in `KisDirtyBrushState::startColor`.
- Interstroke data lives on the layer's paint device:
  - a dirty brush carries between strokes on one layer (a pass and its continuations);
  - it never carries across the agent's passes, because each pass paints a new layer;
  - it is dropped when a preset without a dirty brush paints on that layer;
  - it is unavailable in wash mode, because Krita does not allow interstroke data together with indirect painting.
- `KisInterstrokeData::beginTransaction()` runs before the paintop is constructed: `kis_painter_based_stroke_strategy.cpp` creates the transaction first, then the painters. Task 2's test confirms this.
- Colour-mixing module (see colour-mixing/tasks.md): `plugins/paintops/libpaintmix/`, static lib `kritapaintmix`, namespace `KisPaintMix`:
  - `enum class Model { Rgb, LinearLight, Perceptual, Spectral, Pigment }`
  - `struct Rgb { float r, g, b; }` (straight, sRGB-encoded, 0..1)
  - `Rgb mix2(Model, Rgb a, Rgb b, float t)` (t is b's share)
  - `struct Settings { Model model; bool mixOnBrush = true; bool mixInWetPaint = false; }`
  
  The preset keys that store `Settings` are the ones colour-mixing/tasks.md defines. Task 9 reads them through that plan's reader.
- Per-stroke variation: sensors are stored as preset properties (`KisKritaSensorPack::read`):
  - `Pressure<id>`: the option is on;
  - `<id>Sensor`: XML `<params id="fuzzystroke">` with its curve;
  - `<id>Value`: the strength;
  - `<id>UseCurve`.
  
  The HSV option ids are `h`, `s` and `v` (`KisStandardOptionData.h`). So `presetProperties` can switch variation on with no dedicated preset, on engines that have the HSV options: pixel brush (`paintbrush`) and `colorsmudge`, not Hairy. It is unconfirmed whether agent stroke jobs seed the per-stroke random source repeatably; Task 8b's test records the answer.
- Seed sources:
  - `local-notes/realistic-paint-study/findings-shaders-presets.md` (tuned table, 18 tools);
  - `local-notes/rebelle-study/findings-data.md` (preset table);
  - the full Rebelle dump `scratchpad/rebelle-data/brushes_flat.json` (session scratchpad, git-ignored).
  
  The seeds file holds only numbers and source app/tool names.

---

### Task 1: Paint memory curve and its option data (libpaintop)

**Files:**
- Create: `plugins/paintops/libpaintop/KisPaintMemory.h`, `.cpp`; `plugins/paintops/libpaintop/KisPaintMemoryOptionData.h`, `.cpp`
- Modify: `plugins/paintops/libpaintop/CMakeLists.txt` (sources), `plugins/paintops/libpaintop/tests/CMakeLists.txt`, `agent/ci-tests.txt`
- Test: `plugins/paintops/libpaintop/tests/KisPaintMemoryTest.cpp`, `.h`

**Interfaces:**
- Produces:
  - `namespace KisPaintMemory { qreal dragShare(qreal memory, const QString &curve = QStringLiteral("square")); QStringList curves(); }`. Curve `"square"` is `1 − (1 − m)²` and `"linear"` is `m`. Memory is clamped to [0, 1]; an unknown curve falls back to `"square"`.
  - `struct KisPaintMemoryOptionData { bool enabled {false}; qreal memory {0.5}; QString curve {"square"}; bool read(const KisPropertiesConfiguration*); void write(KisPropertiesConfiguration*) const; }`, with keys `PaintMemory/Enabled`, `PaintMemory/Value`, `PaintMemory/Curve`.

- [ ] **Step 1: Write the failing tests:**
  - `testDragShareEnds`: `dragShare(0) == 0`, `dragShare(1) == 1`, `dragShare(0.5) == 0.75`, `dragShare(-1) == 0`, `dragShare(2) == 1`.
  - `testLinearCurve`: `dragShare(0.3, "linear") == 0.3`.
  - `testUnknownCurveIsSquare`.
  - `testOptionRoundTrip`: write then read gives the same data; a configuration without the keys reads `enabled == false`.
- [ ] **Step 2: Build and run** `agent/run-tests.sh KisPaintMemoryTest`; expect a build failure (`KisPaintMemory.h` not found).
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Build and run;** expect `Totals: 6 passed, 0 failed` (4 tests plus init/cleanup).
- [ ] **Step 5: Commit** `Paint memory: one 0-1 setting reshaped by a curve (square to start), shared by Color Smudge and Hairy`.

### Task 2: Dirty brush state and its stroke-end hook (libpaintop)

**Files:**
- Create (all in `plugins/paintops/libpaintop/`): `KisCarriedPaint.h`, `.cpp`; `KisDirtyBrushOptionData.h`, `.cpp`; `KisDirtyBrushState.h`, `.cpp`; `KisDirtyBrushInterstrokeData.h`, `.cpp`
- Modify: `plugins/paintops/libpaintop/CMakeLists.txt`, `tests/CMakeLists.txt`, `agent/ci-tests.txt`
- Test: `plugins/paintops/libpaintop/tests/KisDirtyBrushTest.cpp`, `.h`

**Interfaces:**
- Produces:
  - `namespace KisCarriedPaint { KoColor mix(const KoColor &a, const KoColor &b, qreal weightB); void varyBrightness(KoColor &c, qreal amount); }`
    - `mix` uses `a.colorSpace()->mixColorsOp()` with weights `(1 − w, w)`, which is today's RGB behaviour in the layer's colour space. `w` is clamped to [0, 1]; `w == 0` returns `a` byte-identical; `w == 1` returns `b` converted to `a`'s space.
    - `varyBrightness` mixes towards white (`amount > 0`) or black (`amount < 0`) by `|amount|` and keeps alpha.
    - This is the only place the colour-mixing module is called later; Task 9 adds a `const KisPaintMix::Settings&` parameter.
  - `struct KisDirtyBrushOptionData { bool enabled {false}; qreal fadeStep {0.2}; read/write }`, with keys `DirtyBrush/Enabled`, `DirtyBrush/Fade`.
  - `class KisDirtyBrushState { public: struct Snapshot; void beginStroke(const KoColor &paintColor); qreal strength() const; KoColor startColor(int slot, const KoColor &loaded) const; void setPending(int slot, const KoColor &carried); void commitStroke(qreal fadeStep); Snapshot snapshot() const; void restore(const Snapshot &); bool carrying() const; KoColor leftoverAverage() const; }`
    - `beginStroke`: a paint colour different from the last one sets strength to 1.
    - `startColor` is `KisCarriedPaint::mix(loaded, leftover[slot % n], 1 − strength)`, or `loaded` when there is no leftover.
    - `commitStroke`: leftover becomes pending (pending is emptied) and strength becomes `max(0, strength − fadeStep)`.
    - `carrying()` is true when a leftover exists and strength < 1.
  - `struct KisDirtyBrushInterstrokeData : KisInterstrokeData { KisDirtyBrushState state; qreal fadeStep; }`. `beginTransaction()` stores a snapshot. `endTransaction()` returns a command whose `redo()` runs `commitStroke(fadeStep)` and whose `undo()` restores the snapshot.
  - `class KisDirtyBrushInterstrokeDataFactory : KisInterstrokeDataFactory`, where `isCompatible` succeeds exactly when the `dynamic_cast` succeeds.

- [ ] **Step 1: Write the failing tests:**
  - `testMixEnds`: w 0 gives `a` byte-equal; w 1 gives `b`; w 0.5 of red and blue in RGBA8 gives (128, 0, 128) ±1.
  - `testNewColourResetsStrength`: strength is 0.4 after some strokes; `beginStroke(otherColour)` sets it to 1.0.
  - `testFadePerFinishedStroke`: with fade 0.25, strength goes 1 → 0.75 → 0.5 … → 0, never negative, and does not change without a commit.
  - `testStartColourFormula`: strength 0.25, loaded red, leftover blue gives `mix(red, blue, 0.75)`.
  - `testUndoRestoresBrushState`: begin the data, change the state, call `endTransaction()->redo()` then `undo()`; the begin snapshot comes back exactly.
  - `testIncompatibleDataStartsClean`: the factory refuses another `KisInterstrokeData` subclass defined in the test, so `KisInterstrokeDataTransactionWrapperFactory` creates fresh data with no leftover.
  - `testBeginRunsBeforePaintOp`: for a `KisTransaction` with the wrapper factory on a device, `beginTransaction` has been called by the time the transaction constructor returns.
- [ ] **Step 2: Build and run** `agent/run-tests.sh KisDirtyBrushTest`; expect a build failure.
- [ ] **Step 3: Implement** the four pairs of files.
- [ ] **Step 4: Build and run;** expect `0 failed`, then rerun `KisPaintMemoryTest`.
- [ ] **Step 5: Commit** `Dirty brush: leftover colour carried between strokes, strength reset on a new colour and faded once per finished stroke (undoable)`.

### Task 3: Paint memory and dirty brush in Color Smudge

**Files:**
- Modify:
  - `plugins/paintops/colorsmudge/kis_colorsmudgeop.h`;
  - `kis_colorsmudgeop.cpp:55-252`: read the two option data; smudge rate; dirty start colour and pending leftover; factory;
  - `KisColorSmudgeInterstrokeData.h/.cpp`: embed `KisDirtyBrushState` and the fade step; `endTransaction` adds the commit command as a child;
  - `kis_colorsmudgeop_settings_widget.cpp`: two option widgets after Smudge Length (a paint-memory slider with an enable box; dirty brush enable plus fade).
- Create: `plugins/paintops/libpaintop/KisPaintMemoryOptionWidget.h/.cpp` and `KisDirtyBrushOptionWidget.h/.cpp`, lager model/widget pairs in the style of `KisHairyInkOption*`, reused by Hairy.
- Test: `plugins/paintops/colorsmudge/tests/KisColorsmudgeOpTest.cpp` (new functions)

**Interfaces:**
- Consumes: Task 1 `dragShare`, `KisPaintMemoryOptionData`; Task 2 state, data, factory and `KisCarriedPaint`.
- Produces:
  - With `PaintMemory/Enabled`: `smudgeRate = dragShare(m, curve) × sensor`, where `sensor = computeSizeLikeValue(info) / strengthValue()` (1 when the strength is 0), and `maxSmudgeRate = dragShare(m, curve)`.
  - With `DirtyBrush/Enabled`: the op's paint colour at stroke start is `state.startColor(0, paintColor)`. Each dab calls `setPending(0, average colour under the dab)`, using `sampleDullingColor` on the destination rect.
  - `createInterstrokeDataFactory` returns:
    - the Color Smudge factory for `LIGHTNESSMAP` (its data now carries the dirty state too);
    - else `KisDirtyBrushInterstrokeDataFactory` when the dirty brush is on and the painting mode is BUILDUP;
    - else null.

- [ ] **Step 1: Write the failing tests:**
  - `testFreshLaysPickedColour`: paint memory on, m 0, colour rate 1, orange over a blue ground; every opaque stroke pixel is byte-equal orange.
  - `testMemoryDragsGround`: with m 0.8 and colour rate 0.3, a stroke starting on blue carries blue at least 3× further into the tan half than with m 0.2. Measure the run of pixels within ΔRGB 40 of blue.
  - `testDisabledMemoryIsUnchanged`: an existing preset renders byte-identical to the stored reference image in `tests/data`.
  - `testDirtyBrushCarriesLeftover`: two strokes, same colour, fade 0.5; the second stroke's first dab is nearer the ground colour than the first stroke's.
  - `testDirtyResetsOnNewColour`.
- [ ] **Step 2: Build and run** `agent/run-tests.sh KisColorsmudgeOpTest`; expect the new functions to FAIL.
- [ ] **Step 3: Implement** in the files above.
- [ ] **Step 4: Run;** expect `0 failed`, including the existing functions.
- [ ] **Step 5: Commit** `Color Smudge: paint memory beside smudge length, and a dirty brush through its interstroke data`.

### Task 4: Per-bristle paint in Hairy

**Files:**
- Modify:
  - `plugins/paintops/hairy/bristle.h/.cpp`: carried and loaded colours;
  - `hairy_brush.h/.cpp:96-236`: pickup, carry, load and brightness per step;
  - `kis_hairy_paintop.h/.cpp`: read the options, pickup source, dirty state, `createInterstrokeDataFactory`;
  - `kis_hairy_paintop_settings_widget.cpp`: the new option widget plus Task 3's two widgets;
  - `CMakeLists.txt`: `add_subdirectory(tests)` and the new sources;
  - `agent/ci-tests.txt`.
- Create: `plugins/paintops/hairy/KisHairyPaintOptionData.h/.cpp`, `KisHairyPaintOptionModel.h/.cpp`, `KisHairyPaintOptionWidget.h/.cpp`; `plugins/paintops/hairy/tests/CMakeLists.txt`, which compiles `../bristle.cpp ../hairy_brush.cpp ../trajectory.cpp` into the test and links `kritalibpaintop kritaimage kritatestsdk`.
- Test: `plugins/paintops/hairy/tests/KisHairyPaintTest.cpp`, `.h`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `struct KisHairyPaintOptionData { bool pickup {false}; bool pickUnder {false}; qreal colorAmount {1.0}; qreal brightnessVariation {0.0}; read/write }`, with keys `HairyPaint/Pickup`, `HairyPaint/PickUnder`, `HairyPaint/ColorAmount`, `HairyPaint/BristleBrightness`.
  - `KisHairyProperties` gains `pickup`, `colorAmount`, `dragShare` and `brightnessVariation`.
  - `Bristle::carried()/setCarried()/loaded()/setLoaded()`.
  - `HairyBrush::setPickupSource(KisPaintDeviceSP)` and `HairyBrush::setDirtyState(KisDirtyBrushState*)` (null means a clean brush).
- Step rule for bristle `i` at each path step `pos` (only when `pickup` is on):
  ```
  first step of the stroke: loaded_i = dirty ? state.startColor(i, ink) : ink;  carried_i = loaded_i
  P = source colour at pos (before this step lays paint)
  carried_i = KisCarriedPaint::mix(carried_i, P, dragShare)        // P with alpha 0 leaves carried_i unchanged
  laid      = KisCarriedPaint::mix(carried_i, loaded_i, colorAmount)
  laid      = varyBrightness(laid, brightnessVariation × (i odd ? 1 : −1) × (0.5 + 0.5 × u_i))
              // u_i in [0,1): a fixed integer hash of i (no RNG state), so streaks repeat for the same strokes
  then the existing ink-depletion/opacity logic on `laid`; at stroke end state.setPending(i, carried_i)
  ```
- Pickup source:
  - With `pickUnder`: a `KisOverlayPaintDeviceWrapper` over `image->projection()`, read per segment under `blockUpdates()` as `KisColorSmudgeSourceImage::readRects` does. Each segment's dab is also written into the overlay, so the bristles see the stroke's own paint.
  - Otherwise: the layer device (`m_dev`).
  - Sampling goes through `KisCrossDeviceColorSamplerInt`.

- [ ] **Step 1: Write the failing tests:**
  - `testFreshBristlesLayLoadedColour`: pickup on, memory 0; every laid pixel is byte-equal the ink colour.
  - `testTwoColourStreaks`: ground blue on the left and yellow on the right; one stroke from blue into yellow with memory 0.7 and colour amount 0.2. In the yellow half, at least 15% of stroke pixels are nearer blue and at least 15% nearer yellow, classified by ΔRGB.
  - `testPickUnderReadsMergedImage`: painting on an empty layer above a blue layer, the laid colour moves towards blue with `pickUnder` and does not without it.
  - `testBrightnessVariationIsRepeatable`: the same stroke twice is byte-identical; variation 0.1 makes neighbouring bristles differ.
  - `testPickupOffIsUnchanged`: with pickup off, the render is byte-identical to the build before this task (reference saved in `tests/data`).
  - `testPickupCostAtMostTwice`: 300 px brush, 2000 px stroke on a 6000×4500 device; pickup time ≤ 2.0 × no-pickup time, median of 3.
- [ ] **Step 2: Build and run** `agent/run-tests.sh KisHairyPaintTest`; expect FAIL.
- [ ] **Step 3: Implement.** Soak ink and ink depletion keep working: a pickup-off stroke with soak ink matches the reference.
- [ ] **Step 4: Run;** expect `0 failed`.
- [ ] **Step 5: Commit** `Hairy: each bristle picks up the paint under its tip, carries it by paint memory and lays it mixed with its loaded colour`.

### Task 5: Dirty brush in Hairy and in the agent's stroke jobs

**Files:**
- Modify:
  - `plugins/paintops/hairy/kis_hairy_paintop.cpp`: a static `createInterstrokeDataFactory` that returns the dirty factory when `DirtyBrush/Enabled` and BUILDUP, else null; hand `state` to the brush;
  - `libs/libkis/StrokeJob.cpp:235-250`: constructor flags.
- Test: `plugins/paintops/hairy/tests/KisHairyPaintTest.cpp`, `libs/libkis/tests/TestStrokeJobs.cpp`

**Interfaces:**
- Consumes: Task 2, Task 4.
- Produces: `StrokeJobStrokeStrategy` passes `FreehandStrokeStrategy::SupportsContinuedInterstrokeData` exactly when the job preset's settings have `DirtyBrush/Enabled` true. A static helper reads the setting before the base constructor runs. So a dirty brush carries between the strokes of one job, and other jobs are unchanged.

- [ ] **Step 1: Write the failing tests:**
  - Hairy `testDirtyBristlesStartFromLeftover`: two strokes, fade 0.5; bristle `i` of stroke 2 starts at `mix(ink, leftover_i, 0.5)`.
  - `TestStrokeJobs::testDirtyBrushCarriesWithinAJob`: `paintStrokes` with `presetProperties {"DirtyBrush/Enabled": true}` on a Color Smudge preset; after stroke 2 the device's interstroke data has strength `1 − 2 × fade`.
  - `testJobsWithoutDirtyBrushStartFresh`: without the property, each stroke gets new data, as today.
- [ ] **Step 2: Build and run** `agent/run-tests.sh KisHairyPaintTest TestStrokeJobs`; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run;** expect `0 failed` for both programs.
- [ ] **Step 5: Commit** `Dirty brush in Hairy; agent stroke jobs keep a dirty brush's state between the strokes of a pass`.

### Task 6: The plugin passes paint settings (Python)

**Files:**
- Create: `creative-agent/krita-mcp/krita-plugin/kritamcp/paint_settings.py`
- Modify:
  - `creative-agent/krita-mcp/krita-plugin/kritamcp/creative_validation.py:55-61`: the new field `preset_properties`.
  - `creative_tools.py:2020-2026`: merge into `options['presetProperties']`. Passes paint on new empty layers, so a Hairy preset with `HairyPaint/Pickup` also gets `HairyPaint/PickUnder: true`, and a Color Smudge preset with paint memory also gets `MergedPaint: true`.
  - The pass record: store `preset_properties`.
  - The stock path: refuse `preset_properties` with "needs Toska".
  - Expand `VaryStroke/*` into Krita's HSV-option keys.
- Test: `creative-agent/krita-creative-agent/tests/test_paint_settings.py`

**Interfaces:**
- Produces:
  - `validate_properties(props: dict, paintop_id: str) -> dict`:
    - accepts keys only under `PaintMemory/`, `DirtyBrush/`, `HairyPaint/`, plus `WetPaint/` for the sibling change;
    - values are numbers in [0, 1] or booleans; `PaintMemory/Curve` must be `"square"` or `"linear"`;
    - `HairyPaint/*` is allowed only for `hairybrush`;
    - raises `ValueError` naming the key.
  - `with_pickup_source(props, paintop_id) -> dict`.
  - `expand_vary_stroke(props, paintop_id) -> dict`:
    - `VaryStroke/Hue|Saturation|Value` (numbers in [0, 1]) become, per option id `h`/`s`/`v`: `Pressure<id>: true`, `<id>Sensor: '<!DOCTYPE params><params id="fuzzystroke"><curve>0,0;1,1;</curve></params>'`, `<id>UseCurve: true`, `<id>Value: n`.
    - Raises `ValueError` for `hairybrush`, and for a preset whose own `<id>Sensor` is already set (never overwrite a preset's dynamics).
    - Raw Krita keys are never accepted from the companion.

- [ ] **Step 1: Write the failing tests:**
  - `test_unknown_key_is_refused`
  - `test_hairy_keys_need_a_hairy_preset`
  - `test_values_out_of_range_are_refused`
  - `test_pickup_reads_the_paint_below`: Hairy pickup adds `PickUnder`; Color Smudge memory adds `MergedPaint`.
  - `test_pass_record_keeps_the_settings`: fake Krita, as in `test_snow_craft.py`.
  - `test_dirty_state_does_not_cross_layers`: two passes on two new layers with a dirty brush; the second job's properties carry no leftover, and each pass's record names its own layer.
  - `test_vary_stroke_expands_to_fuzzy_stroke_hsv`: the exact keys and XML above.
  - `test_vary_stroke_refused_on_hairy`
  - `test_raw_sensor_keys_are_refused`
- [ ] **Step 2: Run** the plugin tests with `-p 'test_paint_settings*.py'`; expect FAIL (`No module named kritamcp.paint_settings`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run;** expect `OK`, then run the whole plugin suite with `-p 'test_*.py'`.
- [ ] **Step 5: Commit** `paint_pass takes paint settings as preset properties on the job's own copy, whitelisted, recorded with the pass`.

### Task 7: The painter's choices (companion)

**Files:**
- Create: `creative-agent/krita-creative-agent/src/paint-settings.ts`
- Modify:
  - `src/tools.mjs:231-240`: optional `paint_memory: 'drag'|'fresh'`, `brush: 'clean'|'dirty'` and `vary_stroke: 'off'|'small'|'medium'` on `paint_pass`. Each is present only when the switch is on and the choice has a card; execute maps them to `preset_properties`.
  - `src/settings-schema.mjs`: `{ key: 'brush_carries_paint', type: 'boolean', default: false, label: 'Brushes carry paint (experimental)' }`.
  - `src/brush-catalog.json`: a `settings` object, empty until Task 8.
  - `src/brush-catalog.mjs`: `brushGuide` adds one line per carded choice when the switch is on.
  - `src/studio.mjs`: the dirty-brush note, where the move prompt lists recent passes.
  - `scripts/run-unit-tests.mjs` and `tsconfig.json`: pick up `tests/*.test.ts`, if the TypeScript-tests switch has not landed yet.
- Test: `creative-agent/krita-creative-agent/tests/paint-settings.test.ts`

**Interfaces:**
- Consumes: Task 6 `preset_properties`.
- Produces:
  - `type PaintChoice = { paint_memory?: 'drag' | 'fresh'; brush?: 'clean' | 'dirty'; vary_stroke?: 'off' | 'small' | 'medium' }`.
  - `paintProperties(choice: PaintChoice, preset: string, catalog: Catalog): { properties: Record<string, number | boolean | string> } | { error: string }`. Values come from `catalog.settings["paint_memory:drag"].properties`, `["vary_stroke:small"]` and so on. `vary_stroke: 'off'` adds nothing. A choice or a `t)` preset without a card is an error.
  - `dirtyCarry(passes: PassRecord[], layerId: string): { colour: string; strength: number } | null`, computed from the layer's last dirty pass and its stroke count × fade.
  - `dirtyNote(carry): string`: "The brush on <layer> is still dirty with <colour>; choose brush: clean for a highlight".

- [ ] **Step 1: Write the failing tests:**
  - `uncarded choice is refused`
  - `uncarded Toska preset is refused`
  - `drag and fresh map to their measured properties`
  - `nothing is chosen by default`: no `paint_memory`/`brush` gives no properties.
  - `off: paint_pass has neither field`
  - `the planner hears about a dirty brush on a continued layer`
  - `a new layer is never reported dirty`
  - `vary_stroke maps to its measured HSV ranges`
- [ ] **Step 2: Run** `npm run test:unit`; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:unit` and `npm run typecheck`; expect both clean.
- [ ] **Step 5: Commit** `The painter chooses drag or fresh paint, a clean or dirty brush and per-stroke variation, only from measured cards, behind Brushes carry paint`.

### Task 8a: Preset seeds from the studies' tuned values

**Files:**
- Create: `creative-agent/krita-creative-agent/src/preset-seeds.json`, `src/preset-seeds.ts`
- Test: `creative-agent/krita-creative-agent/tests/preset-seeds.test.ts`

**Interfaces:**
- Produces:
  - `type Seed = { preset: string; engine: 'hairybrush' | 'colorsmudge' | 'paintbrush'; settings: Record<string, number | boolean>; sources: { app: 'Realistic Paint Studio' | 'Rebelle'; tool: string; field: string; value: number; mapping: 'direct' | `reshaped: ${string}` | 'unmapped' }[] }`.
  - `readSeeds(file?: string): Seed[]`, validated by a TypeBox schema with `additionalProperties: false`.
  - `seedFor(preset: string): Seed | null`.
  - Wet-paint Task 4 appends its entries to the same file.
- Mapping rules (the file records which rule each number used):
  ```
  RPS hale (stored v)          → PaintMemory/Value  direct (our memory is RPS's stored value; dragShare reshapes it)
  RPS camt (colour amount)     → HairyPaint/ColorAmount direct; Color Smudge ColorRateValue reshaped: sqrt(camt)
                                 (Krita squares colour rate in colorRateOpacity)
  RPS bristb                   → HairyPaint/BristleBrightness direct
  RPS opa (base)               → OpacityValue direct
  RPS dirty on/off, dstr       → recorded as 'unmapped' (dirty is never a preset default; the probe sets DirtyBrush/Fade)
  Rebelle opacity, spacing     → OpacityValue, Spacing direct (from findings-data.md or brushes_flat.json)
  ```
- Seeds for this change:
  - `t) Toska Bristle Carry` from RPS "Oil Flat" and "Oil Filbert";
  - `t) Toska Smudge Drag` from RPS "Oil Dirty flat" (hale, camt) and Rebelle's PAINT_MIX oils.

- [ ] **Step 1: Write the failing tests:**
  - `seeds validate and carry only numbers, booleans and sources`: no free text beyond app/tool/field names, no image or binary data.
  - `every seed names at least one source`
  - `unknown keys are refused`
  - `each seeded preset is installed by krita/data/paintoppresets/CMakeLists.txt`: the test reads the install list.
- [ ] **Step 2: Run** `npm run test:unit`; expect FAIL. Write the file from the two tables and `scratchpad/rebelle-data/brushes_flat.json`: read the dump with `python3 -I` and copy the numbers by hand into the seeds file; the dump itself is never committed. Then `npm run test:unit` and `npm run typecheck` are clean.
- [ ] **Step 3: Commit** `Preset seeds: decoded tuned values from the studies mapped to Krita settings, with their source tool`.

### Task 8b: Per-stroke colour variation through the Fuzzy Stroke sensor

**Files:**
- Test: `libs/libkis/tests/TestStrokeJobs.cpp` (new functions; no engine change)

**Interfaces:**
- Consumes: Task 6 `expand_vary_stroke`; its key set is copied into the C++ test as literal properties.

- [ ] **Step 1: Write the tests:**
  - `testFuzzyStrokeVariesEachStroke`: a pixel brush preset with `presetProperties` set to the expansion with `vValue 0.3`. Ten one-colour strokes give at least 5 distinct mean colours, and each stroke is uniform within ΔRGB 2 along its length.
  - `testNoVariationWithoutTheProperties`: the same job without the properties; all strokes are byte-equal in colour.
  - `testVariationRepeatsForTheSameJob`: two identical jobs; record whether the colours repeat. If they do not, the card says "not repeatable" and the plan does not claim determinism for variation.
- [ ] **Step 2: Build and run** `agent/run-tests.sh TestStrokeJobs`. Expect the first two to PASS against Krita as it is (there is no code to write). If `testFuzzyStrokeVariesEachStroke` fails, inspect the stored keys of a preset saved from the editor and correct Task 6's expansion, not the engine.
- [ ] **Step 3: Commit** `Tests: per-stroke colour variation comes from Krita's Fuzzy Stroke sensor through job preset properties`.

### Task 8: Presets, live probes and catalog cards

**Files:**
- Create: `krita/data/paintoppresets/t)_Toska_Bristle_Carry.kpp` (Hairy) and `t)_Toska_Smudge_Drag.kpp` (Color Smudge), with the values from `seedFor(name)` (Task 8a). Author them in Toska's brush editor and copy them from the resource folder.
- Create: `creative-agent/krita-creative-agent/scripts/measure_paint_probe.py`
- Modify: `krita/data/paintoppresets/CMakeLists.txt` (install list), `creative-agent/krita-creative-agent/src/brush-catalog.json` (cards and `settings`)
- Test: `creative-agent/krita-creative-agent/tests/test_measure_paint_probe.py`

**Interfaces:**
- Produces:
  - `streak_shares(rgba, a_hex, b_hex, rect) -> {"a": float, "b": float}`.
  - `drag_length(rgba, ground_hex, rect, axis="x", tolerance=40) -> int` (pixels).
  - Cards: `cards["t) Toska Bristle Carry"]`, `cards["t) Toska Smudge Drag"]`.
  - `settings["paint_memory:drag"|"paint_memory:fresh"|"brush:dirty"|"brush:clean"|"vary_stroke:small"|"vary_stroke:medium"] = { card: string, properties: {...}, measured: {...} }`.

- [ ] **Step 1: Write the failing tests** on synthetic arrays: `test_streak_shares_counts_both_colours`; `test_drag_length_stops_at_the_ground`.
- [ ] **Step 2: Run** with `-p 'test_measure_paint_probe*.py'`; expect FAIL. Implement; expect `OK`.
- [ ] **Step 3: Build, package, check and install** once:
  - `zsh agent/package-app.sh`, then `--check` with 0 problems;
  - `pgrep -x krita` must be empty and no Toska mount present; otherwise ask the user to quit;
  - `zsh agent/install-app.sh`;
  - one restart.
- [ ] **Step 4: Probe live.** Use `creative_test_start width=6000 height=4500`, a blue|tan ground as in the 154 probes, and orange paint; every wait has a deadline.
  - Per preset: the standard 40 px stroke at pressure 0.9, plus the two-colour probe (one stroke from blue into yellow).
  - The paint-memory sweep `m ∈ {0, 0.25, 0.5, 0.75, 1}` on both engines.
  - The dirty probe: three strokes with fade 0.3, then a new colour.
  - The variation probe: ten strokes each at `vary_stroke` small and medium, on `b) Basic-1` and `t) Toska Smudge Drag`, measuring the spread of the stroke means in hue, saturation and value.
  
  Save the canvases to the test's output folder and measure them with the script.
- [ ] **Step 5: Decide from the numbers:**
  - Keep `square` when `drag_length` against `m` fits a line with R² ≥ 0.9; otherwise try `linear` and keep the better curve.
  - The bristle preset passes when both streak shares are ≥ 0.15.
  - m 0 must be byte-equal fresh paint.
  - `small` and `medium` are the HSV strengths whose stroke-mean spread is about ΔE 3 and ΔE 7; adjust and re-probe once.
  - Where a probe moves a seeded value, update `preset-seeds.json` with `mapping` unchanged and note the measured value in the card.
  
  Write the cards (one line each, in the house style) and `settings` with their measured values.
- [ ] **Step 6: Commit** `Toska bristle and smudge presets with measured cards; paint-memory sweep picks the curve`. Commit cards and presets only; no screenshots in git.

### Task 9: Switch the seam to the colour-mixing module

Starts when the module from colour-mixing/tasks.md has landed.

**Files:**
- Modify:
  - `plugins/paintops/libpaintop/KisCarriedPaint.h/.cpp`: `mix(a, b, w, const KisPaintMix::Settings&)`.
    - With `Model::Rgb` or `mixOnBrush == false`, keep today's `KoMixColorsOp` path, byte-identical.
    - Otherwise, convert both colours to straight sRGB-encoded floats through `KoColorSpaceRegistry`'s sRGB F32 space, call `KisPaintMix::mix2(model, a, b, w)`, and convert back to `a`'s space. Alpha mixes linearly by `w`.
  - `plugins/paintops/libpaintop/CMakeLists.txt`: link `kritapaintmix`.
  - The Hairy and Color Smudge ops: read the preset's `KisPaintMix::Settings` once per stroke and pass it.
- Test: `plugins/paintops/libpaintop/tests/KisDirtyBrushTest.cpp`

- [ ] **Step 1: Write the failing tests:**
  - `testModelIsUsed`: blue + yellow at 0.5 with `Model::Pigment` differs from the RGB result and equals `KisPaintMix::mix2(Model::Pigment, …, 0.5)` within 1/255.
  - `testRgbUnchanged`: `Model::Rgb` is byte-equal to the Task 2 result.
  - `testMixOnBrushOffKeepsRgb`.
- [ ] **Step 2: Run, expect FAIL; implement; run** `agent/run-tests.sh KisDirtyBrushTest KisHairyPaintTest KisColorsmudgeOpTest`; expect `0 failed`.
- [ ] **Step 3: Commit** `Carried paint mixes through the colour-mixing module, by the preset's model`.

### Task 10: A/B test

- [ ] Paint the same still life (with clear colour joins) twice at 6000×4500, with the same prompt, model and seed: once with `brush_carries_paint` on and once off. Record each run's stroke count and time from the pass records.
- [ ] Luna judges the pair blind: images only, order shuffled by a recorded seed. Use the colour-mixing A/B script if it exists; otherwise write a small `scripts/ab-blind-luna.ts` with a test that the request carries no labels. Label the results as offline.
- [ ] Send both paintings to the artist. Record both verdicts, the counts and the times in the change folder; the artist decides the default. Then do New Moscow the same way.

