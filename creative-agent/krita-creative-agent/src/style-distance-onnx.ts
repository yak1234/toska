// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The style model on ONNX Runtime's Node package (style-distance.ts; built by scripts/build-style-model.py): one graph,
// luminance [1,1,512,512] in 0..1 -> gram1..gram4. For study scripts and their tests only: the companion never imports
// this file, so it never loads the native binding in its own process (as with the sharpening worker, upscale/onnx.ts).
import { join } from 'node:path';
import ort from 'onnxruntime-node';
import { LEVELS, TILE, type StyleSession } from './style-distance.ts';

export const STYLE_GRAPH = 'vgg19_style.onnx';

export async function onnxStyleSession(modelDir: string): Promise<StyleSession> {
  const session = await ort.InferenceSession.create(join(modelDir, STYLE_GRAPH), { executionProviders: ['cpu'] });
  const input = session.inputNames[0] ?? 'luminance';
  return {
    async grams(luminance: Float32Array) {
      const out = await session.run({ [input]: new ort.Tensor('float32', luminance, [1, 1, TILE, TILE]) });
      return Array.from({ length: LEVELS }, (_, level) => {
        const gram = out[session.outputNames[level] ?? `gram${level + 1}`];
        if (!gram) throw new Error('The style model gave no statistics.');
        return Float32Array.from(gram.data as Float32Array);
      });
    },
  };
}
