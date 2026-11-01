# Paint engine (index)

Status: split on 2026-11-01 at the artist's request into four proposals. This file only points to them.

| Change | What | Depends on |
|---|---|---|
| [`colour-mixing`](../colour-mixing/proposal.md) | MyPaint spectral, a shared mixing module, Color Smudge mixing models, Mixbox, `mix_colors` | — |
| [`brush-carries-paint`](../brush-carries-paint/proposal.md) | Paint memory, dirty brush, per-bristle paint in Hairy | colour-mixing |
| [`wet-paint`](../wet-paint/proposal.md) | Wet stroke buffer and whole-stroke passes, then a CPU fluid simulation with agent controls | colour-mixing |
| [`live-effects`](../live-effects/proposal.md) | C++ generators (focus lines, speed lines, light rays), cached per zoom, one undo step | — (links to `custom-effects`) |

Design basis: the 2026-11-01 studies in `local-notes/` (`clip-studio-study/`, `realistic-paint-study/`,
`pigment-study/`, `rebelle-study/`). Each change has its own A/B measurement before its larger parts.
