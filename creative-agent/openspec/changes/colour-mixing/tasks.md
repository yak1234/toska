# Colour Mixing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brushes mix colour by a chosen model (RGB as today, linear light, perceptual, spectral, pigment/Mixbox). The work starts with MyPaint's spectral `paint_mode` and ends with the same models in Color Smudge. The painter can preview any mix with `mix_colors`, using the numbers the brushes use. Every model is gated by measured catalog cards and a blind A/B.

**Architecture:** One new static C++ library, `plugins/paintops/libpaintmix/` (namespace `KisPaintMix`): pure functions over straight, sRGB-encoded floats, plus a pixel-buffer blend; no Qt widgets, no Krita libraries. MyPaint (a `MyPaintSurface2` adapter, used only when a preset opts in) and Color Smudge (a mixing option hooking the strategy's smear, dulling and colour-rate blends) both call it. The companion carries a strict TypeScript port of the same maths, held to the C++ output by a shared `golden.json`. The plugin turns a `mixing_model` pass parameter into job-local preset properties and makes blending passes on new layers sample the paint below.

Build order follows the proposal (MyPaint spectral → module → Mixbox → Color Smudge). The module's spectral core lands first (Task 1) so MyPaint calls it rather than carrying a second port. A/B gate 1 follows MyPaint plus the module (Task 8); gate 2 follows Color Smudge with every model (Task 11).

**Tech Stack:** C++17, CMake (`kis_add_library`, `kis_add_test`), QTest, libmypaint 1.6.1 (bundled), Python plugin (unittest via uv), TypeScript strict on Node 24 (type stripping), TypeBox, Pi SDK `ToolDefinition`.

**Spec:** `creative-agent/openspec/changes/colour-mixing/proposal.md`

## Global Constraints

- **Benchmark scenes (2026-11-01; overrides any scene named in this plan):** every A/B gate follows `creative-agent/openspec/benchmark-scenes.md` — fixed goal images, 3 runs per arm, blind Luna + the user, and the muddiness / stroke-count / repetition / observe-time measurements. "Still life" means scene 1; New Moscow and the artist's own paintings are never used.
- **Default is upstream behaviour.** A preset without the new properties paints byte-identically to today: RGB mixing, MyPaint's legacy `mypaint_brush_stroke_to`, Color Smudge's own composite ops. A model changes painting only when a preset or a pass names it.
- **Model ids, verbatim everywhere** (C++, preset XML, plugin, companion): `rgb`, `linear`, `perceptual`, `spectral`, `pigment`.
- **Preset properties:** Color Smudge: `ToskaMixingModel` (string, default `rgb`), `ToskaMixOnBrush` (bool, default true), `ToskaMixInWetPaint` (bool, default false; stored only, for `wet-paint`). MyPaint: `ToskaMyPaintPaintMode` (float 0–1; overrides the brush's `paint_mode` base value when present), `ToskaMyPaintSampleMerged` (bool, default false).
- **Unmixed colours are exact.** In every model, `t == 0`, `t == 1`, `a == b`, or a single non-zero weight returns the input bit-for-bit, as a short-circuit before any transform (the spectral round trip alone is not exact: 133/255 comes back as 132.993).
- **Colour convention.** Module inputs and outputs are straight, sRGB-encoded components in 0..1. `linear` and `perceptual` decode and re-encode internally. `spectral` works on the encoded values, as libmypaint's non-linear `stroke_to_2` does, so brush-side and canvas-side MyPaint agree. `pigment` takes encoded values, as Mixbox does.
- **Spectral sources.** Constants (`T_MATRIX_SMALL`, `spectral_r_small`, `spectral_g_small`, `spectral_b_small`, `WGM_EPSILON = 0.001`) and the dab blend are copied from libmypaint 1.6.1 (`helpers.c` 39–60 and 521–600, `brushmodes.c` 73–135) with an attribution comment naming files and lines; `fastpow`, `fastlog2`, `fastpow2` from libmypaint's `fastapprox/`, keeping their header. Reference source: `/private/tmp/claude-501/-Users-yakubrabiutheen-Documents-digital-art-krita/b2c8bebf-e443-45ec-b841-b80cccc350dd/scratchpad/libmypaint-src/libmypaint-1.6.1` (re-download the 1.6.1 release tarball if gone). libmypaint's licence file is `COPYING` there.
- **Mixbox sources.** Only the published paper (SIGGRAPH Asia 2021, "Practical Pigment Mixing for Digital Painting") and the public code at github.com/scrtwpns/mixbox, at a pinned commit recorded in file headers. Nothing from the Rebelle binary or `local-notes/rebelle-study/`.
- **File placement.** New C++ only in `plugins/paintops/libpaintmix/`, `plugins/paintops/mypaint/`, `plugins/paintops/colorsmudge/`, plus one `add_subdirectory` in `plugins/paintops/CMakeLists.txt`. Every edited upstream file gets a row in `AGENT-FORK.md` "Upstream files we edit" in the same commit. New files carry `SPDX-License-Identifier: GPL-2.0-or-later` and `SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>`.
- **Cross-platform.** Windows and Linux build on CI: no macOS-only code. The module uses only `<cmath>`, `<cstdint>`, `<optional>`, `<string_view>`.
- **Build.** Only `nice -n 19 env CMAKE_BUILD_PARALLEL_LEVEL=8 zsh agent/build-macos.sh`, never Homebrew ninja; `--tests` only if `_build` is configured anew.
- **C++ tests.** Only `agent/run-tests.sh <Program> [function…]`. QTest, absolute paths inside `QTemporaryDir`, `QVERIFY` every pointer, never dialogs. Every program added or touched goes in `agent/ci-tests.txt`.
- **Plugin tests.** From `creative-agent/krita-creative-agent`: `uv run -q --with pyqt5 --with pillow --with numpy --with httpx --with opencv-python-headless python -m unittest discover -s tests -p 'test_mixing*.py'`.
- **Companion.** New modules and tests strict `.ts`; `npm run test:unit` and `npm run typecheck`; tests delete their temp files.
- **Live tests.** Toska via MCP `creative_test_*` (fork server, `KRITA_URL` 5679), copies only, `width=6000 height=4500`, never `brush_probe`. Before `agent/install-app.sh`: `pgrep -fl "Toska.app/Contents/MacOS"` and `mount | grep -i toska`; if Toska runs, ask the artist to quit. One install and one restart per batch.
- **Gates.** No model or (preset, model) pair reaches the painter before a measured card in `brush-catalog.json` `mixing`. A/B gates at 6000×4500 on a simple still life, blind, Luna and the artist. Gate 1 (Task 8) before Tasks 9–11; gate 2 (Task 11) before any preset's default model changes.
- **Commits.** No co-author or AI attribution lines. "Committed locally"; nothing pushed.

## Review Focus

1. **Layers that are not 8/16-bit RGBA** (F16, F32, Lab, CMYK, grey) and Color Smudge presets in a non-normal blend mode: the model falls back to Krita's own mixing, painting unchanged, no crash. → Task 10 `testNonRgbColourSpaceFallsBack`, `testNonNormalCompositeKeepsKritaOp`; Task 2 `testSpectralDab16BitAndFloat`.
2. **MyPaint eraser, lock-alpha or colorize brushes with `paint_mode` > 0:** eraser path unchanged, only normal dabs mix spectrally. → Task 2 `testEraserIgnoresPaintMode`.
3. **Presets without the properties, or with an unknown model id:** load as `rgb`, no message box. → Task 10 `testUnknownModelReadsAsRgb`.
4. **Nearly transparent paint:** finite results, no NaN, no dark fringes. → Task 3 `testBlendPixelsTinyAlphaIsFinite`.
5. **`mix_colors` with odd input** (one colour, amounts summing to 0, a bad hex, more than 6 colours, a model with no card): a clear refusal naming the problem. → Task 6 `mix_colors refuses odd input with the reason`.

**Assumptions not confirmed in code** (each verified by the named task's first step):
- A `MyPaintSurface2` with `end_atomic_multi = nullptr` is safe, since Krita never calls begin/end atomic (Task 2).
- Reading `image->projection()` from the MyPaint surface during a stroke job is as safe as Color Smudge overlay mode, which does so in `KisColorSmudgeStrategyWithOverlay.cpp:27` (Task 2).
- Paint passes inside `paint_batch` go through `paint_pass`'s `execute` (Task 6).
- The published Mixbox C++ and JS sources embed the LUT and the 20×3 polynomial table (Task 9).
- Color Smudge's final masked `COMPOSITE_COPY` at dab edges stays Krita's own RGB interpolation, as does the dulling colour average (`sampleDullingColor`); models act on the blend buffer where smear, dulling and colour rate mix (Task 10).

---

### Task 1: The mixing module: RGB and spectral

**Files:**
- Create: `plugins/paintops/libpaintmix/CMakeLists.txt`, `KisPaintMix.h`, `KisPaintMix.cpp`, `KisPaintMixSpectral.cpp`, `KisPaintMixFastMath.h`, `tests/CMakeLists.txt`, `tests/KisPaintMixTest.h`, `tests/KisPaintMixTest.cpp`
- Modify: `plugins/paintops/CMakeLists.txt:3` (`add_subdirectory( libpaintmix )` after `libpaintop`), `agent/ci-tests.txt` (`KisPaintMixTest`), `AGENT-FORK.md` (row for `plugins/paintops/CMakeLists.txt`; a "Colour mixing" section naming the library and its sources)

**Interfaces:**
- Produces (`KisPaintMix.h`, namespace `KisPaintMix`):
  - `enum class Model { Rgb, Spectral }` (Task 3 adds `LinearLight`, `Perceptual`; Task 9 adds `Pigment`)
  - `struct Rgb { float r, g, b; }`
  - `const char *modelId(Model)`; `std::optional<Model> modelFromId(std::string_view)`
  - `Rgb mix2(Model m, Rgb a, Rgb b, float t)` (`t` is b's share)
  - `Rgb mixMany(Model m, const Rgb *colours, const float *weights, int n)`
  - `void toSpectrum(Rgb c, float out[10])`; `Rgb fromSpectrum(const float s[10])`
- Library `kritapaintmix`, STATIC, `POSITION_INDEPENDENT_CODE ON`, no Krita link dependencies. Placement: `libs/pigment` is Krita's colour library; a folder under `plugins/paintops/` keeps the change out of core `libs/` at the cost of one CMake line.

- [ ] **Step 1: Write the failing tests** in `KisPaintMixTest`:
  - `testModelIds`: `modelFromId("spectral") == Model::Spectral`; `modelFromId("Spectral")` is nullopt; `modelId` round-trips every value.
  - `testRgbIsPlainLerp`: 100 fixed-seed (`std::mt19937`) pairs, `mix2(Rgb, a, b, 0.25f)` equals `a + (b - a) * 0.25f` exactly.
  - `testUnmixedColoursRoundTripExactly`: per model, `mix2(a, b, 0) == a`, `mix2(a, b, 1) == b`, `mix2(a, a, 0.4) == a` bitwise; `mixMany` with weights `{0, 2, 0}` returns `colours[1]` bitwise.
  - `testSpectralBlueYellowIsGreen`: blue (0,33,133)/255 and yellow (252,211,0)/255 at t = 0.5 give (16,94,33) ± 2 per 8-bit channel.
  - `testSpectralMatchesLibmypaint`: 64 pairs against a test-local copy of libmypaint's `mix_colors` (`powf`, `paint_mode` 1) agree within 2e-3 per channel (covers `fastpow`).
- [ ] **Step 2: Run** `nice -n 19 env CMAKE_BUILD_PARALLEL_LEVEL=8 zsh agent/build-macos.sh`. Expected: build fails, `'KisPaintMix.h' file not found`.
- [ ] **Step 3: Implement.** Spectral `mix2` = libmypaint's weighted geometric mean `s[i] = fastpow(sa[i], 1 - t) * fastpow(sb[i], t)`, then `fromSpectrum`. Spectral `mixMany` with normalised weights `w`: `s[i] = fastpow2(Σ w_k · fastlog2(s_k[i]))`. Constants and fast-math copied as Global Constraints says, with attribution. Every model takes the exactness short-circuit first.
- [ ] **Step 4: Run** the build, then `agent/run-tests.sh KisPaintMixTest`. Expected: all five pass.
- [ ] **Step 5: Commit** `Colour mixing module: RGB and libmypaint's spectral mix as pure functions (plugins/paintops/libpaintmix)`.

### Task 2: MyPaint spectral, brush side and canvas side

**Files:**
- Modify: `plugins/paintops/mypaint/MyPaintSurface.h`, `MyPaintSurface.cpp` (internal struct becomes `MyPaintSurface2`; v2 `draw_dab_pigment`, `get_color_pigment`; a `paint` argument through `drawDabImpl`/`getColorImpl`; sample-merged), `MyPaintPaintOp.h`, `MyPaintPaintOp.cpp:25-50,73,82` (entry point choice; `Toska*` properties), `CMakeLists.txt` (link `kritapaintmix`), `tests/CMakeLists.txt`, `tests/kis_mypaintop_test.h`, `tests/kis_mypaintop_test.cpp`, `agent/ci-tests.txt` (`KisMyPaintOpTest`), `AGENT-FORK.md` (rows)

**Interfaces:**
- Consumes: Task 1 `mix2`, `mixMany`, `Model::Spectral`.
- Produces:
  - `static bool KisMyPaintPaintOp::usesPaintMode(MyPaintBrush *brush)` = `!(mypaint_brush_get_base_value(brush, MYPAINT_BRUSH_SETTING_PAINT_MODE) <= 0 && mypaint_brush_is_constant(brush, MYPAINT_BRUSH_SETTING_PAINT_MODE))` (libmypaint's own `legacy_smudge` test, negated).
  - `MyPaintSurface2 *KisMyPaintSurface::surface2()`
  - `static int KisMyPaintSurface::draw_dab_pigment(MyPaintSurface2*, x, y, radius, r, g, b, opaque, hardness, alpha_eraser, aspect_ratio, angle, lock_alpha, colorize, posterize, posterize_num, paint)`
  - `static void KisMyPaintSurface::get_color_pigment(MyPaintSurface2*, x, y, radius, float *r, float *g, float *b, float *a, float paint)`
  - `KisMyPaintSurface(KisPainter*, KisPaintDeviceSP, KisImageSP, bool sampleMerged = false)`

- [ ] **Step 1: Check the assumptions.** Read libmypaint `mypaint-brush.c` 1250–1300: `stroke_to_2` never calls `end_atomic_multi`. Read `KisColorSmudgeSourceImage` for how it reads the projection.
- [ ] **Step 2: Write the failing tests** in `KisMyPaintOpTest` (`testDab`, `testGetColor`, `testLoading` unchanged):
  - `testLegacyUnlessPaintMode`: `usesPaintMode` false for every bundled `.myb` (incl. `e) Marker Medium`, `paint_mode` base 0); true after `mypaint_brush_set_base_value(PAINT_MODE, 1)`.
  - `testSpectralDabBlueOnYellowIsGreen`: rgb8 device filled yellow (252,211,0); `draw_dab_pigment` blue, opaque 0.5, hardness 1, radius 20, `paint` 1: centre `g > r` and `g > b`; the same dab through `draw_dab` gives `g < r`.
  - `testUnmixedDabIsExact`: a pigment dab at opaque 1 on a transparent device gives exactly the dab colour.
  - `testSpectralDab16BitAndFloat`: the blue-on-yellow test on rgb16 and rgbaF32.
  - `testEraserIgnoresPaintMode`: `COMPOSITE_ERASE`, `paint` 1: bytes equal `draw_dab`.
  - `testGetColorPigmentAveragesSpectrally`: half blue, half yellow under the sample radius, `paint` 1 → `g > r`; `paint` −1 equals today's `get_color`.
  - `testSampleMergedReadsBelow`: yellow layer under an empty paint layer; `sampleMerged = true` on the empty layer's painter samples yellow; `false` samples transparent.
- [ ] **Step 3: Run** the build. Expected: compile errors naming `draw_dab_pigment` and `usesPaintMode`.
- [ ] **Step 4: Implement.**
  - `drawDabImpl` gains `float paint`. Per pixel, eraser off, composite as libmypaint's tiled surface (`mypaint-tiled-surface.c` 442–471): today's normal blend at `alpha * (1 - paint)`, then the spectral blend at `alpha * paint`, `t = (alpha·color_a)/a`, colour `mix2(Spectral, dst, src, t)`. libmypaint's `MAX(opacity, 150)` integer workaround is not ported.
  - `getColorImpl` with `paint > 0` returns `lerp(rgbAverage, mixMany(Spectral, pixels, weight·alpha), paint)`; `paint < 0` returns today's result.
  - The paintop reads `ToskaMyPaintPaintMode`; when present, `mypaint_brush_set_base_value(PAINT_MODE, v)`.
  - The paintop calls `mypaint_brush_stroke_to_2(…, viewzoom 1, viewrotation 0, barrel_rotation 0)` only when `usesPaintMode`, otherwise legacy `mypaint_brush_stroke_to` (lines 73, 82): `stroke_to_2` also changes dab counting.
  - `ToskaMyPaintSampleMerged` makes `getColorImpl` read `m_image->projection()`. Posterize ignored, as today.
- [ ] **Step 5: Run** the build, then `agent/run-tests.sh KisMyPaintOpTest`. Expected: all pass, including the unchanged `testDab` golden image.
- [ ] **Step 6: Commit** `MyPaint spectral paint mode: stroke_to_2 and a MyPaintSurface2 adapter for presets that set paint_mode; legacy path unchanged otherwise`.

### Task 3: Module: linear light, perceptual, pixel buffers, golden vectors

**Files:**
- Modify: `plugins/paintops/libpaintmix/KisPaintMix.h`, `KisPaintMix.cpp`, `tests/KisPaintMixTest.*`
- Create: `plugins/paintops/libpaintmix/KisPaintMixBuffers.h`, `KisPaintMixBuffers.cpp`, `tests/data/golden.json` (written by the test)

**Interfaces:**
- Produces:
  - `Model::LinearLight` (id `linear`), `Model::Perceptual` (id `perceptual`)
  - `enum class PixelFormat { Bgra8, Bgra16, RgbaF32 }`; `enum class Blend { Over, Copy }`
  - `void blendPixels(Model m, Blend blend, PixelFormat f, uint8_t *dst, const uint8_t *src, bool srcIsOneColour, int count, float opacity)`
  - Alpha rules (straight colours): Over `a = sa·op + da·(1 − sa·op)`, `t = sa·op / a`; Copy `a = da + (sa − da)·op`, `t = op·sa / (op·sa + (1 − op)·da)`; in both, `a < 1e-6` leaves colour unchanged; colour `mix2(m, dst, src, t)`.
- `golden.json`: `{ "<model id>": [ { "a": [r,g,b], "b": [r,g,b], "t": number, "out": [r,g,b] } ×64 ] }`

- [ ] **Step 1: Write the failing tests:**
  - `testLinearBlackWhiteHalf`: 0.5 of black and white → 187.5/255 ± 0.5/255.
  - `testPerceptualBlackWhiteHalf`: → 79.4/255 ± 1/255.
  - `testMixManyEqualsMix2`: every model, weights (1−t, t) agree with `mix2` within 1e-6.
  - `testBlendPixelsRgbMatchesKritaOver`: `blendPixels(Rgb, Over, Bgra8, …)` vs `KoColorSpaceRegistry::rgb8()->compositeOp(COMPOSITE_OVER)` on 1,000 random pixels, within 1 unit (test links `kritapigment`).
  - `testBlendPixelsOneColourOverTransparentIsExact`
  - `testBlendPixelsTinyAlphaIsFinite`: da = sa = 1e-7, no NaN in any format.
  - `testGoldenVectors`: with `KIS_PAINTMIX_WRITE_GOLDEN` set, write 64 fixed-seed rows per model to that absolute path; otherwise compare with `FILES_DATA_DIR/golden.json` within 1e-6.
  - `testSpeed`: spectral `blendPixels`, Over, Bgra8, 2,000,000 pixels in ≤ 500 ms (QElapsedTimer; `QSKIP` in Debug); print the time.
- [ ] **Step 2: Run** the build. Expected: fails on `Model::LinearLight` and `blendPixels`.
- [ ] **Step 3: Implement.** `linear`: decode sRGB, interpolate, encode. `perceptual`: Realistic Paint Studio's tuned Lab (`local-notes/realistic-paint-study/findings-binary.md` §2.1) in floats, no 8-bit rounding:
  ```
  lin → XYZ (D65 matrix, X/0.95047, Z/1.08883) → X,Y,Z ^= 2/3 → f(t)= t^(1/3) if t>0.008856 else 7.787t+16/116
  L=116f(Y)−16, a=500(f(X)−f(Y)), b=200(f(Y)−f(Z)); interpolate L,a,b; inverse: cube (or linear segment), clamp ≥0, ^1.5, ×white, inverse matrix, encode, clamp 0..1
  ```
- [ ] **Step 4: Write the golden file and check it.** `KIS_PAINTMIX_WRITE_GOLDEN="$PWD/plugins/paintops/libpaintmix/tests/data/golden.json" agent/run-tests.sh KisPaintMixTest testGoldenVectors`, then `agent/run-tests.sh KisPaintMixTest`. Expected: all pass, speed printed.
- [ ] **Step 5: Commit** `Colour mixing module: linear light, perceptual (tuned Lab), pixel-buffer blends and golden vectors`.

### Task 4: The companion's copy of the maths

**Files:**
- Create: `creative-agent/krita-creative-agent/src/colour-mixing/mix.ts`, `creative-agent/krita-creative-agent/tests/colour-mixing.test.ts`
- Modify: `creative-agent/krita-creative-agent/scripts/run-unit-tests.mjs:13` (also collect `.test.ts`)

**Interfaces:**
- Produces: `type MixModel = 'rgb' | 'linear' | 'perceptual' | 'spectral'` (Task 9 adds `'pigment'`); `type Rgb = [number, number, number]`; `mix2(model: MixModel, a: Rgb, b: Rgb, t: number): Rgb`; `mixMany(model: MixModel, colours: Rgb[], weights: number[]): Rgb`; `hexToRgb(hex: string): Rgb | null`; `rgbToHex(c: Rgb): string`; `MIX_MODELS: readonly MixModel[]`.

- [ ] **Step 1: Write the failing tests:** `every golden row matches within 1e-4` (reads `../../../plugins/paintops/libpaintmix/tests/data/golden.json` relative to the test file); `unmixed colours come back exactly`; `blue and yellow make green under spectral`; `hex parsing rejects bad input` (`'#12345'`, `'zzzzzz'`).
- [ ] **Step 2: Run** `npm run test:unit`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** with `Math.fround` at each step; fast-math mirrors the C++ bit tricks through shared `Float32Array`/`Int32Array` views; constants from the same libmypaint lines with the same attribution. Add `.test.ts` to the runner's filter.
- [ ] **Step 4: Run** `npm run test:unit && npm run typecheck`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `Companion colour mixing: the module's models in strict TypeScript, held to the C++ golden vectors`.

### Task 5: Plugin: mixing on a pass, and blending passes that sample below

**Files:**
- Create: `creative-agent/krita-mcp/krita-plugin/kritamcp/mixing_options.py`, `creative-agent/krita-creative-agent/tests/test_mixing_options.py`
- Modify: `creative-agent/krita-mcp/krita-plugin/kritamcp/creative_validation.py:55-60` (field `mixing_model`), `creative-agent/krita-mcp/krita-plugin/kritamcp/creative_tools.py:677` (validate) and `:2023-2026` (merge into `presetProperties`)

**Interfaces:**
- Produces: `MODELS = ('rgb', 'linear', 'perceptual', 'spectral', 'pigment')`; `mixing_properties(paintop_id: str, preset_name: str, mixing_model: str | None, new_layer: bool, smudge_overlay: bool) -> dict`:
  - `colorsmudge` with a model → `{'ToskaMixingModel': model}`.
  - `mypaintbrush` with `spectral` → `{'ToskaMyPaintPaintMode': 1.0}`, plus `'ToskaMyPaintSampleMerged': True` on a new layer.
  - `mypaintbrush` with another non-`rgb` model → `ValueError('MyPaint presets mix by rgb or spectral')`.
  - Any other engine with a model → `ValueError` naming the engine.
  - Sample-below: new layer, `colorsmudge`, and either `re.search(r'blend|smudg', preset_name, re.I)` or a non-`rgb` model → add `'MergedPaint': True`.
- Only the fork's stroke-job path uses it; the frozen stock path is unchanged.

- [ ] **Step 1: Write the failing tests:** `test_blender_on_new_layer_samples_below` (`k) Blender Basic`, new layer → `MergedPaint` True); `test_continued_layer_is_left_alone`; `test_colour_laying_smudge_preset_unchanged_without_model` (`i) Wet Bristles`, no model → `{}`); `test_mypaint_spectral_sets_paint_mode_and_samples_merged`; `test_mypaint_refuses_pigment`; `test_unknown_model_refused_by_validation` (`mixing_model must be one of rgb, linear, perceptual, spectral, pigment`).
- [ ] **Step 2: Run** the plugin test command. Expected: FAIL, `ModuleNotFoundError: mixing_options`.
- [ ] **Step 3: Implement** `mixing_properties`; validate in `creative_validation` and in `_creative_tools` validation, reading `paintopid` from the preset XML as `_creative_validate_smudge_overlay` does; merge into `options['presetProperties']` in `_creative_stroke_job`. Explicit `smudge_overlay` and `smudge_rate` still win.
- [ ] **Step 4: Run** the plugin tests (PASS), then the whole plugin suite with `-p 'test_*.py'`.
- [ ] **Step 5: Commit** `Plugin: paint passes take a mixing model; blending passes on new layers sample the paint below`.

### Task 6: Catalog gate, `mixing` on `paint_pass`, and the `mix_colors` tool

**Files:**
- Create: `creative-agent/krita-creative-agent/src/colour-mixing/pass-mixing.ts`, `src/colour-mixing/mix-tool.ts`, `tests/pass-mixing.test.ts`, `tests/mix-tool.test.ts`
- Modify: `src/brush-catalog.json` (`"mixing": {"models": {}, "presets": {}}`); `src/brush-catalog.mjs` (`measuredModels`, `presetMixing`); `src/tools.mjs:231-240` (`mixing` field on `paint_pass`; wrap its `execute` as `fill.execute` is at `:386`; push `mixColorsTool`); `src/studio.mjs:1858` (`'mix_colors'`); `src/tool-catalogue.ts` (`mix_colors` timing `{ seconds: [0, 1], source: 'local maths, no Krita call' }`)

**Interfaces:**
- Consumes: Task 4 `mix2`, `mixMany`, `hexToRgb`, `rgbToHex`, `MIX_MODELS`.
- Produces:
  - Catalog: `mixing.models[model] = card string`; `mixing.presets[preset] = { cards: Partial<Record<MixModel, string>>, default?: MixModel }`.
  - `measuredModels(catalog?): MixModel[]`; `presetMixing(name, catalog?)`.
  - `passMixing(args: { preset: string; mixing?: MixModel }, catalog): { mixing_model?: MixModel } | { error: string }` — lists the measured pairs when a pair has no card; uses the preset's `default` when `mixing` is omitted; sends nothing for `rgb`.
  - `mixColorsTool(deps: { catalog: () => Catalog }): ToolDefinition` — `mix_colors { colours: { hex: string; amount: number }[] (2–6), model?: MixModel }` → `{ model, hex }`, or one row per measured model when `model` is omitted.

- [ ] **Step 1: Write the failing tests:** `a pair without a card is refused, naming the measured pairs`; `a preset default applies when mixing is omitted`; `rgb sends nothing to the plugin`; `with an empty mixing catalog, paint_pass and mix_colors offer no model`; `mix_colors returns the module's colour` (equals `rgbToHex(mixMany(...))`); `mix_colors refuses odd input with the reason` (one colour, amounts summing to 0, `#12`, 7 colours, an unmeasured model); `paint_batch passes get the same mixing`.
- [ ] **Step 2: Run** `npm run test:unit`. Expected: FAIL.
- [ ] **Step 3: Implement.** The `mixing` schema description says it is for blending and glazing; the model list is the catalog's measured models. Model cards reach the painter through `list_brushes` beside the preset cards.
- [ ] **Step 4: Run** `npm run test:unit && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `Companion: mixing models only after a catalog card; mix_colors previews a mix with the brushes' own maths`.

### Task 7: Live: MyPaint spectral in Toska, cards and agreement

**Files:**
- Modify: `creative-agent/krita-creative-agent/src/brush-catalog.json` (`mixing` cards for `spectral` and its MyPaint presets)
- Notes: `creative-agent/local-notes/colour-mixing/probes.md` (git-ignored)

- [ ] **Step 1: Build and install:** build, the install checks, `agent/install-app.sh`, ask for one restart.
- [ ] **Step 2: Blue/yellow probe** (Done 1): `creative_test_start` width=6000 height=4500; left half blue (0,33,133), right half yellow (252,211,0); a `paint_pass` with `i) Wet Paint Plus (mypaint)` and `mixing: 'spectral'` across the join on that layer (`continue_layer_id`). Overlap pixels: `g > r` and `g > b`; the same stroke without `mixing` gives olive.
- [ ] **Step 3: Agreement** (Done 5): one stroke of B over flat A, without a model and with `spectral`; solve `t` per channel from the RGB result (`(out − A)/(B − A)`, median over channels with `|B − A| > 0.1`); compare the spectral result with `mix_colors` at that `t`. Pass when the maximum difference ≤ 4/255; record it.
- [ ] **Step 4: Probe each candidate MyPaint preset** (the Wet Paint, Marker and Knife presets in `jobs`), one stroke per preset on the same ground as the existing cards; write `mixing.presets[<name>].cards.spectral` and `mixing.models.spectral`. No `default` yet.
- [ ] **Step 5: Time it:** pass time with and without spectral on the 6000×4500 probe; above 1.5×, stop and report.
- [ ] **Step 6: Commit** `Catalog: measured spectral cards for MyPaint presets`.

### Task 8: Gate 1, blind A/B after MyPaint and the module

- [ ] **Step 1: Paint the pair:** the same simple still life twice at 6000×4500, everything fixed (prompt, seed where possible, model, presets). A: no mixing. B: `mixing: 'spectral'` on the measured MyPaint presets for blends and glazes. Test copies only.
- [ ] **Step 2: Judge blind:** Luna (decision client, not TypeSafe Jev) sees the pair in random left/right order: "Which is cleaner where colours meet?", "Which reads better?". The artist gets the same pair unlabelled. Label every score as runtime A/B, not offline analysis.
- [ ] **Step 3: Record** in `local-notes/colour-mixing/ab-1.md`. Expected: Luna and the artist both prefer B on both questions; otherwise stop, report why, and do not start Task 9.

### Task 9: Mixbox, the pigment model

**Files:**
- Create: `plugins/paintops/libpaintmix/KisPaintMixMixbox.cpp`, `KisPaintMixMixboxData.cpp`, `creative-agent/krita-creative-agent/src/colour-mixing/mixbox.ts`, `src/colour-mixing/mixbox-data.ts`
- Modify: `KisPaintMix.h`, `KisPaintMix.cpp`, `tests/KisPaintMixTest.cpp`, `tests/data/golden.json`, `src/colour-mixing/mix.ts`, `tests/colour-mixing.test.ts`

**Interfaces:**
- Produces: `Model::Pigment` (id `pigment`); `struct Latent { float c[4]; float residual[3]; }`; `Latent rgbToLatent(Rgb)`; `Rgb latentToRgb(const Latent&)`; `struct Settings { Model model = Model::Rgb; bool mixOnBrush = true; bool mixInWetPaint = false; }` (`mixInWetPaint` defined for `wet-paint`, read by nothing yet); TS: `'pigment'` joins `MixModel`.

- [ ] **Step 1: Confirm the published Mixbox licence allows bundling in Toska before Task 9 lands; if not, stop and report.**
- [ ] **Step 2: Write the failing tests:** `testPigmentBlueYellowIsGreen` (`g > r`, `g > b`); `testPigmentComplementariesMakeBrown` (orange (255,105,0) and ultramarine (25,0,89) at 0.5 → hue in [0°, 60°], `r > g > b`, HSV value ≤ 0.7; if the published demo uses a different canonical pair, change the pair, not the criterion); `testPigmentLatentRoundTrip` (`latentToRgb(rgbToLatent(c))` within 1e-5 for 4,096 random colours); `testUnmixedColoursRoundTripExactly` now covers `Pigment`; TS `pigment golden rows match within 1e-4`.
- [ ] **Step 3: Run** the build. Expected: fails on `Model::Pigment`.
- [ ] **Step 4: Implement** from the published code; the data file header records commit, source URL and licence; copy the LUT in the form the source ships it, with its decoder.
  ```
  rgbToLatent(rgb): (c0,c1,c2) = trilinear lookup of the published LUT at rgb (grid and scaling as published); c3 = 1−c0−c1−c2
                    m = poly(c); latent = (c0,c1,c2,c3, rgb−m)
  latentToRgb(L):   clamp(poly(L.c) + L.residual, 0, 1)
  poly(c):          Σ over the 20 cubic monomials of c0..c3 (4 cubes, 12 square×linear, 4 triple products) of
                    monomial × the published 20×3 coefficient row, in the published order
  mix2 / mixMany:   (weighted) sum of latents, then latentToRgb
  ```
- [ ] **Step 5: Regenerate and run:** regenerate `golden.json` (Task 3 Step 4 command); `agent/run-tests.sh KisPaintMixTest`; `npm run test:unit && npm run typecheck`. Expected: PASS; `testSpeed` for `Pigment` ≤ 500 ms.
- [ ] **Step 6: Commit** `Colour mixing module: Mixbox pigment model (published code, pinned), with mix-on-brush and mix-in-wet-paint switches`.

### Task 10: Mixing models in Color Smudge

**Files:**
- Create: `plugins/paintops/colorsmudge/KisColorSmudgeMixingOptionData.{h,cpp}`, `KisColorSmudgeMixingOptionModel.{h,cpp}`, `KisColorSmudgeMixingOptionWidget.{h,cpp}` (pattern of `KisSmudgeOverlayModeOption*`)
- Modify: `KisColorSmudgeStrategyBase.h`, `KisColorSmudgeStrategyBase.cpp:24-110,184-302` (`setMixing`; hooks; fused path skipped when the model is not `rgb`); `kis_colorsmudgeop.h`, `kis_colorsmudgeop.cpp:67-114` (read the option; `m_strategy->setMixing` before `initializePainting`); `kis_colorsmudgeop_settings_widget.cpp:~88` (`addPaintOpOption`); `CMakeLists.txt` (sources; link `kritapaintmix`); `tests/KisColorsmudgeOpTest.cpp`; `agent/ci-tests.txt` (`KisColorsmudgeOpTest`); `AGENT-FORK.md` (rows)

**Interfaces:**
- Consumes: Task 3 `blendPixels`; Task 9 `Settings`.
- Produces:
  - `struct KisColorSmudgeMixingOptionData { QString model = "rgb"; bool mixOnBrush = true; bool mixInWetPaint = false; bool read(const KisPropertiesConfiguration*); void write(KisPropertiesConfiguration*) const; }` (keys from Global Constraints; an unknown model reads as `rgb`)
  - `void KisColorSmudgeStrategyBase::setMixing(const KisPaintMix::Settings&)`
  - `static std::optional<KisPaintMix::PixelFormat> pixelFormatFor(const KoColorSpace*)`: RGBA U8 → Bgra8, U16 → Bgra16, F32 → RgbaF32, else nullopt.
- Hook rule: replace `m_smearOp->composite`, the dulling composite and `blendInColorRate`'s `colorRateOp->composite` (mask and stamp) with `blendPixels` only when the model is not `rgb`, `mixOnBrush` is on, the op id is `COMPOSITE_OVER` or `COMPOSITE_COPY`, and `pixelFormatFor` has a value; otherwise today's call runs.

- [ ] **Step 1: Write the failing tests** in `KisColorsmudgeOpTest` (the existing data-driven `test` unchanged: RGB matches today's images, Done 2): `testMixingOptionRoundTrip` (`spectral`, `false`, `true` survive write/read); `testUnknownModelReadsAsRgb` (`"oil"` → `rgb`, no dialog); `testSpectralSmudgeBlueIntoYellowIsGreen` (the `test(...)` helper's image, yellow fill, blue paint colour, `ToskaMixingModel=spectral`, colour rate 0.5: centre `g > r` and `g > b`; with `rgb` not); `testPigmentComplementariesBrownOnCanvas`; `testMixOnBrushOffIsRgb` (`pigment` with `ToskaMixOnBrush=false` equals `rgb` bytes); `testMixInWetPaintStoredOnly` (on or off: equal bytes); `testNonRgbColourSpaceFallsBack` (Lab16: `spectral` equals `rgb`); `testNonNormalCompositeKeepsKritaOp` (multiply: `spectral` equals `rgb`); `testOverlayModeUsesModel` (`MergedPaint` + `spectral` on an empty layer over yellow → green-shifted paint).
- [ ] **Step 2: Run** the build. Expected: compile errors naming `KisColorSmudgeMixingOptionData` and `setMixing`.
- [ ] **Step 3: Implement.** Widget: a combo with "RGB (Krita)", "Linear light", "Perceptual", "Spectral (MyPaint)", "Pigment (Mixbox)", and checkboxes "Mix on the brush", "Mix in wet paint (not used yet)".
- [ ] **Step 4: Run** the build, then `agent/run-tests.sh KisColorsmudgeOpTest KisPaintMixTest KisMyPaintOpTest`. Expected: all pass.
- [ ] **Step 5: Commit** `Color Smudge: a mixing model per preset (rgb by default), applied to smear, dulling and colour rate`.

### Task 11: Live: Color Smudge cards, Mixbox on canvas, gate 2

**Files:**
- Modify: `creative-agent/krita-creative-agent/src/brush-catalog.json` (cards; per-preset `default` only after the gate)
- Notes: `creative-agent/local-notes/colour-mixing/probes.md`, `ab-2.md`

- [ ] **Step 1: Build and install** with the Task 7 Step 1 checks and one restart.
- [ ] **Step 2: Probe each model live** (`linear`, `perceptual`, `spectral`, `pigment`): the Task 7 probe on the blender presets in `jobs` (`k) Blender Basic`, `k) Blender Smear`), on `i) Wet Bristles`, and one knife preset, on new layers. This also confirms `MergedPaint` makes empty-layer passes pick up the paint below (Done 6).
- [ ] **Step 3: Check:** `mix_colors` matches every probe within 4/255 (Done 5); orange over ultramarine gives brown, and `ToskaMixOnBrush=false` gives the RGB result (Done 4); pass time ≤ 1.5× RGB at 6000×4500.
- [ ] **Step 4: Write the cards** for every measured (preset, model) pair and every model card; commit `Catalog: measured mixing cards for Color Smudge presets`.
- [ ] **Step 5: Gate 2** as in Task 8: A is RGB; B uses `pigment` on the blending presets (and `spectral` if Task 8's winner differs). Expected: Luna and the artist both prefer B; otherwise stop and report.
- [ ] **Step 6: Set defaults** only for presets that won: `mixing.presets[<name>].default` = the winning model (Done 3, 7). `npm run test:unit`; commit `Blending presets default to the measured mixing model that won the blind A/B`.
