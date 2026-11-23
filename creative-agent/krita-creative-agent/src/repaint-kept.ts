// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// A repaint kept (openspec repaint-from-asset 5.4). A part repainted from an attached picture holds that picture's
// detail; the chat's goal there is still the underpainting. A pass that reads the goal over the area (Finish, the
// surface and edge passes, a refinement, a second transfer) pulls it back to the underpainting: seen live 2026-11-23,
// test chat 03c8c7e2, where the tower's windows were blended away in the move that painted them. Such a pass is turned
// away over a repainted area; with the fitted picture as its reference it goes through. Pure arithmetic.

/** One area repainted from an attached picture: the fitted picture kept for it, its box on the canvas, the move that painted it. */
export type Repainted = { part: string; asset: string; fitted_id: string; bounds: number[]; size: [number, number]; move?: number };

/** The passes that read a reference's or the goal's pixels and repaint what is there toward them. */
export const GOAL_PASSES = ['paint_from_reference', 'paint_reference_edges', 'paint_reference_surface', 'paint_finish', 'refine_to_goal', 'paint_accents'];
/** A pass covering less than this share of a repainted area only grazes it. */
export const KEPT_SHARE = 0.2;

const isRect = (value: unknown): value is number[] => Array.isArray(value) && value.length >= 4 && value.slice(0, 4).every(n => typeof n === 'number' && Number.isFinite(n));
function meet(a: number[], b: number[]): number[] | null {
  const x = Math.max(a[0]!, b[0]!), y = Math.max(a[1]!, b[1]!);
  const w = Math.min(a[0]! + a[2]!, b[0]! + b[2]!) - x, h = Math.min(a[1]! + a[3]!, b[1]! + b[3]!) - y;
  return w > 0 && h > 0 ? [x, y, w, h] : null;
}

/** Where a pass paints, in canvas pixels: its target or box, inside the artist's Paint only here area; null when nowhere. */
export function passTarget(_tool: string, args: Record<string, unknown>, canvas: [number, number], area: number[] | null): number[] | null {
  const box = (args.area as { box?: unknown } | undefined)?.box;
  const own = isRect(args.target) ? args.target.slice(0, 4) : isRect(box) ? box.slice(0, 4) : [0, 0, canvas[0], canvas[1]];
  return area ? meet(own, area) : meet(own, [0, 0, canvas[0], canvas[1]]);
}

/** Why this call must not run (it would paint a repainted area back toward the goal), or null. */
export function repaintKept(call: { tool: string; args: Record<string, unknown>; repainted: Repainted[]; canvas: [number, number]; area: number[] | null }): string | null {
  if (!GOAL_PASSES.includes(call.tool) || !call.repainted.length) return null;
  const reference = typeof call.args.reference_id === 'string' ? call.args.reference_id : null;
  const target = passTarget(call.tool, call.args, call.canvas, call.area);
  if (!target) return null;
  const hit = call.repainted.filter(done => {
    if (reference && reference === done.fitted_id) return false;
    const shared = meet(target, done.bounds);
    return !!shared && shared[2]! * shared[3]! >= KEPT_SHARE * done.bounds[2]! * done.bounds[3]!;
  });
  if (!hit.length) return null;
  const named = hit.map(done => `${done.part} (repainted from "${done.asset}", box [${done.bounds.slice(0, 4).join(',')}])`).join('; ');
  const how = hit.map(done => `reference_id ${done.fitted_id}, source [0,0,${done.size[0]},${done.size[1]}], target [${done.bounds.slice(0, 4).join(',')}]`).join('; or ');
  return `Nothing was painted: ${call.tool} here would paint over ${named}. That paint came from the artist's attached picture and is finished as it is; `
    + `this pass reads the underpainting there and would blur it back. Leave ${hit.length === 1 ? 'that area' : 'those areas'} alone: give this pass a box that stays clear of ${hit.length === 1 ? 'it' : 'them'}, `
    + `or end the move. Only if the area still needs paint, use paint_from_reference with its fitted picture (${how}).`;
}
