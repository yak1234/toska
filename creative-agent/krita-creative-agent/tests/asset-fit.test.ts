// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Repaint from asset: how well an asset's part fits the area on the canvas, and the asset fitted into that area's box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillHoles, fitAsset, measureFit, MAX_SCALE, MAX_UNEVEN, MIN_OVERLAP, type Shape } from '../src/asset-fit.ts';

/** A shape over [x, y, w, h], inside where `inside(i, j)` says so (all of it by default). */
const shape = (x: number, y: number, w: number, h: number, inside: (i: number, j: number) => boolean = () => true): Shape => {
  const data = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = inside(i, j) ? 255 : 0;
  return { bounds: [x, y, w, h], data };
};
const disc = (x: number, y: number, d: number) => shape(x, y, d, d, (i, j) => (i + 0.5 - d / 2) ** 2 + (j + 0.5 - d / 2) ** 2 <= (d / 2) ** 2);

test('the same shape at another place and size fits: the canvas outline is covered and nothing is stretched unevenly', () => {
  const fit = measureFit(disc(10, 20, 200), disc(900, 300, 300));
  assert.ok(fit.overlap > 0.97, String(fit.overlap));
  assert.ok(fit.covered > 0.97);
  assert.equal(fit.uneven, 1);
  assert.equal(fit.scale, 1.5);
  assert.equal(fit.fits, true);
  assert.equal(fit.why, null);
});

test('a part stretched much more one way than the other does not fit, and the reason says so', () => {
  const fit = measureFit(shape(0, 0, 100, 400), shape(0, 0, 300, 300));
  assert.equal(fit.uneven, 4);
  assert.ok(fit.uneven > MAX_UNEVEN);
  assert.equal(fit.fits, false);
  assert.match(fit.why!, /stretched/);
});

test('a part whose outline is another shape does not fit: the overlap is what is measured', () => {
  // The asset's part is a corner triangle of its box (a quarter of it and a little more); the canvas area fills its box.
  const fit = measureFit(shape(0, 0, 200, 200, (i, j) => i + j < 150), shape(0, 0, 200, 200));
  assert.ok(Math.abs(fit.overlap - 0.28) < 0.02, String(fit.overlap));
  assert.ok(fit.overlap < MIN_OVERLAP);
  assert.equal(fit.fits, false);
  assert.match(fit.why!, /shape/);
});

test('an asset much smaller than the area does not fit: it would be painted blurred', () => {
  const fit = measureFit(shape(0, 0, 100, 100), shape(0, 0, 500, 500));
  assert.equal(fit.scale, 5);
  assert.ok(fit.scale > MAX_SCALE);
  assert.equal(fit.fits, false);
  assert.match(fit.why!, /small/);
});

test('an asset that is its part all over (a sky filling its frame) is measured by its stretch alone', () => {
  const sky = shape(0, 0, 400, 200, (i, j) => j < 120 || i < 80);            // the canvas sky wraps around a building
  const fit = measureFit(null, sky, { width: 800, height: 400 });
  assert.equal(fit.overlap, 1);
  assert.equal(fit.uneven, 1);
  assert.equal(fit.fits, true);
  assert.equal(measureFit(null, shape(0, 0, 400, 100), { width: 800, height: 800 }).fits, false);
});

test('the fitted picture has the area’s proportions, the asset’s colours where its part is, and is see-through elsewhere', () => {
  // Asset 40 x 20: the part is the box [10, 0, 20, 20], red on its left half and blue on its right; outside it, green.
  const asset = { width: 40, height: 20, data: new Uint8Array(40 * 20 * 4) };
  for (let j = 0; j < 20; j++) for (let i = 0; i < 40; i++) {
    const colour = i < 10 || i >= 30 ? [0, 255, 0] : i < 20 ? [255, 0, 0] : [0, 0, 255];
    asset.data.set([...colour, 255], (j * 40 + i) * 4);
  }
  const part = shape(10, 0, 20, 20, (i, j) => j < 10);                         // only the top half of the box is the part
  const fitted = fitAsset(asset, part, shape(500, 500, 60, 30));              // an area twice as wide as it is high
  assert.equal(fitted.width / fitted.height, 2);
  const at = (x: number, y: number) => [...fitted.data.subarray((y * fitted.width + x) * 4, (y * fitted.width + x) * 4 + 4)];
  const w = fitted.width, h = fitted.height;
  assert.deepEqual(at(Math.floor(w * 0.25), Math.floor(h * 0.25)), [255, 0, 0, 255]);
  assert.deepEqual(at(Math.floor(w * 0.75), Math.floor(h * 0.25)), [0, 0, 255, 255]);
  assert.equal(at(Math.floor(w * 0.25), Math.floor(h * 0.75))[3], 0);
  assert.ok(!fitted.data.some((v, k) => k % 4 === 1 && v > 200 && fitted.data[k + 2]! === 255), 'the asset’s backdrop is never opaque');
});

test('the fitted picture is never larger than the asset’s own detail on its less stretched side', () => {
  const asset = { width: 100, height: 100, data: new Uint8Array(100 * 100 * 4).fill(255) };
  const fitted = fitAsset(asset, null, shape(0, 0, 400, 300));                // 4x across, 3x down
  assert.deepEqual([fitted.width, fitted.height], [133, 100]);
  const small = fitAsset(asset, null, shape(0, 0, 50, 50));                   // a smaller area: its own size
  assert.deepEqual([small.width, small.height], [50, 50]);
});

test('holes enclosed in a part are filled; a bay open to the edge is not', () => {
  // A 10 x 10 block with a closed hole at (4-5, 4-5) and a notch cut in from the right edge at row 1.
  const holed = shape(0, 0, 10, 10, (i, j) => !(i >= 4 && i <= 5 && j >= 4 && j <= 5) && !(j === 1 && i >= 7));
  const filled = fillHoles(holed);
  assert.equal(filled.data[4 * 10 + 4], 255);
  assert.equal(filled.data[5 * 10 + 5], 255);
  assert.equal(filled.data[1 * 10 + 8], 0, 'the notch reaches the edge: it stays outside');
  assert.equal(holed.data[4 * 10 + 4], 0, 'the given shape is not changed');
});
