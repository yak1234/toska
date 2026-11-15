// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The learned layer of the brushwork measure (openspec painting-skills goal 5; a study measure, never a run-time check).
// It answers one question: are the marks in two close-ups the same kind of surface? It compares texture statistics, not
// pixels: the Gram matrices of the first four feature levels of VGG19 (the "style" of neural style transfer), taken on
// lightness only, in 512 px tiles of each crop at its own size. So nothing needs to line up: two spots of one pastel
// are close, and a pastel against its smoothed copy is far, wherever the copy's crop was cut. That is what the tasks
// without an original to line up with need (Tinker, Transfer), and what a pixel measure cannot give.
//
// Chosen by a trial on real close-ups (2026-11-15; proposal goal 5): against DISTS, DINOv2 texture statistics, DreamSim
// and LPIPS it separated best. A real pastel square against another spot of the same picture: 0.18; against the same
// picture sharpened from a quarter-size copy 0.55, plainly enlarged 0.61, repainted in uniform dabs 0.66; moved 20 px 0.02.
// The calibration is kept as a test (tests/style-distance.test.ts, pictures in tests/fixtures/brushwork).
//
// Pure: the model sits behind StyleSession (style-distance-onnx.ts loads it; scripts/build-style-model.py builds it).
// Crops that teach or grade brushwork come from pictures that hold it (museum images), never from a sharpened copy.

export type Rgba = { width: number; height: number; data: Uint8Array };
/** The model's tile: 512 px a side of lightness in, one Gram matrix a level out. */
export const TILE = 512;
export const LEVELS = 4;
/** One level's Gram matrix per entry, flattened; a crop's statistics are the mean of its tiles'. */
export type StyleStatistics = Float32Array[];
export interface StyleSession { grams(luminance: Float32Array): Promise<Float32Array[]> }

/** The crop's whole 512 px tiles as lightness 0 to 1, row by row, the grid centred in the crop. */
export function luminanceTiles(image: Rgba): Float32Array[] {
  const columns = Math.floor(image.width / TILE), rows = Math.floor(image.height / TILE);
  if (!columns || !rows || image.data.length < image.width * image.height * 4)
    throw new Error(`A crop for the style distance is an RGBA image of at least ${TILE} x ${TILE} pixels: brushwork is read at the crop's own size.`);
  const left = Math.floor((image.width - columns * TILE) / 2), top = Math.floor((image.height - rows * TILE) / 2), tiles: Float32Array[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const tile = new Float32Array(TILE * TILE);
    for (let y = 0; y < TILE; y++) {
      let i = ((top + row * TILE + y) * image.width + left + column * TILE) * 4;
      for (let x = 0; x < TILE; x++, i += 4)
        tile[y * TILE + x] = (image.data[i]! * 0.2126 + image.data[i + 1]! * 0.7152 + image.data[i + 2]! * 0.0722) / 255;
    }
    tiles.push(tile);
  }
  return tiles;
}

/** A crop's texture statistics: each level's Gram matrix, averaged over the crop's tiles. */
export async function styleStatistics(image: Rgba, session: StyleSession): Promise<StyleStatistics> {
  const tiles = luminanceTiles(image);
  let sum: Float32Array[] | null = null;
  for (const tile of tiles) {
    const grams = await session.grams(tile);
    if (grams.length !== LEVELS) throw new Error(`The style model gave ${grams.length} levels, not ${LEVELS}.`);
    if (!sum) sum = grams.map(g => Float32Array.from(g));
    else grams.forEach((g, level) => { const s = sum![level]!; for (let i = 0; i < s.length; i++) s[i]! += g[i]!; });
  }
  return sum!.map(level => level.map(v => v / tiles.length));
}

const norm = (values: Float32Array) => { let sum = 0; for (const v of values) sum += v * v; return Math.sqrt(sum); };

/** How far apart two crops' brushwork is: 0 the same texture statistics, towards 1 unlike. The mean over the levels of
 * |Ga - Gb| / (|Ga| + |Gb|), so no level's size outweighs another's. */
export function styleDistance(a: StyleStatistics, b: StyleStatistics): number {
  if (a.length !== b.length || a.some((level, i) => level.length !== b[i]!.length)) throw new Error('The two crops’ statistics have different levels.');
  let total = 0;
  a.forEach((level, i) => {
    const other = b[i]!, difference = new Float32Array(level.length);
    for (let k = 0; k < level.length; k++) difference[k] = level[k]! - other[k]!;
    const scale = norm(level) + norm(other);
    total += scale > 0 ? norm(difference) / scale : 0;
  });
  return total / a.length;
}
