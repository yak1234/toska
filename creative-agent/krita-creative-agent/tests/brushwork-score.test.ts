// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Brushwork score (src/brushwork-score.ts) on synthetic marks. Pure functions; nothing is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { brushworkScore, measureBrushwork, cropRgba, WEIGHTS, type Rgba } from '../src/brushwork-score.ts';

const SIDE = 256;
function picture(value: (x: number, y: number) => number): Rgba {
  const data = new Uint8Array(SIDE * SIDE * 4);
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) { const v = Math.max(0, Math.min(255, value(x, y))); data.set([v, v * 0.9, v * 0.7, 255], (y * SIDE + x) * 4); }
  return { width: SIDE, height: SIDE, data };
}
// Hatching at `degrees`, marks `period` px apart, on a slow gradient (the form underneath).
const hatch = (degrees: number, period = 8, depth = 60) => picture((x, y) => { const a = degrees * Math.PI / 180; return 110 + x * 0.2 + depth * Math.sin((-x * Math.sin(a) + y * Math.cos(a)) * 2 * Math.PI / period); });
const form = picture(x => 110 + x * 0.2);                                   // the same place with its marks blended away
let seed = 5; const noise = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const stipple = picture(() => 110 + (noise() - 0.5) * 140);

test('a crop against itself is 100, and the weights sum to 1', () => {
  assert.equal(brushworkScore(hatch(30), hatch(30)).score, 100);
  assert.ok(Math.abs(Object.values(WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('what it measures: direction and agreement of hatching, none in stipple or flat paint', () => {
  const m = measureBrushwork(hatch(30));
  const peak = m.direction.indexOf(Math.max(...m.direction));
  assert.equal(peak, 2, 'marks at 30 degrees fall in the 30-degree bin');
  assert.ok(m.coherence > 0.8, `hatching agrees (${m.coherence.toFixed(2)})`);
  assert.ok(measureBrushwork(stipple).coherence < 0.3, 'stipple has no direction');
  assert.ok(measureBrushwork(form).edge_density < 0.01 && m.edge_density > 0.3);
  assert.ok(Math.abs(m.direction.reduce((a, b) => a + b, 0) - 1) < 1e-6 && Math.abs(m.scales.reduce((a, b) => a + b, 0) - 1) < 1e-6);
});

test('marks blended away, turned, coarser or replaced by stipple all score below the same marks', () => {
  const original = hatch(30), same = brushworkScore(original, hatch(30, 8, 55)).score;
  const blended = brushworkScore(original, form), turned = brushworkScore(original, hatch(120)), coarse = brushworkScore(original, hatch(30, 32)), dotted = brushworkScore(original, stipple);
  assert.ok(same > 95, `slightly lighter marks stay close (${same})`);
  for (const [name, s] of Object.entries({ blended, turned, coarse, dotted })) assert.ok(s.score < same - 15, `${name} ${s.score} against ${same}`);
  assert.ok(blended.parts.edges < 0.2 && blended.parts.contrast < 0.5, 'blending loses the edges and the contrast');
  assert.ok(turned.parts.direction < 0.5 && turned.parts.scales > 0.9, 'turning changes direction only');
  assert.ok(coarse.parts.scales < 0.6, 'coarser marks move the contrast to broader scales');
  assert.ok(dotted.parts.coherence < 0.3);
});

test('crops are clamped to the image, and a tiny crop is refused', () => {
  const crop = cropRgba(hatch(30), [200, 200, 100, 100]);
  assert.deepEqual([crop.width, crop.height], [56, 56]);
  assert.throws(() => measureBrushwork(cropRgba(hatch(30), [0, 0, 4, 4])), /at least 8 x 8/);
});

// Real close-ups (tests/fixtures/brushwork: a Degas pastel, the Met's open-access image), measured at their own size.
// At the old 384-cell grid a 1024 px crop lost the fine marks before anything was compared, and every copy scored 80 to 93.
import { readFile } from 'node:fs/promises';
import { decodeRgba } from '../src/png-rgba.ts';
import { MEASURE_SIDE, brushworkFindings } from '../src/brushwork-score.ts';

const fixture = async (name: string) => {
  const d = decodeRgba(await readFile(new URL(`./fixtures/brushwork/${name}.png`, import.meta.url)))!;
  return { width: d.width, height: d.height, data: new Uint8Array(d.data) };
};

test('a crop is measured at its own size, up to 1024 cells', () => {
  assert.equal(MEASURE_SIDE, 1024);
});

test('on a real pastel the sharpened and the dabbed copy of the same place score well below the picture itself', async () => {
  const [real, sharpened, dabbed] = await Promise.all(['pastel-real', 'pastel-sharpened', 'pastel-dabbed'].map(fixture));
  assert.equal(brushworkScore(real!, real!).score, 100);
  assert.ok(brushworkScore(real!, sharpened!).score < 65, String(brushworkScore(real!, sharpened!).score));
  assert.ok(brushworkScore(real!, dabbed!).score < 80, String(brushworkScore(real!, dabbed!).score));
});

test('the findings say in plain words what differs, largest first, and nothing for the same marks', async () => {
  const [real, sharpened, dabbed] = await Promise.all(['pastel-real', 'pastel-sharpened', 'pastel-dabbed'].map(fixture));
  assert.deepEqual(brushworkFindings(brushworkScore(real!, real!)), []);
  const smooth = brushworkFindings(brushworkScore(real!, sharpened!));
  assert.match(smooth.join(' | '), /edges/);
  assert.match(smooth.join(' | '), /agree on a direction more/);
  assert.match(smooth.join(' | '), /fine grain/);
  const dabs = brushworkFindings(brushworkScore(real!, dabbed!));
  assert.match(dabs.join(' | '), /edges/);
  assert.ok(!/agree on a direction/.test(dabs.join(' | ')), 'the dabs are as scattered as the pastel');
  assert.ok(smooth.length <= 5 && smooth.every(line => line.length < 200));
});
