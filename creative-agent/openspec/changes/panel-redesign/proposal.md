# Agent panel redesign: the chat comes first

Status: BUILT and installed locally 2026-11-06; the artist approved the look and said it works. Not published. Open items: tasks.md.
Mockup: https://claude.ai/artifact/AMuvZMrp2dVKUe7eBJTZSd

Layout decisions below are Claude's calls, explained to the artist, who directs Toska but is not a painter. They may be
overruled. The Layers and Brushes tabs are a separate change, `panel-layers-brushes`, built after this one.

## Why

The artist (2026-11-05): "the UI for agent panel feels buggy … it's cluttered looking and full screen due to sizing
hides sometimes latest agent action."

Measured on the live panel during the `istanbul.kra` session (window 1510 x 1037 pt, panel about 687 pt tall, heights
estimated from the capture and the accessibility tree):

| Area | Height | Share |
|---|---|---|
| Header, painting target, status line, tab bar | ~138 pt | 20% |
| **Chat** | **~150 pt** | **22%** |
| "Latest" button, empty "Protected" section | ~87 pt | 13% |
| Message box and its controls | ~313 pt | 46% |

The problems, worst first:

1. **The chat is the smallest part of the panel.** One reference card nearly fills it.
2. **The latest action gets hidden.** Scrolling more than 30 pt up stops the chat following new messages
   (`track_scroll`), and it stays that way until "Latest" is pressed, even when the agent is waiting on the artist.
   A question can sit out of view with only a status line to say so.
3. **The bottom of the panel is cut off.** The row with Send, the mode and AI images runs about 12 pt past the visible
   edge, and the footer row below it was not visible at all. A black band about 88 pt tall sits below the panel. The band
   may be an artefact of the capture: the cause is not known (task 1).
4. **Controls that are idle still take a row:**
   - "Protected" with nothing protected;
   - the canvas chip plus its hint line;
   - a row of attachment thumbnails (about 70 pt for four);
   - Paint only here / Find it for me;
   - the provider and model pickers.
5. **Small faults:**
   - the "Chat" tab shows as "C…";
   - the "Latest" button takes a row of its own, shrinking the chat as it appears;
   - a reference card's caption pastes the artist's whole sentence and cuts it mid-word;
   - the status line wraps with long messages, moving everything below it.

Each feature added its own permanent row, so the chat shrank a little every time. This change fixes that rule, not just
today's rows.

## The design

**One rule: a control takes a row only while it is in use.** Everything else is a chip in the one control row, or a menu.

At rest (no card waiting):

```
┌ Toska · istanbul.kra       + ◷ … ┐  header: the target joins it
│                                  │
│  chat                            │  everything that is left
│  (at least 60% of the panel)     │
│                                  │
│           ↓ 2 new                │  floats over the chat, takes no row
├──────────────────────────────────┤
│ ● Painting stroke 36 of 256  1:12│  status: one line, never wraps
│ ┌──────────────────────────────┐ │
│ │ Ask about your painting…     │ │  message box: starts at 2 lines, grows to 120 pt
│ ├──────────────────────────────┤ │
│ │ + Agent ▾ Kimi-K3.1 ▾ 🛡 4📎 ■ ↑│ │  one control row
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

With a card waiting for the artist:

```
│  chat                            │
├──────────────────────────────────┤
│ ▲ Waiting for you: canvas        │  one line above the message box, whatever
│   reference          [ Show ]    │  the scroll position; Show jumps to the card
├──────────────────────────────────┤
│ message box and control row      │
```

### What moves where

| Now | After |
|---|---|
| "Painting target" line | Joined to the header. Return to painting stays beside it when it applies. |
| Tab bar | Hidden while Chat is the only tab. Tabs never shorten their names. |
| Status line, top of the panel | One line just above the message box, cut with "…", full text in the tooltip. Beside the chat's newest message, where the eye already is. It sits below the tabs, so every tab keeps it; the message box shows on Chat only. |
| Auto-approve | Stays on screen (the artist switches it while recording), as a small toggle in the status line. |
| Protected section | Hidden while the painting has no features and nothing is proposed. Otherwise one collapsed line, "Protected 3 of 5", opened by its arrow: its boxes are how a feature gets protected, so it cannot hide while features exist. The shield still opens the Protected areas window. |
| Canvas chip and hint line | A small canvas chip in the control row. The hint becomes its tooltip. A capture **error** still shows as a line, until it clears. |
| Attachment thumbnails | One chip showing a paperclip and the count (accessible name "4 attached"). It opens the thumbnails, with their remove buttons, as a row above the message box. |
| Paint only here / Find it for me | In the + menu. While a Paint only here area is active, its bar shows. |
| Provider and model rows | One chip showing the model. It opens a row with provider, model and the chat's AI images (the mockup left AI images out; it stays reachable here). Choosing a model closes the row. |
| Footer (save state, trace link, Show file) | In the header's … menu. A failed save shows as a status line. |
| "Latest" button | Floats over the chat, says how many new messages. |
| Return to painting | Beside the name in the header, and only while the attached canvas is not the painting. |

### The chat always gets back to what matters

- Sending a message jumps to the newest message.
- A card that needs an answer shows the "Waiting for you" line until it is answered, wherever the chat is scrolled.
- Scrolling up still holds the view: reading history is never interrupted by painting progress.
- A card's picture scales to fit the chat's width and height, so its buttons stay reachable without scrolling past it.
- A card's caption says what the card is. The artist's words are shown whole or not at all, never cut mid-word.

### Nothing is ever cut off

- The message box and control row come first: when the panel is short, the chat shrinks to its minimum of 120 pt.
- Below the height where both fit, the panel scrolls as a whole, so nothing is unreachable.
- Chips shorten their text at narrow widths; the control row never pushes past the panel's edge. If it still cannot fit, the
  shield and then the canvas chip step out; both are also in the + menu.

### The look

The clutter is also visual. In the stylesheet today: about ten font sizes, five corner radii, gaps set one at a time, and
text characters used as icons (`＋ ↻ × ■ ↑ ⌗ 🛡 ☕`), two of them full-colour emoji. All of this is within Qt Widgets and
QSS, so the panel stays Python and PyQt: no QML, no web view, no blur, glass or glow.

One small set of values, in `panel_theme.py`, used by the whole panel:

| What | Values |
|---|---|
| Text | 14 chat messages (the Text size setting), 13 body, 12 secondary, 11 small labels, 18 for the welcome line only (px at the default text size; they follow the setting) |
| Spacing | 4, 8, 12, 16 |
| Corners | 4 thumbnails, 8 rows and cards, 12 message box and chat bubbles, half the height for pills and dots (14, 9, 3) |
| Icons | Drawn SVGs in one style (`panel_icons.py`: 16 pt, 1.4 stroke, one colour taken from the theme), no text characters or emoji as a button's icon. Status words such as "✓ Met" on a label stay. |
| Dividers | The theme's quiet `hover` colour; the steel `border` colour only where a control needs an edge |
| Accent | Ember only for Send and Stop, the active tab, the status dot and "Waiting for you" |

Colours still come only from `panel_colors`, so the panel follows Toska Night, Toska Day, Dark, Light and Match. The Toska
values stay checked against the `.colors` files by `tests/test_toska_theme.py`.

## Measures

Checked by test at panel sizes 320 x 500 (the dock's minimum width), 360 x 687 and 420 x 1000 (points):

- At rest, with no card and four attachments, the chat has **at least 60%** of the panel's height at 687 and 1000.
- At every size, Send and the mode control lie fully inside the visible panel.
- After sending, the newest message is in view.
- A card waiting for an answer has its line on screen at every scroll position.
- A long status message does not change the height of anything.
- The tab names are never shortened.
- No text character or emoji is used as a button's icon.
- Every font size and corner radius in the panel's stylesheet comes from the set under "The look".

## Non-goals

- **No new features, and nothing removed.** Every control stays reachable, keeps its accessible name, and keeps doing
  what it does.
- **Nothing over the canvas.** Everything here stays inside the panel.
- **The "finish the painting" reference mode and the Find it fault** (a whole sentence used as a part's name, with almost
  half the canvas proposed for it). Those change what the agent does, not how the panel looks: a separate change.
- **Merging the three kinds of "protected".** Also a separate change.
- **Plan and Folder tabs' contents, and the Settings page**, apart from the tab names.
- **The artist's own window layout** is never moved by an update (see the open question).

## Open questions

1. **The black band.** Does the artist see it on screen? If it is real, it is a window sizing fault with its own fix
   (task 1).
2. **Layers across the top.** In the same capture Layers runs the full window width and takes about 190 pt, showing 2–3
   layers. `agent/make_agent_workspace.py` builds the default with Layers in the column beside the panel, not across the
   top, so the band probably came from a layout change, not the default (read from the script, not checked live). The
   artist has been asked. The Layers tab in `panel-layers-brushes` gives a way out either way.

## Compatibility

Panel only (`creative_docker.py`, `panel_theme.py`, `paint_only_panel.py`, and new icon files). No companion or engine change, so no protocol
change. Plan to ship in one install, with one restart, after the artist has finished the current painting.
