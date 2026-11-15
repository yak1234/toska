# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""Build the brushwork style model (openspec painting-skills goal 5): the first four feature levels of VGG19 (ImageNet
weights, timm's vgg19.tv_in1k from the Hugging Face Hub) as one ONNX graph that takes a luminance tile and gives each
level's Gram matrix, the texture statistics the style distance compares (src/style-distance.ts). The graph replicates
the luminance to three channels and normalises it, so a caller sends plain 0..1 lightness.

    uv run --with torch --with timm --with onnx --with onnxruntime --with onnxscript python scripts/build-style-model.py OUT_DIR

Writes OUT_DIR/vgg19_style.onnx and OUT_DIR/build.json (sizes, the largest difference from PyTorch on a test tile).
Development only: nothing in the app runs this."""
import hashlib
import json
import pathlib
import sys

import numpy as np
import onnxruntime
import timm
import torch

TILE, LEVELS = 512, 4
GRAPH = 'vgg19_style.onnx'


class StyleStatistics(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.features = timm.create_model('vgg19.tv_in1k', pretrained=True, features_only=True, out_indices=tuple(range(LEVELS)))
        self.register_buffer('mean', torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer('std', torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))

    def forward(self, luminance):
        x = (luminance.expand(-1, 3, -1, -1) - self.mean) / self.std
        grams = []
        for feature in self.features(x):
            flat = feature.flatten(2)                                   # 1 x C x N
            grams.append((flat @ flat.transpose(1, 2) / flat.shape[2]).squeeze(0))
        return tuple(grams)


def main(out_dir):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    model = StyleStatistics().eval()
    tile = torch.rand(1, 1, TILE, TILE, generator=torch.Generator().manual_seed(7))
    path = out / GRAPH
    torch.onnx.export(model, (tile,), str(path), input_names=['luminance'], output_names=['gram%d' % (i + 1) for i in range(LEVELS)],
                      opset_version=17, dynamo=False)
    with torch.no_grad():
        expected = [g.numpy() for g in model(tile)]
    session = onnxruntime.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    got = session.run(None, {'luminance': tile.numpy()})
    worst = max(float(np.abs(a - b).max() / (np.abs(a).max() + 1e-12)) for a, b in zip(expected, got))
    if worst > 1e-3:
        raise SystemExit('the ONNX graph differs from PyTorch by %.2g of the largest value' % worst)
    data = path.read_bytes()
    report = {'graph': GRAPH, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'tile': TILE,
              'outputs': [list(g.shape) for g in got], 'largest_relative_difference_from_pytorch': worst, 'source': 'timm/vgg19.tv_in1k'}
    (out / 'build.json').write_text(json.dumps(report, indent=1) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main(sys.argv[1])
