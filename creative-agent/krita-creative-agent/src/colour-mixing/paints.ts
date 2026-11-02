// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The tube paints a transfer's paint set is chosen from (colour-mixing task 7d). The thirteen pigments and their sRGB
// values are the ones Mixbox publishes in its README's "Pigment Colors" table (github.com/scrtwpns/mixbox, commit
// a1bdb75a668f638ba066aa74bfd32809ed7fef45, README.md lines 28-43, the "RGB" column), the colours its pigment model
// treats as those paints. Mixbox lists no white or black; Titanium White (#ffffff) and Ivory Black (a slightly warm
// near-black, #191716) are ours. Names are what the user and the agent see.
import type { Rgb } from './mix.ts';

export type Paint = { name: string; rgb: Rgb };

const paint = (name: string, r: number, g: number, b: number): Paint => ({ name, rgb: [r / 255, g / 255, b / 255] });

export const TITANIUM_WHITE = 'Titanium White';

export const PAINT_LIBRARY: readonly Paint[] = Object.freeze([
  paint('Cadmium Yellow', 254, 236, 0),
  paint('Hansa Yellow', 252, 211, 0),
  paint('Cadmium Orange', 255, 105, 0),
  paint('Cadmium Red', 255, 39, 2),
  paint('Quinacridone Magenta', 128, 2, 46),
  paint('Cobalt Violet', 78, 0, 66),
  paint('Ultramarine Blue', 25, 0, 89),
  paint('Cobalt Blue', 0, 33, 133),
  paint('Phthalo Blue', 13, 27, 68),
  paint('Phthalo Green', 0, 60, 50),
  paint('Permanent Green', 7, 109, 22),
  paint('Sap Green', 107, 148, 4),
  paint('Burnt Sienna', 123, 72, 0),
  paint(TITANIUM_WHITE, 255, 255, 255),
  paint('Ivory Black', 25, 23, 22),
]);

export const PAINT_NAMES: readonly string[] = PAINT_LIBRARY.map(p => p.name);

/** The library paint of this name (case and spacing as listed), or null. */
export function paintByName(name: string): Paint | null {
  return PAINT_LIBRARY.find(p => p.name === name) ?? null;
}
