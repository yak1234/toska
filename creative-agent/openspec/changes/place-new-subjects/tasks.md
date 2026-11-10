# Tasks: place new subjects

Tests first, seen failing. From `krita-creative-agent`: `npm run -s test:unit`, `npm run -s typecheck`,
`uv run -q --with pyqt5 python tests/ui_panel_paint_only_here.py` (and `--with pyqt6`).

- [x] 1. `reference-tool.mjs` `transferRefusal(..., {newAsset})` and `start()`: tests in `tests/reference.test.mjs`
      (the rule, and through the tool: placed once, refused the second time).
- [x] 2. `open-routes.ts` `assetTransfer` and the late-plan wording; `studio.mjs openRoutes`. Tests: `tests/open-routes.test.mjs`.
- [x] 3. `studio.mjs` part note: not for something to add. Wording only; no test of the painter's behaviour.
- [x] 4. `paint_only_panel.py`: a late outline waits and is selected when the move closes. Tests in
      `tests/ui_panel_paint_only_here.py`, under PyQt5 and PyQt6.
- [ ] 5. Live in Toska on a copy: after a finished plan, "add two ships" makes the images and paints them in without a
      selection card; "paint only the sea" shows the outline as marching ants. Not done.
