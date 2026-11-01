# Benchmark scenes for the paint-engine changes

Written 2026-11-01 (Claude's design; the user: "We trust you … come up with your own"). Used by the A/B gates of
`colour-mixing`, `brush-carries-paint`, `wet-paint` and `custom-effects` Part 2 (live effects). New Moscow and the
artist's own paintings are never benchmark scenes.

## Rules for every A/B

- **Canvas** 6000×4500, a new test document per run (copies only).
- **Fixed goal:** each scene has one goal image, generated once and stored with the scene, plus its prompt text. Every
  run of every arm paints toward the same goal with the same prompt, planner model and painter model, so the only
  difference is the feature under test.
- **Runs:** 3 with the feature (B) and 3 without (A) per scene. A result counts only if it holds across the runs.
- **Judging:** blind pairs in random left/right order — Luna (decision client, labelled as runtime A/B) and the user.
  A feature passes a scene when B wins at least 2 of 3 pairs for both judges.
- **Measurements** (recorded per run, compared A vs B):
  - **Muddiness:** in regions where two colours meet, the drop in saturation (HSV S) of the blend against the mean of
    the two colours on either side. Lower is better.
  - **Stroke count** and **painting time** to reach the painter's own "done".
  - **Repetition:** mean similarity between pairs of strokes in the same pass (stroke shape and colour); lower means
    more varied marks.
  - **Observe time** (live effects and wet paint): the slowest observe in the run.
- Results go in `local-notes/benchmarks/<change>/<date>.md` with the six images per scene.

## The scenes

| # | Scene | What it should show | Used by |
|---|---|---|---|
| 1 | **Still life:** lemons and a cobalt-blue bowl on a white cloth, two red apples, a copper jug, window light from the left | Colour joins: blue against yellow, red against green shadows, warm metal reflections; glazes on the cloth | colour-mixing, brush-carries-paint |
| 2 | **Misty lake at dawn:** pine shoreline fading into mist, a rowing boat, pink-gold sky reflected in still water | Soft gradients, atmosphere over a whole area, glazing, distance fading | wet-paint, colour-mixing |
| 3 | **Watercolour village:** a hillside village under a rain-heavy sky, washes for sky and hills, wet roads | Washes, darkened edges, granulation on paper, lifted highlights, blooms | wet-paint |
| 4 | **Oil portrait:** an old fisherman in a yellow oilskin, weathered face, grey stubble, warm side light | Skin blending, colour carried across the form, varied strokes in fabric and stubble | brush-carries-paint, colour-mixing |
| 5 | **Autumn forest floor:** birch trunks, red and orange leaves, moss, a stream catching light | Many small varied marks (leaves, bark), repetition, complementary greens and reds | brush-carries-paint |
| 6 | **Night market:** lanterns, steam from food stalls, wet cobblestones reflecting light, a crowd in silhouette | Glow and light rays, steam and haze, reflections | custom-effects Part 2, wet-paint |
| 7 | **Comic-style chase:** a cyclist racing toward the viewer down a narrow street | Focus lines around the subject, speed lines | custom-effects Part 2 |

Each change runs only the scenes listed for it. The first gate of each change runs its first listed scene; later
gates run all of its scenes.

## Setting up (once, before the first gate)

1. Generate the seven goal images with the image tool the agent already uses for references, at 6000×4500 or the
   nearest supported size, with the scene text above as the prompt; review them once with the user and keep them.
2. Store them with their prompts in `creative-agent/krita-creative-agent/tests/benchmark-scenes/` (`NN-name.png`,
   `NN-name.txt`), tracked in git.
3. A small runner script repeats a scene N times per arm through the MCP test tools and writes the measurements; it
   never opens the artist's documents.
