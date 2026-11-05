# Tasks: agent panel redesign

Panel code is in `krita-mcp/krita-plugin/kritamcp/`. Panel tests are in `krita-creative-agent/tests/ui_*.py`, run with
`uv run -q --with pyqt5 python tests/<file>` and again under PyQt6, offscreen, no live model. Write each test first and
see it fail.

Land every task, then install once and ask for one restart. Never install while Toska is running: check first.

Built 2026-11-05, offscreen only: nothing installed, nothing run in Toska yet. Open: 1.1-1.3, 6.3's live cause, 6.4's
live check, 8.2-8.4.

## 1. Find out about the black band and the clipping

- [ ] 1.1 Ask the artist whether the band shows on screen.
- [ ] 1.2 If it does, on a test document with no painting running: record the window, panel and Send button sizes across
      windowed, maximised and full screen, and across a switch between them. Name the cause. Record it here before
      changing anything.
- [ ] 1.3 Check live where Toska's default layout puts Layers (the script puts it in the column beside the panel). Settle
      open question 2.

## 2. A test that measures the panel

- [x] 2.1 New `tests/ui_panel_layout.py`: builds the panel at 300 x 500, 360 x 687 and 420 x 1000 and asserts every line
      of the proposal's Measures. It fails today.
- [x] 2.2 Add it to the "panel UI scripts" group in `agent/ci.sh`.

## 3. The chat following

- [x] 3.1 Sending a message jumps to the newest message.
- [x] 3.2 "Waiting for you" line above the message box for every card that needs an answer; Show jumps to it; it goes
      when the card is answered, closed or replaced.
- [x] 3.3 "Latest" floats over the chat, takes no row, and counts new messages.
- [x] 3.4 Scrolled-up history stays held while painting progress arrives (test it).

## 4. Header and status

- [x] 4.1 Painting target joins the header; Return to painting stays.
- [x] 4.2 Tab bar hidden while Chat is the only tab; tab names never shortened (the "C…" fault).
- [x] 4.3 Status line above the message box: one line, cut with "…", full text in the tooltip, with the dot, the elapsed
      time, Screen awake, Retry and Auto-approve.
- [x] 4.4 Footer into the header's … menu. A failed save shows as a status line (no new code: the panel has no save-failed event, and the companion's errors
      already reach the status line).

## 5. The control row

- [x] 5.1 Canvas chip with the hint as its tooltip; a capture error still shows as a line.
- [x] 5.2 Attachments chip, "4 attached", opening a list with thumbnails and remove buttons.
- [x] 5.3 Model chip opening a provider and model picker. Existing provider and model selectors keep working behind it.
- [x] 5.4 Paint only here and Find it for me in the + menu; the Paint only here bar shows while its area is active.
- [x] 5.5 Protected section hidden while nothing is protected, otherwise one collapsed line; the shield opens it.
- [x] 5.6 Message box starts at 2 lines and grows to 120 pt.
- [x] 5.7 Chips shorten at narrow widths; the row never passes the panel's edge.

## 6. Cards and overflow

- [x] 6.1 Card pictures scale to fit the chat, so the buttons are reachable.
- [x] 6.2 Reference card caption: never cuts the artist's words mid-word.
- [x] 6.3 Below the height where the message box, control row and minimum chat fit, the panel scrolls as a whole (done:
      `body_scroll`, and the dock's minimum height drops from 440 to 300). Still to confirm live: the cause found in task 1.
- [ ] 6.4 Light, dark and Toska themes all checked, plus the largest text size in Settings. (Offscreen: Toska Night and Day
      pictures looked at; largest text measured by test. Dark, Light and the real window remain.)

## 7. The look

- [x] 7.1 Text sizes, spacing and corners from "The look" as named values in `panel_theme.py`; the stylesheet uses only
      those. A test in `ui_panel_layout.py` fails on any other size or radius in the stylesheet.
- [x] 7.2 One set of drawn SVG icons in that style, tinted from the theme at run time and redrawn on a theme change. Replace
      every text-character and emoji icon. Every icon-only button keeps its accessible name and a tooltip.
- [x] 7.3 Dividers use the quiet colour; remove borders that separate nothing. Ember only where "The look" lists it.
- [x] 7.4 `test_toska_theme.py` still passes.

## 8. Check it

- [x] 8.1 `ui_panel_layout.py`, `ui_smoke.py`, `ui_panel_features.py` and `ui_panel_no_document.py` pass under PyQt5 and
      PyQt6. Existing tests that name moved controls are updated; no accessible name is dropped.
- [ ] 8.2 Before and after pictures of the panel at the same size, sent to the artist.
- [ ] 8.3 Live in Toska, on a copy, after the artist has finished the current painting: one short agent chat with a move,
      a reference card and a small window. State exactly what was run.
- [ ] 8.4 The artist approves the look against the mockup.
