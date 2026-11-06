# Layers and Brushes as tabs in the agent panel

Status: BUILT and installed locally 2026-11-06; the artist approved the look and said it works. Not published. Open items: top of tasks.md.
Mockup: https://claude.ai/artifact/AMuvZMrp2dVKUe7eBJTZSd (boards "Layers tab" and "Brushes tab")

Comes after `panel-redesign`, which provides the look, the status line and the "Waiting for you" line.

Stroke previews are included because the approved board shows them. That reading is Claude's; the artist can take them out
(see "If previews are left out").

## Why

The artist (2026-11-05): "even layers and brushes look kinda ugly … how feasible would it be if we had those inside our
agent panel but separate tab."

What is there today:

- **The look of both panels is Krita's.** Krita-Revamp changed behaviour (folder groups, clipping, brush tweaks that
  survive a restart). Toska's themes only recolour. Nobody has redesigned how these panels look.
- **Layers** is about 6,300 lines of C++ (`plugins/dockers/layerdocker`) with custom-drawn rows, plus our Revamp port.
- **Brushes** is a thin dock (`PresetDockerDock`, about 200 lines) around `KisPaintOpPresetsChooserPopup`.
- **The panel** already has tabs (Chat, Plan, Folder).

## The design

### Real panels, moved in and restyled

The tabs show Krita's real Layers and Brushes widgets, not copies rebuilt in Python. A rebuild would have to redo drag to
reorder, groups, masks, multi-select, renaming and more, through a slower scripting path that could lag while the agent
paints. Restyling in the fork's C++ keeps all of that, and improves these panels wherever they are shown.

So there are two separate jobs:

1. **Where they live:** the panel takes the widget from Krita's dock and shows it in its tab.
2. **How they look:** the fork's C++ changes the drawing and layout.

### One widget, one place

A widget can only be in one place, so:

- **New installs:** Layers and Brushes open in the tabs, and their separate docks start hidden.
- **Existing layouts are never moved by an update.** If the Layers dock is showing, the Layers tab shows one line, "Layers
  is open as its own panel", and a **Move it here** button. Moving hides the dock.
- **The Window menu still works.** Showing the Layers dock from Window > Dockers sends the widget back to the dock, and the
  tab shows that line again. Someone who wants chat and Layers side by side can have that.
- **Brushes follows the same rules.**

### Tabs

Chat, Plan, Folder, Layers, Brushes, in one row at the top of the panel, above each tab's own contents. The header
(Toska · painting, new chat, history, …) belongs to Chat. With these tabs the bar is always visible, replacing the
`panel-redesign` rule that hides it when only Chat is there, and that bar costs about 32 pt.

### On every tab

The status line stays at the bottom, with Auto-approve. "Waiting for you" also stays visible, and Show returns to Chat at
the card. Choosing a brush can never hide a question from the agent.

### Layers

| Now | After |
|---|---|
| Blend mode, filter, opacity and settings across two rows | One row: blend mode, opacity slider, percent, filter, … |
| Row actions in a row of mixed Krita icons | The same seven (add, duplicate, clip, down, up, properties, delete) as matching icons; delete set apart |
| Row badges for several properties at all times | Eye always; lock and other badges only while they are on; hidden layers dimmed with a closed eye |
| Blending info | Second line, "Multiply · 60%", only when not normal. Built on the existing Blending Info Style setting if it can do this |

Kept: folder rows, clipped layers (indented with an arrow), Alt-click between layers, every right-click menu, masks, thumbnail
size and indentation settings (in …).

### Brushes

| Now | After |
|---|---|
| Tag dropdown | Search, then tag chips; adding, renaming and removing tags, and icon size, in … |
| Thumbnails or details | Strokes, thumbnails or details |
| Hand-made thumbnails of uneven style | Stroke view: each brush painting the same stroke, in a two-column grid, selected brush outlined in ember |

Kept: favourites and tags behave as before, brush tweaks survive a restart, and the toolbar's brush popup keeps working.

Other kinds of chooser (patterns, gradients) share the tag widgets. The chips belong to the brush chooser only, so those stay
as they are.

### Stroke previews

Port Revamp's final form (survey: `krita-fork/revamp-survey.md`, feature 3, estimated at 12 agent-hours, medium risk), which
closes that part of `krita-fork` task 3.1.

- Painted on a throw-away surface: no image stroke, no change to `libs/image`.
- Generated only when idle and paused while the agent paints, so previews never compete with a paint pass.
- The cache lives in Toska's own folder, never stock Krita's.
- Previews must read on both Toska Night and Toska Day (task 4.4).

## Measures

- With either tab open, at panel sizes 300 x 500, 360 x 687 and 420 x 1000: every control lies inside the panel, the tab
  names are not shortened, and the status line is visible.
- "Waiting for you" shows on all five tabs while a card waits.
- Layers in the tab does what the dock does, checked live: select, reorder by drag, group, clip, mask, rename, blend, opacity,
  right-click. Both follow a change of document.
- Moving each panel in and out, switching workspace and quitting cause no crash, and restarting keeps the choice.
- An agent paint pass is not slower with previews being generated: `AgentStrokeJobsBenchmark` idle against generating.
- `TestNodeDelegate` and `TestNodeView` still pass, and no agent or chat test changes behaviour.

## Non-goals

- **No rebuild in Python**, and no behaviour removed from either panel.
- **Colour, Tool Options, Overview and History stay as they are.** They could follow later.
- **Revamp's Python plugins (`krita-fork` task 3.2)** stay separate. `krita-redesign` is read for ideas only.
- **Nothing over the canvas.**
- **Nothing the agent does changes.**

## If previews are left out

The tab still works, using Krita's existing thumbnails in the new layout, and the risk and benchmark items go away. Previews
could come later without redoing the tab.

## Open questions

1. **Can the widgets move safely?** Answered by task 1. If moving them proves unsafe, the fallback is to dock Krita's panels
   as tabs in the same dock area as the panel, styled the same. That gives the same look but is less "inside" the panel.
2. **Should other users' restored workspaces offer Move it here once?** Default: no prompt, only the line in the tab.

## Compatibility

Panel: `creative_docker.py`, `panel_theme.py`. Fork C++: `plugins/dockers/layerdocker`, `plugins/dockers/presetdocker`,
`libs/ui/widgets` (brush chooser and previews), default workspace. No change to the `.kra` format, the companion or the
protocol. Ships in one install, with one restart, after the current painting is finished.
