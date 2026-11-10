// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Blank-canvas review (openspec blank-canvas-review). Luna's move review asks whether a batch left "a new rectangle
// that BEFORE did not show". On empty canvas every batch is one: a perfect copy of a painting onto its empty half was
// undone as a flat block at 1.0 (Istanbul, 2026-11-10), and so was everything tried after it. What was empty is
// measured by the plugin (blank_canvas.py change_map), never asked of a model; this module decides from that measure
// what kind of batch it was, what Luna is told, and which findings still count. Pure: no I/O.

/** The plugin's change_map answer: shares are 0..1, the box is in fractions of the view. */
export type ChangeMap = { fresh_share: number; removed_share: number; changed_share: number;
  fresh_box: [number, number, number, number] | null; cells: Record<string, { empty_before: number; fresh: number }> };
/** over: paint over paint, reviewed as before. new_ground: nearly all of it on empty canvas. mixed: both. */
export type BatchKind = 'over' | 'new_ground' | 'mixed';
/** What new ground reads as (visual-check-questions.json new_ground). */
export type Reading = 'picture' | 'underpainting' | 'placeholder' | 'other';
/** same_finish: Luna's probability that the new ground has the finish of the paint beside it (null: nothing to compare with). */
/** box: the new ground in fractions of the view (the plugin's fresh_box), kept so the chat remembers unsettled ground. */
export type Box = [number, number, number, number];
/** detail: where the crop Luna read came from, the document (review_crops) or the canvas view. tiles: the parts shown at
 * actual pixels, in canvas pixels (openspec full-detail-review-crops). */
export type Detail = { detail?: 'document' | 'view'; tiles?: { fresh: Box[]; painting: Box[] } };
export type NewGround = { reading: Reading; confidence: number; same_finish?: number | null; box?: Box } & Detail;
/** Boxes of unsettled ground a chat keeps (the plugin's GROUND_LIMIT). */
export const GROUND_LIMIT = 8;
/** Below this, new ground that reads as a picture is coarser than the painting beside it (visual-check-questions.json). */
export const SAME_FINISH = 0.5;
type Located = { type: string; location?: string | null };

/** At or above this share of the change on empty canvas the batch is new ground; below OVER_PAINT it is paint over paint. */
export const NEW_GROUND = 0.9, OVER_PAINT = 0.1;
/** A ninth counts as empty before the batch at this share. */
export const EMPTY_CELL = 0.9;
/** This share of the painted pixels turned empty is removed artwork (a hidden or cleared layer). */
export const REMOVED = 0.2;
/** A change smaller than this share of the view is not classified: the measure is too coarse for it. */
export const MIN_CHANGE = 0.002;
/** Moves running whose new ground read as a placeholder before the move stops for the artist. */
export const PLACEHOLDER_RUN = 3;
/** The new-ground crop's longest side, in pixels (never more than the view shows). */
export const CROP_SIDE = 1024;

const CELL_NAMES: Record<string, string> = { top_left: 'top-left', top_center: 'top-centre', top_right: 'top-right',
  middle_left: 'middle-left', center: 'centre', middle_right: 'middle-right', bottom_left: 'bottom-left',
  bottom_center: 'bottom-centre', bottom_right: 'bottom-right' };
const share = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1;

/** The plugin's answer checked field by field (it crosses the bridge), or null. */
export function parseChangeMap(value: unknown): ChangeMap | null {
  const v = value as Partial<ChangeMap> | null;
  if (!v || typeof v !== 'object' || !share(v.fresh_share) || !share(v.removed_share) || !share(v.changed_share)) return null;
  const box = v.fresh_box ?? null;
  if (box !== null && !(Array.isArray(box) && box.length === 4 && box.every(share) && box[2] > 0 && box[3] > 0)) return null;
  if (!v.cells || typeof v.cells !== 'object') return null;
  const cells: ChangeMap['cells'] = {};
  for (const name of Object.keys(CELL_NAMES)) {
    const cell = (v.cells as Record<string, { empty_before?: unknown; fresh?: unknown }>)[name];
    if (!cell || !share(cell.empty_before) || !share(cell.fresh)) return null;
    cells[name] = { empty_before: cell.empty_before, fresh: cell.fresh };
  }
  return { fresh_share: v.fresh_share, removed_share: v.removed_share, changed_share: v.changed_share,
    fresh_box: box as ChangeMap['fresh_box'], cells };
}

export function batchKind(map: ChangeMap): BatchKind {
  if (map.changed_share < MIN_CHANGE || !map.fresh_box || map.fresh_share < OVER_PAINT) return 'over';
  return map.fresh_share >= NEW_GROUND ? 'new_ground' : 'mixed';
}

/** The ninths that were empty canvas before the batch, in reading order. */
export const emptyCells = (map: ChangeMap): string[] => Object.keys(CELL_NAMES).filter(name => map.cells[name].empty_before >= EMPTY_CELL);

/** Did the batch remove artwork (painted before, empty after)? Measured, so it is a finding at probability 1. */
export const removedArtwork = (map: ChangeMap): boolean => map.removed_share >= REMOVED;
/** A new ground that is the painting itself in another place: read as a picture, in the painting's finish. */
export const RELOCATED_CONFIDENCE = 0.6;
export const relocated = (read: { reading: string; confidence: number; same_finish: number | null }): boolean =>
  read.reading === 'picture' && read.confidence >= RELOCATED_CONFIDENCE && read.same_finish !== null && read.same_finish >= SAME_FINISH;

/** The text part that opens a review of a new-ground or mixed batch: what was measured, in the words of the questions. */
export function factsText(map: ChangeMap): string {
  const empty = emptyCells(map).map(name => CELL_NAMES[name]);
  const where = empty.length === 9 ? 'The whole canvas was empty'
    : empty.length ? `These ninths of the canvas were empty (no paint at all): ${empty.join(', ')}`
    : 'Part of the canvas was empty (no paint at all)';
  return `MEASURED FACTS (from the pixels, not a guess): before this painting batch, ${where[0].toLowerCase()}${where.slice(1)}. `
    + `${Math.round(map.fresh_share * 100)}% of what the batch changed is on that empty canvas. Paint there is new ground: `
    + 'it covers nothing and replaces nothing, so it is not a patch or block laid over the painting.';
}

/** Artifact findings that sit in a ninth that was empty are not damage: dropped. A covered feature and removed artwork
 * are about paint BEFORE showed, so they stay wherever they are; so does a finding with no location. */
export function dropFreshFindings<T extends Located>(findings: T[], map: ChangeMap): T[] {
  const empty = new Set(emptyCells(map));
  return findings.filter(f => f.type === 'covered_feature' || f.type === 'artwork_removed' || !f.location || !empty.has(f.location));
}

/** The new ground as comparison_crop asks for it: `source` in canvas pixels and `out` in pixels, at the scale the
 * view shows (viewScale = view pixels per canvas pixel), at most CROP_SIDE on the long side. */
export function newGroundCrop(map: ChangeMap, canvas: { width: number; height: number }, viewScale: number): { source: [number, number, number, number]; out: [number, number] } | null {
  if (!map.fresh_box) return null;
  const [fx, fy, fw, fh] = map.fresh_box;
  const x = Math.min(canvas.width - 1, Math.max(0, Math.round(fx * canvas.width))), y = Math.min(canvas.height - 1, Math.max(0, Math.round(fy * canvas.height)));
  const w = Math.max(1, Math.min(canvas.width - x, Math.round(fw * canvas.width))), h = Math.max(1, Math.min(canvas.height - y, Math.round(fh * canvas.height)));
  const scale = Math.min(viewScale, CROP_SIDE / Math.max(w, h));
  return { source: [x, y, w, h], out: [Math.max(16, Math.round(w * scale)), Math.max(16, Math.round(h * scale))] };
}

/** A ninth the batch did not touch and that was painted before: at most these shares empty and fresh. */
export const PAINTED_CELL = { empty: 0.1, fresh: 0.02 };
/** What the plugin's review_crops is asked (openspec full-detail-review-crops): the fresh box and the painted ninths the
 * batch did not touch, in whole canvas pixels. The plugin reads them from the document and chooses the 1:1 tiles. */
export function detailPlan(map: ChangeMap, canvas: { width: number; height: number }): { fresh: Box; painted: Box[] } | null {
  const crop = newGroundCrop(map, canvas, 1);
  if (!crop) return null;
  const painted: Box[] = [];
  Object.keys(CELL_NAMES).forEach((name, index) => {
    const cell = map.cells[name], row = Math.floor(index / 3), column = index % 3;
    if (cell.empty_before > PAINTED_CELL.empty || cell.fresh > PAINTED_CELL.fresh) return;
    const x = Math.floor(column * canvas.width / 3), y = Math.floor(row * canvas.height / 3);
    const w = Math.floor((column + 1) * canvas.width / 3) - x, h = Math.floor((row + 1) * canvas.height / 3) - y;
    if (w > 0 && h > 0) painted.push([x, y, w, h]);
  });
  return { fresh: crop.source, painted };
}
type Picture = { type: 'image'; data: string; mimeType: string };
export type ReviewCrops = { crop: Picture; scale: number; fresh: { image: Picture; box: Box }[]; painting: { image: Picture; box: Box }[] };
/** The plugin's review_crops answer checked field by field, or null (the review then cuts its crop from the view). */
export function parseReviewCrops(value: unknown): ReviewCrops | null {
  const v = value as { whole?: unknown; fresh_tiles?: unknown; painting_tiles?: unknown } | null;
  if (!v || typeof v !== 'object') return null;
  const picture = (part: unknown): Picture | null => {
    const p = part as { image_base64?: unknown; mime_type?: unknown } | null;
    return p && typeof p === 'object' && typeof p.image_base64 === 'string' && p.image_base64.length > 0
      ? { type: 'image', data: p.image_base64, mimeType: typeof p.mime_type === 'string' ? p.mime_type : 'image/jpeg' } : null;
  };
  const box = (b: unknown): b is Box => Array.isArray(b) && b.length === 4 && b.every(n => Number.isInteger(n) && n >= 0) && b[2] > 0 && b[3] > 0;
  const crop = picture(v.whole), scale = (v.whole as { scale?: unknown } | null)?.scale;
  if (!crop || typeof scale !== 'number' || !(scale > 0 && scale <= 1)) return null;
  const tiles = (list: unknown): { image: Picture; box: Box }[] | null => {
    if (!Array.isArray(list) || list.length > 4) return null;
    const out: { image: Picture; box: Box }[] = [];
    for (const item of list) {
      const image = picture(item), source = (item as { source?: unknown } | null)?.source;
      if (!image || !box(source)) return null;
      out.push({ image, box: source });
    }
    return out;
  };
  const fresh = tiles(v.fresh_tiles), painting = tiles(v.painting_tiles);
  return fresh && painting ? { crop, scale, fresh, painting } : null;
}

/** What the painter is told about kept new ground; nothing for a picture in the painting's finish. */
export function newGroundNote({ reading, same_finish }: NewGround): string | null {
  if (reading === 'underpainting') return 'Luna: the new area on the empty canvas reads as an underpainting (colours and big shapes are placed, but separate dabs or blocks still show). It is kept. Blend or finish it next; do not start it again.';
  if (reading === 'placeholder') return 'Luna: the new area on the empty canvas reads as a placeholder (a flat fill, a plain gradient or scattered marks, with no forms). It is kept. Paint the picture over it next, by a route that brings forms (a copy of existing paint, a reference transfer, then a blend); do not start it again.';
  if (reading === 'picture' && typeof same_finish === 'number' && same_finish < SAME_FINISH)
    return 'Luna: the new area on the empty canvas reads as a picture, but coarser, flatter or more graphic than the painting beside it. It is kept. Bring it to the same finish next (the same brushwork, detail and light); do not start it again.';
  return null;
}

type MoveLike = { number: number; luna_stopped?: string; review?: { batches: number; undone_batches: number; new_ground?: NewGround } };
/** Why a painted move needs the artist and must not be auto-approved, or null. `moves` are the chat's moves in order. */
export function needsArtist(move: MoveLike, moves: MoveLike[]): string | null {
  if (move.luna_stopped) return 'Luna stopped this move.';
  const review = move.review;
  if (review && review.batches > 0 && review.undone_batches >= review.batches) return 'Luna undid every batch of this move: nothing of it is on the canvas.';
  const upTo = moves.filter(m => m.number <= move.number).slice(-PLACEHOLDER_RUN);
  if (upTo.length === PLACEHOLDER_RUN && upTo.every(m => m.review?.new_ground?.reading === 'placeholder'))
    return `The new area read as a placeholder in ${PLACEHOLDER_RUN} moves running.`;
  return null;
}

const settled = (ground: NewGround): boolean => ground.reading === 'picture' && !(typeof ground.same_finish === 'number' && ground.same_finish < SAME_FINISH);
const overlaps = (a: Box, b: Box): boolean => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const contains = (a: Box, b: Box): boolean => a[0] <= b[0] && a[1] <= b[1] && a[0] + a[2] >= b[0] + b[2] && a[1] + a[3] >= b[1] + b[3];
const union = (a: Box, b: Box): Box => { const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
  return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y]; };
/** The chat's unsettled ground after a kept batch: canvas that was empty when the chat first painted on it and has not
 * read as a picture in the painting's finish yet. The next layer over it (dabs over a wash, a blend over dabs) is still
 * new ground, not paint over a painting: Luna flagged dabs over a kept wash as a flat block at 1.0 and undid them
 * (Istanbul 2026-11-10, 05:07). Ground that reads as a finished picture is settled: it leaves the list and is protected
 * like any paint. At most GROUND_LIMIT boxes: past that the two that overlap (else the first two) are joined. */
export function updateGround(boxes: Box[], ground: NewGround): Box[] {
  const box = ground.box;
  if (!box) return boxes;
  if (settled(ground)) return boxes.filter(kept => !overlaps(kept, box));
  if (boxes.some(kept => contains(kept, box))) return boxes;
  const next = [...boxes.filter(kept => !contains(box, kept)), box];
  while (next.length > GROUND_LIMIT) {
    let pair: [number, number] = [0, 1];
    search: for (let i = 0; i < next.length; i++) for (let j = i + 1; j < next.length; j++) if (overlaps(next[i], next[j])) { pair = [i, j]; break search; }
    const joined = union(next[pair[0]], next[pair[1]]);
    next.splice(pair[1], 1); next.splice(pair[0], 1, joined);
  }
  return next;
}
/** Stored ground boxes checked before they are sent to the plugin. */
export const groundBoxes = (value: unknown): Box[] => (Array.isArray(value) ? value : []).filter((box): box is Box =>
  Array.isArray(box) && box.length === 4 && box.every(share) && box[2] > 0 && box[3] > 0 && box[0] + box[2] <= 1.0001 && box[1] + box[3] <= 1.0001).slice(0, GROUND_LIMIT);

type Finding = { type: string; label: string; probability: number; location: string | null; feature?: string };
type Usage = { cost: number; input_tokens: number };
/** Luna did not answer: the reason (decisions/types.ts FallbackReason, or 'no_checks') and the time spent. */
export type ReviewFallback = { fallback: string; elapsed_ms: number };
export type OverAnswer = { findings: Finding[]; usage: Usage; elapsed_ms: number; fallback?: undefined };
export type GroundAnswer = { reading: Reading; confidence: number; same_finish: number | null; usage: Usage; elapsed_ms: number; fallback?: undefined } & Detail;
/** A reviewed batch: the move check's result, with what its new ground read as when it had any. */
export type Reviewed = ReviewFallback | (OverAnswer & { new_ground?: NewGround; kind?: BatchKind; relocated?: boolean });
export const ARTWORK_REMOVED: Finding = { type: 'artwork_removed', label: 'artwork removed', probability: 1, location: null };
const failed = (result: { fallback?: string } | null): result is ReviewFallback => typeof result?.fallback === 'string';
/** One batch's review, by its kind (goal 2). over(facts): the BEFORE/AFTER move check. ground(facts): what the new
 * ground reads as. Without a map (an older plugin, a failed measure) the batch is reviewed as before this change.
 * Removed artwork is measured, so it is a finding even when Luna does not answer. */
export async function reviewBatch({ map, over, ground }: { map: ChangeMap | null;
  over: (facts?: string) => Promise<OverAnswer | ReviewFallback>; ground: (facts: string) => Promise<GroundAnswer | ReviewFallback> }): Promise<Reviewed> {
  if (!map) return over();
  const kind = batchKind(map), removed = removedArtwork(map) ? [ARTWORK_REMOVED] : [];
  const none: Usage = { cost: 0, input_tokens: 0 };
  if (kind === 'over') {
    const result = await over();
    if (failed(result)) return removed.length ? { findings: removed, usage: none, elapsed_ms: result.elapsed_ms, kind } : result;
    return { ...result, findings: [...removed, ...result.findings], kind };
  }
  const facts = factsText(map);
  const [painted, read] = await Promise.all([kind === 'mixed' ? over(facts) : null, ground(facts)]);
  const elapsed_ms = Math.max(painted?.elapsed_ms ?? 0, read.elapsed_ms);
  const overOk = painted && !failed(painted) ? painted : null, readOk = failed(read) ? null : read;
  if (!overOk && !readOk && !removed.length) return failed(painted) ? painted : read as ReviewFallback;
  const usage: Usage = { cost: (overOk?.usage.cost ?? 0) + (readOk?.usage.cost ?? 0), input_tokens: (overOk?.usage.input_tokens ?? 0) + (readOk?.usage.input_tokens ?? 0) };
  // Artwork moved, not removed (Istanbul: the harbour moved to the right half so the left could become the dock): what left
  // one place is on what was empty canvas as a picture in the painting's own finish. The paint-over findings would only
  // describe the place it left, so the batch is kept on the new ground's reading alone.
  if (removed.length && readOk && relocated(readOk))
    return { findings: [], usage, elapsed_ms, kind, relocated: true,
      new_ground: { reading: readOk.reading, confidence: readOk.confidence, same_finish: readOk.same_finish, ...(map.fresh_box ? { box: map.fresh_box } : {}),
        ...(readOk.detail ? { detail: readOk.detail } : {}), ...(readOk.tiles ? { tiles: readOk.tiles } : {}) } };
  return { findings: [...removed, ...(overOk ? dropFreshFindings(overOk.findings, map) : [])], usage, elapsed_ms, kind,
    ...(readOk ? { new_ground: { reading: readOk.reading, confidence: readOk.confidence, same_finish: readOk.same_finish, ...(map.fresh_box ? { box: map.fresh_box } : {}),
      ...(readOk.detail ? { detail: readOk.detail } : {}), ...(readOk.tiles ? { tiles: readOk.tiles } : {}) } } : {}) };
}
