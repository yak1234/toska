// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Ask Luna the shipped new_ground question (src/visual-checks.ts newGroundCheck; openspec blank-canvas-review, task 5.1)
// about a folder of new-ground crops, and compare with hand labels when the folder has them. The crops are the artist's
// paintings: the folder stays outside git. About $0.0005 a crop.
//   node scripts/read-new-ground.mjs <folder> [--json]
// <folder> holds <case>-crop.jpg files and, optionally, labels.json: {"<case>": ["picture"], "<case>": ["underpainting", "placeholder"]}
// (every reading a person would accept for that crop). Luna's key as scripts/calibrate-luna-artifacts.mjs reads it.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { newGroundCheck } from '../src/visual-checks.ts';
import { DecisionClient } from '../src/decisions/client.ts';
import { BUILT_IN_ENDPOINTS } from '../src/decisions/endpoints.ts';
import { lunaKey } from './calibrate-luna-artifacts.mjs';

const FACTS = 'MEASURED FACTS (from the pixels, not a guess): before this painting batch, part of the canvas was empty (no paint at all). '
  + 'Paint there is new ground: it covers nothing and replaces nothing, so it is not a patch or block laid over the painting.';

const folder = process.argv[2];
if (!folder) { console.error('Usage: node scripts/read-new-ground.mjs <folder> [--json]'); process.exit(2); }
const apiKey = await lunaKey();
if (!apiKey) { console.error('No OpenRouter key: connect OpenRouter in the app or set OPENROUTER_API_KEY.'); process.exit(2); }
const client = new DecisionClient({ endpoint: BUILT_IN_ENDPOINTS.openrouter, apiKey, images: true, timeout: 30000 });
const labels = JSON.parse(await readFile(join(folder, 'labels.json'), 'utf8').catch(() => '{}'));
const rows = [];
for (const file of (await readdir(folder)).filter(name => name.endsWith('-crop.jpg')).sort()) {
  const id = file.slice(0, -'-crop.jpg'.length);
  const crop = { type: 'image', data: (await readFile(join(folder, file))).toString('base64'), mimeType: 'image/jpeg' };
  const answer = await newGroundCheck({ client, crop, facts: FACTS });
  const accepted = labels[id] ?? null;
  rows.push({ id, ...(answer.fallback ? { fallback: answer.fallback } : { reading: answer.reading, confidence: +answer.confidence.toFixed(2),
    probabilities: Object.fromEntries(Object.entries(answer.probabilities).map(([k, v]) => [k, +v.toFixed(2)])) }),
    ...(accepted ? { accepted, agrees: !answer.fallback && accepted.includes(answer.reading) } : {}) });
}
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 1));
else {
  for (const row of rows) console.log(row.id, row.fallback ? `fallback: ${row.fallback}` : `${row.reading} (${row.confidence})`, JSON.stringify(row.probabilities ?? {}),
    row.accepted ? (row.agrees ? 'agrees' : `DISAGREES (accepted: ${row.accepted.join(' or ')})`) : '');
  const judged = rows.filter(row => row.accepted);
  if (judged.length) console.log(`${judged.filter(row => row.agrees).length} of ${judged.length} agree with the hand labels.`);
}
