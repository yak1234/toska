// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Development only: the brushwork measure for two close-ups (openspec painting-skills goal 5).
//   node scripts/brushwork-compare.ts <original.png> <canvas.png> [more canvases.png ...]
// Each picture is a PNG close-up of at least 512 x 512 px cut from the picture at full size (1024 px or less for the
// findings to be read at its own size). Prints, for each canvas against the original: the style distance (0 the same
// kind of surface, towards 1 unlike; no lining up needed; two spots of one real pastel are about 0.2), and, for the
// same place in both, the classical score with what differs in plain words.
// The style model is built once with scripts/build-style-model.py into the data folder (STYLE_MODEL_DIR overrides).
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decodeRgba } from '../src/png-rgba.ts';
import { brushworkFindings, brushworkScore } from '../src/brushwork-score.ts';
import { styleDistance, styleStatistics } from '../src/style-distance.ts';
import { onnxStyleSession } from '../src/style-distance-onnx.ts';

const [original, ...canvases] = process.argv.slice(2);
if (!original || !canvases.length) { console.error('usage: node scripts/brushwork-compare.ts <original.png> <canvas.png> [...]'); process.exit(2); }
const modelDir = process.env.STYLE_MODEL_DIR
  || join(homedir(), 'Library/Application Support/KritaAgent/creative-agent/data/models/vgg19-style/timm-vgg19-tv-in1k-levels4');
const load = async (path: string) => {
  const decoded = decodeRgba(await readFile(path), 30_000_000, { ignoreColour: true });
  if (!decoded) throw new Error(`${path} is not a PNG this reads (8-bit, not interlaced).`);
  return { width: decoded.width, height: decoded.height, data: new Uint8Array(decoded.data) };
};
const session = await onnxStyleSession(modelDir);
const first = await load(original), statistics = await styleStatistics(first, session);
for (const path of canvases) {
  const canvas = await load(path), score = brushworkScore(first, canvas);
  console.log(JSON.stringify({ canvas: path, style_distance: Math.round(styleDistance(statistics, await styleStatistics(canvas, session)) * 1000) / 1000,
    same_place_score: score.score, findings: brushworkFindings(score) }, null, 1));
}
process.exit(0);
