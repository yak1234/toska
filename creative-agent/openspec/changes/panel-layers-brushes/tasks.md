# Tasks: Layers and Brushes tabs

Starts after `panel-redesign` lands. Panel tests run with `uv run -q --with pyqt5 python tests/<file>` and again under PyQt6.
C++ builds only via `agent/build-macos.sh`, C++ tests only via `agent/run-tests.sh`. Write each test first and see it fail.

Land every task, then install once and ask for one restart. Never install while Toska is running. Live steps use a copy of a
painting, only with no painting running.

## 1. Prove the widgets can move (before anything else)

A throwaway test on a copy. Record the answers here before building on them.

Live on 2026-11-05, in the installed Toska, on a copy of istanbul.kra, driving the real window with synthetic clicks:
- Works: Move it here moved the real Layers widget into the tab; the Layers dock left the window; Duplicate layer, selecting a
  row and the off-badge hover worked from the tab, and thumbnails drew for the new layer. The hidden Brushes dock opened straight
  in its tab, and clicking a brush changed the current brush. Cmd+Q with both in tabs quit with no crash report. After a relaunch
  the dock stayed hidden and the tab layout came back.
- Not confirmed: the eye button did not toggle under synthetic clicks (cause unknown, maybe only the clicks); right-click menu
  (the tool's foreground click closes menus); Window > Dockers sending a widget back; workspace switch; two windows.
- Found: a stray tick mark over the eye on the top row; Brushes' tag row clips (the Tag button overlaps its arrow) until task 5.

- [x] 1.1 Take `KisLayerBox`'s and `PresetDocker`'s widgets from their docks into a panel tab, and back. Find the safe way
      to do it (`QDockWidget.setWidget`, reparenting, or a small fork hook).
- [ ] 1.2 With the dock hidden: does it still get `setCanvas` on a document change? Do its right-click menus and shortcuts
      work? Does anything in `LayerBox` skip work while hidden?
- [ ] 1.3 Does `restoreState` (workspace switch, restart, canvas-only mode) put anything back, or lose the widget?
- [ ] 1.4 Quit with the widget in the tab: no double delete or crash on exit. The same with two windows open.
- [ ] 1.5 Decide: moved widgets, or the docked-tabs fallback. If the fallback, update the proposal and tell the artist.

## 2. The tabs in the panel

- [x] 2.1 New `tests/ui_panel_tabs.py`, with fake docks: all of the proposal's panel measures at the three sizes; the "open
      as its own panel" line and Move it here; the status and "Waiting for you" lines on all five tabs. Add it to the "panel
      UI scripts" group in `agent/ci.sh`, under PyQt5 and PyQt6.
- [x] 2.2 Tab bar at the top with five tabs, always visible; header on Chat only. Replaces `panel-redesign` 4.2's hiding rule.
- [x] 2.3 One widget, one place: dock visibility decides, in both directions; each window uses its own docks.
- [x] 2.4 Status line and "Waiting for you" below every tab; Show returns to Chat at the card.
- [ ] 2.5 Default workspace (`agent/make_agent_workspace.py`, `Photoshop_Agent.kws`): separate Layers and Brushes docks
      hidden. Existing layouts untouched; update `test_new_install_defaults.py`.

## 3. Layers restyle (fork C++)

- [x] 3.1 `WdgLayerBox.ui`: one top row (blend mode, opacity, percent, filter, …), one bottom row of the seven actions.
      Works at the panel's narrowest width.
- [x] 3.2 New icon set in the panel's style, `dark_` and `light_` SVGs per the `krita/pics/layerbox` convention.
- [x] 3.3 `NodeDelegate`: row spacing, rounded thumbnails and selection, quieter colours from the palette. Folder rows and
      clip indent redrawn to match. Extend `TestNodeDelegate` for row layout and hit areas.
- [x] 3.4 Badges only while on; dimmed hidden layers. Every property stays reachable (hover or menu, decided live).
- [x] 3.5 Second line for non-normal blending and opacity, through the existing Blending Info Style if it can do this.
- [ ] 3.6 Check it in the plain Layers dock too, and under Toska Night, Toska Day, Krita dark and light.
- [x] 3.7 List every upstream file edited in `AGENT-FORK.md`, as for the Revamp port.

## 4. Stroke previews

- [ ] 4.1 Port the final form from `revamp-5.2.14` per `krita-fork/revamp-survey.md`, feature 3 (commits there; redo the
      `KisResourceModel` and `KisTagResourceModel` parts by hand). Keep SPDX lines; record it in `AGENT-FORK.md`.
- [ ] 4.2 Generate only when idle; pause while `Document.agentActive()`.
- [ ] 4.3 Cache path through `KisAppIdentity`; `agent/check-identity.sh` passes.
- [ ] 4.4 Make previews read on both Toska themes (paint in a neutral colour and tint, or keep one set per theme). Decide
      from a real picture.
- [ ] 4.5 New `TestBrushStrokePreviewCache` in `libs/ui/tests`, listed in `agent/ci-tests.txt`: reuse, invalidation on a
      preset change, nothing written outside the cache folder. It cleans up after itself.
- [ ] 4.6 `AgentStrokeJobsBenchmark`, idle against generating. Record both numbers here.
- [ ] 4.7 Tick the stroke previews part of `krita-fork` task 3.1.

## 5. Brushes restyle (fork C++)

- [ ] 5.1 `KisPaintOpPresetsChooserPopup`: search, tag chips, view switch; tag management and icon size in ….
- [ ] 5.2 Chips only in the brush chooser. Pattern and gradient choosers are unchanged (test it).
- [ ] 5.3 Two-column stroke grid, selected brush in ember; thumbnails and details restyled to match.
- [ ] 5.4 The toolbar's brush popup still works and fits. Brush tweaks still survive a restart, with the agent gate unchanged.

## 6. Check it

- [ ] 6.1 Panel scripts, `agent/run-tests.sh` (`TestNodeDelegate`, `TestNodeView`, the new test) and `agent/ci.sh` all pass.
- [ ] 6.2 Live in Toska, on a copy, after the artist has finished the current painting: the full list in the proposal's
      Measures, plus one short agent chat while on the Layers tab. State exactly what was run.
- [ ] 6.3 Pictures of both tabs next to the mockup, sent to the artist.
- [ ] 6.4 The artist approves the look against the mockup.
