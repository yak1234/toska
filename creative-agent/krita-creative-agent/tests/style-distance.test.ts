// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The learned layer of the brushwork measure (painting-skills goal 5): texture statistics of 512 px luminance tiles and
// the distance between two crops' statistics. The arithmetic is tested with a stand-in session; the calibration runs on
// real close-ups when the model has been built (scripts/build-style-model.py), and is skipped otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LEVELS, TILE, luminanceTiles, styleDistance, styleStatistics, type Rgba, type StyleSession } from '../src/style-distance.ts';
import { decodeRgba } from '../src/png-rgba.ts';

const flat = (width: number, height: number, value: number): Rgba => ({ width, height, data: new Uint8Array(width * height * 4).fill(value) });
/** A stand-in model: each level's "Gram" is one number, the tile's mean lightness times the level. */
const standIn = (seen: Float32Array[] = []): StyleSession => ({ grams: async tile => { seen.push(tile);
  const mean = tile.reduce((a, b) => a + b, 0) / tile.length; return Array.from({ length: LEVELS }, (_, i) => Float32Array.of(mean * (i + 1))); } });

test('a crop is cut into whole 512 px tiles of lightness from 0 to 1, centred, and a crop smaller than a tile is refused', () => {
  const tiles = luminanceTiles(flat(1100, 600, 255));
  assert.equal(tiles.length, 2);
  assert.equal(tiles[0]!.length, TILE * TILE);
  assert.ok(Math.abs(tiles[0]![0]! - 1) < 1e-6);
  assert.equal(luminanceTiles(flat(512, 512, 0)).length, 1);
  assert.throws(() => luminanceTiles(flat(511, 800, 0)), /512/);
});

test('a crop’s statistics are the mean over its tiles, level by level', async () => {
  const seen: Float32Array[] = [];
  const image = flat(1024, 512, 0);
  for (let y = 0; y < 512; y++) for (let x = 512; x < 1024; x++) image.data.fill(255, (y * 1024 + x) * 4, (y * 1024 + x) * 4 + 4);
  const statistics = await styleStatistics(image, standIn(seen));
  assert.equal(seen.length, 2);
  assert.deepEqual(statistics.map(level => Math.round(level[0]! * 1000) / 1000), [0.5, 1, 1.5, 2]);
});

test('the distance is 0 for the same statistics, symmetric, and at most 1', () => {
  const a = [Float32Array.of(1, 2), Float32Array.of(3)], b = [Float32Array.of(2, 1), Float32Array.of(0)];
  assert.equal(styleDistance(a, a), 0);
  assert.equal(styleDistance(a, b), styleDistance(b, a));
  assert.ok(styleDistance(a, b) > 0 && styleDistance(a, b) <= 1);
  assert.equal(styleDistance([Float32Array.of(1)], [Float32Array.of(-1)]), 1);
  assert.throws(() => styleDistance(a, [Float32Array.of(1, 2)]), /levels/);
});

const MODEL = join(homedir(), 'Library/Application Support/KritaAgent/creative-agent/data/models/vgg19-style/timm-vgg19-tv-in1k-levels4');
test('calibration on a real pastel: another spot of the real picture is closer than the sharpened or the dabbed copy, by at least 2 times',
  { skip: existsSync(join(MODEL, 'vgg19_style.onnx')) ? false : 'the style model is not built (scripts/build-style-model.py)' }, async () => {
    const { onnxStyleSession } = await import('../src/style-distance-onnx.ts');
    const session = await onnxStyleSession(MODEL);
    const load = async (name: string) => {
      const d = decodeRgba(await readFile(new URL(`./fixtures/brushwork/${name}.png`, import.meta.url)))!;
      return styleStatistics({ width: d.width, height: d.height, data: new Uint8Array(d.data) }, session);
    };
    const [real, other, sharpened, dabbed] = await Promise.all(['pastel-real', 'pastel-real-other-spot', 'pastel-sharpened', 'pastel-dabbed'].map(load));
    const floor = styleDistance(real!, other!);
    assert.ok(floor < 0.3, `two spots of the real pastel: ${floor}`);
    assert.ok(styleDistance(real!, sharpened!) > 2 * floor, `sharpened ${styleDistance(real!, sharpened!)} against ${floor}`);
    assert.ok(styleDistance(real!, dabbed!) > 2 * floor, `dabbed ${styleDistance(real!, dabbed!)} against ${floor}`);
    assert.ok(styleDistance(other!, sharpened!) > 2 * floor, 'the sharpened copy of another spot is as far: no lining up is needed');
  });
