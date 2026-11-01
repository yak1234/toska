# Comic page: panels, tones, effect lines and lettering, for the agent and the artist

Status: rewritten 2026-11-01 for the user's review (the user: "Why not just put everything into the existing comics
change and rewrite it. Not even sure if our original comics spec was even good"). Nothing is built. Replaces the
2026-10 version: its page structure, panel model and lettering stay; its stock-Krita 5.3.3 / PyQt5 assumptions, its
rectangle-only panels and its missing tones and effect lines are fixed with what the Clip Studio study confirmed.
`design.md`, `specs/` and `tasks.md` are from the old version and are redone after this is approved.

## Why

People want comic pages from the agent: a page of panels, a short story told across them, tones, effect lines, and
captions or speech balloons. Today the agent sees one undivided canvas. It cannot keep paint inside a panel border, tell
panel 3 from panel 4, put a tone on a shadow, or letter text. Someone with no comics background also does not know how
to lay out a page or pace a story.

Krita's bundled **Comics Project Management Tools** manages pages, metadata, translation and export, but has no tools for
making a page: no panel cutting, no tones, no effect lines, no balloons. **Clip Studio Paint**, the comics standard, was
studied on 2026-11-01 (`local-notes/clip-studio-study/README.md`, Comic features); confirmed in its code:
- **Panels** are vector frames. One cutting routine serves both the interactive tool (cut along a drawn line) and the
  menu (divide into a grid): split the frame along a line, build the two pieces with a gutter between them.
- **Screentones** are a few numbers (lines per inch 5–85, angle, dot shape, grey level). Each dot's radius is
  binary-searched until exactly the right number of pixels is inked, so every grey level is exact; a cached pattern per
  zoom level keeps tones fast.
- **Effect lines** are generated from settings and a stored seed, spaced evenly with the last gap stretched to close.
- **Balloons** are vector shapes with fill and outline (the tail code was not found; ours is our own design).

## What changes

Built on Krita's own pieces (groups, transparency masks, vector layers, fill-layer generators) in Toska's plugin, using
`qt_compat` (Qt6 fork, Qt5 tests).

1. **Page structure** (kept from the old version):
   ```
   Comic page            (group)
   ├─ Lettering          (group)     ← "text · …" vector layers
   ├─ Panel borders      (vector layer, locked) frames drawn as strokes
   ├─ Panel 1 … Panel n  (groups)    each clipped by a "Panel shape" transparency mask
   └─ Page               (fill layer) page colour behind the gutters
   ```
   Masks clip each panel's art, borders sit on top, so art never covers a border. Built as one reversible pass.
2. **Panels that are shapes, not just rectangles.**
   - **Divide into a grid:** rows of column weights (the old layout format), gutters, margin, border width, presets.
   - **Cut along a line:** cut one panel, or every panel a line crosses, along a straight line (slants allowed) with the
     gutter between the pieces. The artist draws the line with the stylus; the agent gives two points.
   - One shared, unit-tested geometry routine for both (pure Python, no Krita): split a polygon by a line, inset each
     piece by half the gutter, recompute reading order. Mask, border and group follow the new shapes.
   - **Panel model** (kept): `P1…Pn` in reading order (left-to-right; right-to-left option for manga), bounds and shape,
     group ids, returned in every observation and shared by the agent, the plan and the review.
3. **Panel scoping** (kept): `paint_pass`, `create_layer`, `fill_region`, `apply_filter` take `panel: "P3"`; new layers
   go inside that panel's group and are clipped to it.
4. **Screentones.** A tone is a fill layer using Krita's existing `screentone` generator inside a panel (or a selection),
   set from tone numbers (lines per inch, angle, dot shape, grey level). First compare Krita's grey levels on a ramp with
   the exact-coverage method; only if they are off, add an exact-coverage option to the generator
   (`plugins/generators/screentone/`, C++).
5. **Effect lines** — the focus-line and speed-line generators from `custom-effects` Part 2 (live effects), placed in a
   panel. No second implementation.
6. **Lettering** (kept, improved): captions, speech, thought and shout balloons as editable vector shapes on layers named
   `text · <kind> <panel>` (found by Krita's comics tools for translation), with a **tail that points at a speaker**: a
   curved wedge from the balloon edge toward a given point. Line breaking measured with Qt font metrics, so text never
   depends on Krita's wrapping.
7. **Agent operations:** `comic_page`, `comic_cut`, `comic_tone`, `comic_effect`, `letter` — each one reversible pass,
   each with a measured catalog card before the painter may use it.
8. **A docker for the artist:** the same operations by hand — pick a layout, cut panels with the stylus, add a tone or a
   balloon. Nothing drawn over the canvas (Toska's rule).
9. **Comic in the chat** (kept): a Comic setting that works in every mode, a layout picker, a `▦ Comic · N panels` chip;
   with Comic on, plans carry a story (logline, and per panel the beat, shot, characters, caption); steps go panel by
   panel, lettering last; the review checks each panel against its beat and the page's reading flow.

## Relationship to other changes
- `custom-effects` Part 2 provides the effect-line generators.
- Comics Project Management Tools stays; pages made here work with its export and translation.

## Non-goals
- Multi-page projects and project management (Krita's comics tools do that); adopting panels made by other plugins.
- Rulers and perspective guides (dropped earlier: Toska is agentic painting).
- Photo-to-line-art conversion (Clip Studio's LT conversion; its method could not be read).
- Automatic colouring; image generation.

## Anti-goals
- Art that covers a panel border, or a border that moves when a panel's art is edited.
- A tone whose grey level is more than one step from what was asked.
- Comic operations that slow observes on a full page.
- An operation the painter can use before it has a measured catalog card.

## Constraints
- Fork-first (Qt6 via `qt_compat`, tests under both); C++ only if the screentone comparison shows it is needed.
- Tests on copies via the MCP test tools at full page size; never the artist's documents.
- A/B: benchmark scene 7 (the cyclist chase) as a one-page comic, made with and without these tools, 3 runs each;
  blind Luna and the user judge layout clarity, borders and lettering (`../../benchmark-scenes.md`).

## Done when
1. A 3×2 grid with gutters, then one slanted cut, gives correct panels with even gutters, in reading order, live.
2. Art painted in a panel never crosses its border, including slanted ones.
3. A tone ramp matches the asked grey levels to within one step.
4. A speech balloon with a tail pointing at a character, and a caption, are editable and found by Krita's comics tools.
5. The agent makes a one-page comic of the chase scene from a story; the A/B is run and reviewed.

## Questions for the user
1. The docker for you (stylus panel cutting, tones, balloons by hand): build it with the agent operations, or later?
2. Manga reading order (right to left) from the start, or later?
