// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// make_brush's settings vocabulary turned into a brush recipe (painting-skills goal 2, task 3.1): a base preset, its
// engine, the engine properties to set on the stroke job's own copy of the preset (Node.paintStrokes presetProperties)
// and a change to the tip. The painter never writes engine keys: it says "rectangle tip, half as high, size follows
// pressure steeply" and this file states it in Krita's keys, inside limits. The plugin checks the recipe again against
// the base preset before it paints (kritamcp/brush_maker.py): engines ignore unknown keys silently, so a typo would
// look like success.
//
// Key names and value forms are read from Toska's presets (local-notes/wikiart-study/mechanism-checks/engine-keys.json)
// and seen to work through presetProperties (tasks 1.2 to 1.4): a tip is the brush_definition XML, a sensor is a
// Pressure<Option> switch with <Option>Sensor and <Option>commonCurve, a texture is named by its pattern.

export const ENGINES = ['paintbrush', 'colorsmudge'] as const;
export type Engine = typeof ENGINES[number];
export type PropertyValue = string | number | boolean;
/** What the tip becomes: `replace` builds a new generated tip from `brush` and `mask` (a shape was given); otherwise the
 * attributes are set on the base preset's own tip (its Brush element and, for a generated tip, its MaskGenerator). */
export type TipChange = { replace: boolean; brush: Record<string, string>; mask: Record<string, string> };
export type BrushRecipe = { base_preset: string; engine: Engine; properties: Record<string, PropertyValue>; tip?: TipChange };
export type Base = { preset: string; engine: string };

/** Pen inputs a setting can follow, by the painter's word, as Krita's sensor ids. */
export const INPUTS = { pressure: 'pressure', speed: 'speed', drawing_angle: 'drawingangle', fade: 'fade', distance: 'distance',
  fuzzy_dab: 'fuzzy', fuzzy_stroke: 'fuzzystroke' } as const;
export type Input = keyof typeof INPUTS;
/** Settings that can follow a pen input, as the engine's option names (Pressure<Name>, <Name>Sensor, <Name>commonCurve). */
export const RESPONSES = { size: 'Size', opacity: 'Opacity', flow: 'Flow', rotation: 'Rotation', scatter: 'Scatter', softness: 'Softness',
  ratio: 'Ratio' } as const;
const SHAPES = { round: 'circle', rectangle: 'rect' } as const;
const BUILD = { build_up: 1, wash: 2 } as const;               // Krita's PaintOpAction
const SMUDGE_MODES = { smear: 0, dull: 1 } as const;             // Krita's SmudgeRateMode
/** Blend modes a brush may paint in (Krita's ids). Erasing is not a brush: a pass erases by its own option. */
export const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'dodge', 'burn', 'add', 'hard_light', 'soft_light_svg', 'color'] as const;
const LINEAR: readonly (readonly [number, number])[] = [[0, 0], [1, 1]];

const text = (n: number) => String(Number(n.toFixed(4)));
const list = (values: readonly string[]) => values.join(', ');

function fields(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be a map of ${list(allowed)}.`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unknown setting ${path === 'settings' ? '' : path + '.'}${key}; ${path} takes ${list(allowed)}.`);
  }
  return value as Record<string, unknown>;
}
function number(value: unknown, path: string, low: number, high: number, whole = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high || (whole && !Number.isInteger(value)))
    throw new Error(`${path} must be a ${whole ? 'whole ' : ''}number from ${low} to ${high}.`);
  return value;
}
function choice<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${path} must be one of ${list(allowed)}.`);
  return value as T;
}
function flag(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be true or false.`);
  return value;
}

function curveText(value: unknown, path: string): string {
  if (!Array.isArray(value) || value.length < 2 || value.length > 5) throw new Error(`${path} is a curve of 2 to 5 points, each [input, output].`);
  let last = -1;
  const points = value.map(point => {
    if (!Array.isArray(point) || point.length !== 2 || point.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1))
      throw new Error(`${path} is a curve whose points are [input, output], each from 0 to 1.`);
    if (point[0] <= last) throw new Error(`${path} is a curve whose points go left to right: each input larger than the one before.`);
    last = point[0];
    return `${text(point[0])},${text(point[1])};`;
  });
  return points.join('');
}

/** The sensor XML of one pen input with one curve (linear when none is given), as Krita's presets write it. */
export function sensorXml(input: Input, curve: unknown = LINEAR, path = 'curve'): string {
  return `<!DOCTYPE params> <params id="${INPUTS[input]}"> <curve>${curveText(curve, path)}</curve> </params> `;
}

function tipChange(settings: Record<string, unknown>): TipChange | undefined {
  const change: TipChange = { replace: false, brush: {}, mask: {} };
  if (settings.tip !== undefined) {
    const tip = fields(settings.tip, 'tip', ['shape', 'diameter', 'ratio', 'softness', 'spikes', 'density', 'angle', 'randomness']);
    if (tip.shape !== undefined) {
      change.replace = true;
      change.mask.type = SHAPES[choice(tip.shape, 'tip.shape', Object.keys(SHAPES) as (keyof typeof SHAPES)[])];
    }
    if (tip.diameter !== undefined) change.mask.diameter = text(number(tip.diameter, 'tip.diameter', 1, 1000));
    if (tip.ratio !== undefined) change.mask.ratio = text(number(tip.ratio, 'tip.ratio', 0.01, 1));
    // Krita's fade is hardness: 1 is a hard edge, 0 the softest. The painter's word is softness.
    if (tip.softness !== undefined) change.mask.hfade = change.mask.vfade = text(1 - number(tip.softness, 'tip.softness', 0, 1));
    if (tip.spikes !== undefined) change.mask.spikes = text(number(tip.spikes, 'tip.spikes', 2, 12, true));
    if (tip.density !== undefined) change.brush.density = text(number(tip.density, 'tip.density', 0, 1));
    if (tip.angle !== undefined) change.brush.angle = text(number(tip.angle, 'tip.angle', -180, 180) * Math.PI / 180);   // degrees; Krita keeps radians
    if (tip.randomness !== undefined) change.brush.randomness = text(number(tip.randomness, 'tip.randomness', 0, 1));
  }
  if (settings.spacing !== undefined) {
    change.brush.spacing = text(number(settings.spacing, 'spacing', 0.01, 10));
    change.brush.useAutoSpacing = '0';
  }
  return change.replace || Object.keys(change.brush).length || Object.keys(change.mask).length ? change : undefined;
}

/** The recipe for `settings` on `base` (a catalogue preset and its engine). Throws an Error that names the field. */
export function brushRecipe(base: Base, settings: unknown): BrushRecipe {
  if (!ENGINES.includes(base.engine as Engine))
    throw new Error(`A brush cannot be made from ${base.preset}: its engine ${base.engine} has no settings vocabulary yet. Choose a base preset of ${list(ENGINES)}.`);
  const engine = base.engine as Engine;
  const s = fields(settings, 'settings', ['tip', 'spacing', 'scatter', 'opacity', 'flow', 'build', 'blend', 'respond', 'smudge', 'bristle', 'texture']);
  const properties: Record<string, PropertyValue> = {};

  if (s.respond !== undefined) {
    const respond = fields(s.respond, 'respond', Object.keys(RESPONSES));
    for (const [name, value] of Object.entries(respond)) {
      const option = RESPONSES[name as keyof typeof RESPONSES], path = `respond.${name}`;
      if (value === false) { properties[`Pressure${option}`] = false; continue; }
      const response = fields(value, path, ['input', 'curve']);
      const input = choice(response.input, `${path}.input`, Object.keys(INPUTS) as Input[]);
      const curve = curveText(response.curve ?? LINEAR, `${path}.curve`);
      properties[`Pressure${option}`] = true;
      properties[`${option}UseCurve`] = true;
      // Both curves are written: with the shared-curve switch on, the shared one wins over the sensor's own.
      properties[`${option}UseSameCurve`] = false;
      properties[`${option}Sensor`] = sensorXml(input, response.curve ?? LINEAR, `${path}.curve`);
      properties[`${option}commonCurve`] = curve;
    }
  }
  if (s.scatter !== undefined) {
    const scatter = fields(s.scatter, 'scatter', ['amount', 'x', 'y']);
    properties.PressureScatter = true;
    if (scatter.amount !== undefined) properties.ScatterValue = number(scatter.amount, 'scatter.amount', 0, 5);
    if (scatter.x !== undefined) properties['Scattering/AxisX'] = flag(scatter.x, 'scatter.x');
    if (scatter.y !== undefined) properties['Scattering/AxisY'] = flag(scatter.y, 'scatter.y');
  }
  if (s.opacity !== undefined) properties.OpacityValue = number(s.opacity, 'opacity', 0, 1);
  if (s.flow !== undefined) properties.FlowValue = number(s.flow, 'flow', 0, 1);
  if (s.build !== undefined) properties.PaintOpAction = BUILD[choice(s.build, 'build', Object.keys(BUILD) as (keyof typeof BUILD)[])];
  if (s.blend !== undefined) properties.CompositeOp = choice(s.blend, 'blend', BLENDS);
  if (s.texture !== undefined) {
    const texture = fields(s.texture, 'texture', ['pattern', 'scale', 'strength']);
    if (typeof texture.pattern !== 'string' || !texture.pattern.trim() || texture.pattern.length > 100)
      throw new Error('texture.pattern must name a pattern of the library (up to 100 characters).');
    properties['Texture/Pattern/Enabled'] = true;
    properties['Texture/Pattern/Name'] = texture.pattern;          // the plugin adds the pattern's file name
    if (texture.scale !== undefined) properties['Texture/Pattern/Scale'] = number(texture.scale, 'texture.scale', 0.1, 10);
    if (texture.strength !== undefined) {
      properties['PressureTexture/Strength/'] = true;
      properties['Texture/Strength/Value'] = number(texture.strength, 'texture.strength', 0, 1);
    }
  }
  if (s.smudge !== undefined) {
    if (engine !== 'colorsmudge') throw new Error('smudge settings need a Color Smudge base preset such as k) Blender Basic.');
    const smudge = fields(s.smudge, 'smudge', ['colour_rate', 'smudge_rate', 'mode', 'radius']);
    if (smudge.colour_rate !== undefined) properties.ColorRateValue = number(smudge.colour_rate, 'smudge.colour_rate', 0, 1);
    if (smudge.smudge_rate !== undefined) properties.SmudgeRateValue = number(smudge.smudge_rate, 'smudge.smudge_rate', 0, 1);
    if (smudge.mode !== undefined) properties.SmudgeRateMode = SMUDGE_MODES[choice(smudge.mode, 'smudge.mode', Object.keys(SMUDGE_MODES) as (keyof typeof SMUDGE_MODES)[])];
    if (smudge.radius !== undefined) properties.SmudgeRadiusValue = number(smudge.radius, 'smudge.radius', 0, 300);
  }
  if (s.bristle !== undefined) throw new Error('bristle settings are not available yet: no bristle base preset has a checked vocabulary.');

  const tip = tipChange(s);
  return { base_preset: base.preset, engine, properties, ...(tip ? { tip } : {}) };
}
