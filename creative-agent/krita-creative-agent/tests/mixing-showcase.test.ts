// The mixing showcase's stroke layout and colour metrics (scripts/mixing-showcase.ts). No Toska; the only file written is
// the sheet encoded to a private temporary folder, and removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outputFolder, buildLayout, VARIANTS, CANVAS, COLOURS, composeSheet, encodePng, hsvl, intersect, lineStroke, rng, strokesBounds, zoneStats, panelMetrics, MODELS, PRESETS, reading } from '../scripts/mixing-showcase.ts';
import type { Image, Rect, Results } from '../scripts/mixing-showcase.ts';
import { decodeRgba } from '../src/png-rgba.ts';

const solid = (width: number, height: number, fill: (x: number, y: number) => [number, number, number]): Image & { data: Uint8Array } => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [r, g, b] = fill(x, y), i = (y * width + x) * 4; data.set([r, g, b, 255], i); }
  return { width, height, data };
};

test('the layout is deterministic and every stroke stays on the canvas, inside its own column', () => {
  const a = buildLayout(), b = buildLayout();
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  for (const panel of a) {
    const [cx, , cw, ch] = panel.column;
    for (const pass of panel.passes) {
      assert.ok(pass.strokes.length >= 1 && pass.strokes.length <= 256, pass.name);
      const [x, y, w, h] = strokesBounds(pass.strokes);
      assert.ok(x >= cx && x + w <= cx + cw && y >= 0 && y + h <= ch, `${panel.id} ${pass.name} ${[x, y, w, h]}`);
      for (const s of pass.strokes) { assert.match(s.color, /^#[0-9a-f]{6}$/); assert.ok(s.segments.every(g => g.length === 6)); }
    }
  }
});

test('blue goes across half of the yellow, red over half of the green, and the middle of the sunset takes both colours', () => {
  const [blueYellow, sunset, redGreen] = buildLayout();
  const [yellow, blue] = blueYellow!.passes;
  assert.ok(yellow!.strokes.every(s => s.color === COLOURS.yellow) && blue!.strokes.every(s => s.color === COLOURS.ultramarine));
  const overlap = blueYellow!.zones.overlap!, band = strokesBounds(yellow!.strokes);
  assert.deepEqual(intersect(overlap, band), overlap);                       // the zone lies inside the yellow
  assert.ok(overlap[2] < band[2] * 0.6 && overlap[0] > band[0] + band[2] * 0.4); // on its right half only
  const [ends, blend] = sunset!.passes;
  assert.deepEqual([...new Set(blend!.strokes.map(s => s.color))].sort(), [COLOURS.deepBlue, COLOURS.orange].sort());
  assert.ok(blend!.strokes.every((s, i) => i === 0 || s.color !== blend!.strokes[i - 1]!.color));
  const topBlue = ends!.strokes.filter(s => s.color === COLOURS.deepBlue), lowOrange = ends!.strokes.filter(s => s.color === COLOURS.orange);
  assert.ok(Math.max(...topBlue.map(s => s.start[1])) < sunset!.zones.middle![1]);
  assert.ok(Math.min(...lowOrange.map(s => s.start[1])) > sunset!.zones.middle![1] + sunset!.zones.middle![3]);
  const [, red] = redGreen!.passes, patch = strokesBounds(redGreen!.passes[0]!.strokes), redBox = strokesBounds(red!.strokes);
  assert.ok(redBox[0] > patch[0] + patch[2] * 0.3 && redBox[0] + redBox[2] <= patch[0] + patch[2] + 1);
});

test('lineStroke goes from start to end and the generator repeats', () => {
  const s = lineStroke([10, 20], [310, 20], 50, '#112233', rng(7));
  assert.deepEqual(s.start, [10, 20]);
  assert.deepEqual(s.segments.at(-1)!.slice(4), [310, 20]);
  assert.deepEqual(lineStroke([10, 20], [310, 20], 50, '#112233', rng(7)), s);
  assert.notDeepEqual(lineStroke([10, 20], [310, 20], 50, '#112233', rng(8)), s);
});

test('hsv and lightness of known colours', () => {
  assert.deepEqual(hsvl(255, 0, 0), { h: 0, s: 1, l: 0.5 });
  assert.equal(hsvl(0, 255, 0).h, 120);
  assert.equal(hsvl(0, 0, 255).h, 240);
  const grey = hsvl(128, 128, 128);
  assert.equal(grey.s, 0); assert.ok(Math.abs(grey.l - 128 / 255) < 1e-9);
});

test('zone statistics: green share, circular hue across 0, grey ignored for hue', () => {
  const half = solid(10, 10, x => x < 5 ? [30, 200, 60] : [200, 200, 200]);
  const z = zoneStats(half, [0, 0, 10, 10]);
  assert.equal(z.pixels, 100);
  assert.ok(Math.abs(z.greenShare - 0.5) < 1e-9);
  assert.ok(Math.abs(z.meanHue - hsvl(30, 200, 60).h) < 1e-6);
  assert.ok(z.greenMeanSaturation! > 0.8);
  const reds = solid(4, 4, (x, y) => (x + y) % 2 ? [255, 20, 0] : [255, 0, 20]);       // hues just above and below 0
  const r = zoneStats(reds, [0, 0, 4, 4]);
  assert.ok(r.meanHue < 5 || r.meanHue > 355, String(r.meanHue));
  assert.equal(r.greenShare, 0); assert.equal(r.greenMeanSaturation, null);
  assert.equal(zoneStats(solid(3, 3, () => [120, 120, 120]), [0, 0, 3, 3]).meanHue, 0);
  assert.equal(zoneStats(half, [20, 20, 5, 5]).pixels, 0);                                // outside the image
});

test('panel metrics: sunset drop is the ends against the middle; blue into yellow reports green', () => {
  const panels = buildLayout(), sunset = panels[1]!;
  const img = solid(CANVAS.width, CANVAS.height, (_x, y) => y > 800 && y < 1200 ? [128, 120, 120] : y < 600 ? [10, 30, 200] : [240, 120, 10]);
  const m = panelMetrics(img, sunset);
  assert.ok(m.saturationDrop > 0.5, String(m.saturationDrop));
  assert.ok(m.middle.meanSaturation < 0.1);
  const flat = panelMetrics(solid(CANVAS.width, CANVAS.height, () => [30, 200, 60]), panels[0]!);
  assert.equal(flat.greenShare, 1);
  assert.ok(flat.overlap.meanSaturation > 0.8);
  const redGreen = panelMetrics(solid(CANVAS.width, CANVAS.height, () => [140, 90, 50]), panels[2]!);
  assert.ok(redGreen.overlap.meanLightness > 0.3 && redGreen.overlap.meanLightness < 0.5);
});

test('the sheet is encoded as a PNG that decodes back, labelled, rgb row above spectral', async () => {
  const panels = buildLayout();
  const small = solid(CANVAS.width, CANVAS.height, () => [250, 250, 250]);
  const dark = solid(CANVAS.width, CANVAS.height, () => [0, 0, 0]);
  const sheet = composeSheet({ rgb: small, spectral: dark }, panels, 'WET PAINT PLUS', 0.1);
  const [rows] = [MODELS.length];
  assert.equal(rows, 2);
  const dir = await mkdtemp(join(tmpdir(), 'showcase-test-'));
  try {
    const path = join(dir, 'sheet.png');
    await writeFile(path, encodePng(sheet));
    const back = decodeRgba(await readFile(path), 1e8, { ignoreColour: true })!;
    assert.equal(back.width, sheet.width); assert.equal(back.height, sheet.height);
    assert.deepEqual([...back.data.subarray(0, 4 * 50)], [...sheet.data.subarray(0, 4 * 50)]);
    // The lower (spectral) row's panels are the dark image, the upper (rgb) row's the light one.
    const at = (x: number, y: number) => back.data[(y * back.width + x) * 4]!;
    const ph = Math.floor(CANVAS.height * 0.1);
    assert.ok(at(14 + 5, 30 + 34 + ph / 2 + 14) > 200);
    assert.ok(at(14 + 5, 30 + 34 + ph + 14 + 34 + 14 + ph / 2) < 50);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the reading names both presets and says which model keeps more green', () => {
  const zone = (sat: number, light = 0.5) => ({ pixels: 1, meanHue: 100, meanSaturation: sat, meanLightness: light, greenShare: 0, greenMeanSaturation: null });
  const entry = (green: number, drop: number) => ({ 'blue-into-yellow': { overlap: zone(0.5), greenShare: green, greenMeanSaturation: 0.5 },
    'sunset-sky': { top: zone(0.9), middle: zone(0.9 - drop), bottom: zone(0.9), endsSaturation: 0.9, saturationDrop: drop, saturationDropShare: drop / 0.9 },
    'red-over-green': { overlap: zone(0.4) } });
  const results: Results = {};
  for (const p of PRESETS) results[p.slug] = { rgb: entry(0.02, 0.6), spectral: entry(0.5, 0.2) } as Results[string];
  const lines = reading(results);
  assert.equal(lines.length, 6);
  assert.match(lines[0]!, /Wet Paint Plus/); assert.match(lines[0]!, /Spectral makes noticeably more green/);
  assert.match(lines[1]!, /keeps the middle more colourful/);
  const r: Rect = [0, 0, 1, 1]; assert.deepEqual(intersect(r, [5, 5, 1, 1]), null);
});

test('variants: glaze lowers every stroke, layered repeats only the second colour at low opacity', () => {
  const base = buildLayout(), glaze = buildLayout(CANVAS, VARIANTS.glaze), layered = buildLayout(CANVAS, VARIANTS.layered);
  for (const panel of glaze) for (const pass of panel.passes) assert.ok(pass.strokes.every(s => s.opacity === 0.35 && s.flow === 0.35));
  layered.forEach((panel, i) => {
    assert.equal(panel.passes[0]!.strokes.length, base[i]!.passes[0]!.strokes.length);
    assert.ok(panel.passes[0]!.strokes.every(s => s.opacity === 1 && s.flow === 1));
    assert.equal(panel.passes[1]!.strokes.length, base[i]!.passes[1]!.strokes.length * 3);
    assert.ok(panel.passes[1]!.strokes.every(s => s.opacity === 0.3 && s.flow === 1));
  });
  assert.deepEqual(buildLayout(CANVAS, {}), base);
});

test('the output folder defaults to a fresh folder under the OS temp dir, never the private notes; --out is the caller\'s', () => {
  const folder = outputFolder({}, '202611020300');
  assert.ok(folder.startsWith(tmpdir()), folder);
  assert.ok(!folder.includes('local-notes'), folder);
  assert.match(folder, /202611020300/);
  assert.equal(outputFolder({ out: '/private/tmp/mine' }, 'x'), '/private/tmp/mine');
});
