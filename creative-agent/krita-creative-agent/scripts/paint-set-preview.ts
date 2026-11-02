// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Dry run of the transfer's paint set (colour-mixing task 7d) without Toska: chooses the paint set for a reference (or
// takes the named paints), lays every pixel of it as the transfer lays a dab (src/colour-mixing/paint-set.ts), and prints
// the numbers the transfer reports, counting each pixel as a dab. With --out it writes the reference with every colour
// replaced by the colour laid for it, to see before a live run whether the paint set really changes colours.
//   node scripts/paint-set-preview.ts --reference <img> [--strictness exact|close|loose] [--paints "Cobalt Blue,Titanium White"]
//     [--out preview.png]
// A PNG is read here; another format (the benchmark scenes are JPEG) is converted to a PNG in a temporary folder by the
// first converter found (sips on macOS, ImageMagick's magick or convert, ffmpeg), and the folder is deleted.
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { decodeRgba } from '../src/png-rgba.ts';
import { encodeRgba } from '../src/shapes/png.ts';
import { ColourHistogram, choosePaintSet, paintSetLayer, PaintSetTally, STRICTNESSES, STRICTNESS_LIMITS, DEFAULT_STRICTNESS, checkPaints } from '../src/colour-mixing/paint-set.ts';
import type { Laid, Strictness } from '../src/colour-mixing/paint-set.ts';
import { PAINT_NAMES } from '../src/colour-mixing/paints.ts';

const run = promisify(execFile);
const MAX_PIXELS = 64_000_000;

type Picture = { width: number; height: number; data: Uint8Array };

async function readPicture(file: string): Promise<Picture> {
  const bytes = await readFile(file);
  const own = decodeRgba(bytes, MAX_PIXELS, { ignoreColour: true });
  if (own) return own;
  const folder = await mkdtemp(join(tmpdir(), 'paint-set-preview-'));
  try {
    const png = join(folder, 'reference.png');
    const converters: [string, string[]][] = [
      ['sips', ['-s', 'format', 'png', file, '--out', png]], ['magick', [file, png]], ['convert', [file, png]],
      ['ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-pix_fmt', 'rgba', png]],
    ];
    for (const [tool, args] of converters) {
      try { await run(tool, args, { maxBuffer: 1 << 20 }); } catch { continue; }
      const converted = decodeRgba(await readFile(png).catch(() => Buffer.alloc(0)), MAX_PIXELS, { ignoreColour: true });
      if (converted) return converted;
    }
    throw new Error(`Cannot read ${file}: not a plain 8-bit PNG, and no converter (sips, magick, convert, ffmpeg) turned it into one.`);
  } finally { await rm(folder, { recursive: true, force: true }); }
}

const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;

async function main() {
  const { values } = parseArgs({ options: { reference: { type: 'string' }, strictness: { type: 'string' }, paints: { type: 'string' }, out: { type: 'string' } } });
  if (!values.reference) throw new Error('Usage: paint-set-preview.ts --reference <img> [--strictness exact|close|loose] [--paints a,b,c] [--out preview.png]');
  const strictness = (values.strictness ?? DEFAULT_STRICTNESS) as Strictness;
  if (!STRICTNESSES.includes(strictness)) throw new Error(`--strictness is one of ${STRICTNESSES.join(', ')}.`);
  const began = Date.now();
  const picture = await readPicture(values.reference), { width, height, data } = picture, pixels = width * height;
  const histogram = new ColourHistogram(), seen = new Set<number>();
  for (let i = 0; i < pixels; i++) {
    const a = data[i * 4 + 3]!;
    if (a < 3) continue;
    const r = data[i * 4]!, g = data[i * 4 + 1]!, b = data[i * 4 + 2]!;
    histogram.add(r, g, b, a / 255);
    seen.add((r << 16) | (g << 8) | b);
  }
  const quantised = histogram.quantise();
  let paints: string[];
  if (values.paints) { paints = values.paints.split(',').map(n => n.trim()).filter(Boolean); checkPaints(paints); }
  else paints = choosePaintSet(quantised, strictness).paints;
  const chosenAt = Date.now();
  const layer = paintSetLayer(paints, strictness), tally = new PaintSetTally(paints, strictness), known = new Map<number, [Laid, string]>();
  const out = values.out ? new Uint8Array(data) : null;
  for (let i = 0; i < pixels; i++) {
    if (data[i * 4 + 3]! < 3) continue;
    const key = (data[i * 4]! << 16) | (data[i * 4 + 1]! << 8) | data[i * 4 + 2]!;
    let entry = known.get(key);
    if (!entry) { const hex = '#' + key.toString(16).padStart(6, '0'); entry = [layer(hex), hex]; known.set(key, entry); }
    tally.add(entry[1], entry[0]);
    if (out && entry[0].color !== entry[1]) { const v = parseInt(entry[0].color.slice(1), 16); out[i * 4] = v >> 16; out[i * 4 + 1] = (v >> 8) & 255; out[i * 4 + 2] = v & 255; }
  }
  const report = tally.report(), b = report.bands;
  if (out && values.out) await writeFile(values.out, encodeRgba({ width, height, data: out }));
  const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`;
  console.log(`reference ${basename(values.reference)} ${width}×${height}, ${pixels.toLocaleString('en-US')} pixels (each counted as a dab), ${seen.size.toLocaleString('en-US')} colours, ${quantised.length} quantised for choosing`);
  console.log(`strictness ${strictness} (ΔE00 ≤ ${STRICTNESS_LIMITS[strictness]})`);
  console.log(`paints (${paints.length}): ${paints.join(', ')}${values.paints ? '' : ` (chosen from ${PAINT_NAMES.length})`}`);
  console.log(`share per ΔE00 band: ≤1 ${percent(b.at_most_1)} · ≤2 ${percent(b.at_most_2)} · ≤5 ${percent(b.at_most_5)} · ≤10 ${percent(b.at_most_10)} · >10 ${percent(b.over_10)}`);
  console.log(`largest ΔE00 ${report.largest_delta_e} · unmixed ${Math.round(report.unmixed).toLocaleString('en-US')} (${percent(report.unmixed / (report.dabs || 1))}) · changed ${percent(report.changed_share)}`);
  console.log(`time: read and choose ${seconds(chosenAt - began)}, lay ${seconds(Date.now() - chosenAt)}${values.out ? ` · wrote ${values.out}` : ''}`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
