# Canvas reference viewer: tasks

Spec: `proposal.md` in this folder. Companion code is strict TypeScript; the panel is Python through `qt_compat`.

- [x] 1. Fine pass (A): `MASK_RULES.fine` (ΔE 6); `differenceMask` reruns at it when the normal pass finds nothing and
      reports `fine: true`; the record keeps `fine`; card text. Test: a faint change found only by the fine pass; a clear
      change unchanged; the real pair is not in the repository (the artist's painting).
- [x] 2. Answers with a mark and words (B, decisions): `answer({id, action, area?, text?})`. `area` is a polygon in 0–1
      canvas coordinates; Use and Use as the new goal take it; with no area and no mark Use explains how to mark one;
      `retry` with `text` edits the reference; with `area` the comparison is limited to it. `canvas.png` kept. Tests with
      the fake host.
- [x] 3. Typed answers (C): while a card is ready, the studio routes the message (yes / no / an edit) before anything else.
      Tests.
- [x] 4. The viewer (D): `canvas_reference_viewer.py` (zoom, pan, Before / after, Mark box and freehand, Describe edits,
      the answers); the card's picture opens it; the event carries `reference_path`, `canvas_path`, `mask_path`. Panel
      UI test and a geometry test (view to 0–1 polygon) under PyQt5 and PyQt6.
- [ ] 5. Install, one restart, a live check on a copy: a fine change is found, the viewer opens, a mark and an edit work.
