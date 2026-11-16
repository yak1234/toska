// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Repaint from asset: how well an asset's part fits the area on the canvas, and the asset fitted into that area's box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillHoles, fitAsset, matchPieces, measureFit, pieces, MAX_SCALE, MAX_UNEVEN, MIN_OVERLAP, type Shape } from '../src/asset-fit.ts';

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

// One name, several things (live, New Moscow 2026-11-16): the canvas "tower" was the tower, a slice of facade and a strip.
const towerLike = (x: number, y: number, w: number, h: number) => shape(x, y, w, h, (i, j) => Math.abs(i + 0.5 - w / 2) <= (j + 1) / h * w / 2);
const canvasTower = (): Shape => {
  // Over [0, 0, 600, 500]: a facade block at the left, a tower (a triangle) at 300-500, a low strip at the bottom right.
  const data = new Uint8Array(600 * 500), tower = towerLike(0, 0, 200, 400);
  for (let j = 0; j < 500; j++) for (let i = 0; i < 600; i++) {
    const facade = i < 120 && j >= 100 && j < 300, strip = i >= 380 && i < 600 && j >= 460;
    const inTower = i >= 300 && i < 500 && j < 400 && tower.data[j * 200 + (i - 300)]! > 0;
    if (facade || strip || inTower) data[j * 600 + i] = 255;
  }
  return { bounds: [1000, 100, 600, 500], data };
};

test('a shape of several separate things comes apart into its pieces, largest first, specks dropped', () => {
  const area = canvasTower(); area.data[5 * 600 + 590] = 255;                // one stray pixel
  const found = pieces(area);
  assert.equal(found.length, 3);
  assert.deepEqual(found.map(p => p.bounds), [[1300, 101, 200, 399], [1000, 200, 120, 200], [1380, 560, 220, 40]]);
  assert.ok(found[0]!.data.some(v => v === 0), 'a piece keeps its own outline inside its box');
});

test('an asset’s piece is matched to the canvas piece of the same shape, and the other canvas pieces are left', () => {
  const asset = [towerLike(50, 20, 300, 600)];                                // the tower alone, larger
  const { pairs, areaLeft, partLeft } = matchPieces(asset, pieces(canvasTower()));
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0]!.area.bounds, [1300, 101, 200, 399]);   // the tip's first row is narrower than a pixel
  assert.ok(pairs[0]!.fit.overlap > 0.9);
  assert.equal(areaLeft.length, 2);
  assert.equal(partLeft.length, 0);
  assert.equal(measureFit(asset[0]!, canvasTower()).fits, false, 'as one shape it does not fit');
});

test('two things joined only by a thin neck are two pieces; a thin shape alone stays one', () => {
  // Two 200 x 300 blocks, 100 apart, joined by a bar 6 px high.
  const joined = shape(0, 0, 500, 300, (i, j) => i < 200 || i >= 300 || (j >= 150 && j < 156));
  const found = pieces(joined);
  assert.equal(found.length, 2);
  assert.ok(found.every(p => p.bounds[2] >= 200 && p.bounds[2] <= 300), JSON.stringify(found.map(p => p.bounds)));
  assert.equal(pieces(shape(0, 0, 400, 4)).length, 1);
});
