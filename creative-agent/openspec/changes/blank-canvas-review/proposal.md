# Blank-canvas review: Luna knows what was empty before a batch

Status: APPROVED by the artist (2026-11-10: "yes but build after proposal i want this toska agent running so it paints").

## Why

One traced chat (Langfuse session 09ffb118…, Istanbul, 12000x4000, 2026-11-10 03:13-05:25 UTC, 10 move reviews). The left
half of the canvas is a finished painting, the right half is empty. The artist asked for the painting on the right half
and a new empty dock on the left.

- **One wrong verdict cost the session.** The painter's first action (03:19) cloned the painting onto the empty half. The
  result was a perfect copy. `decision-detect-move-failures` answered flat_block 1.0 and Luna undid it. The same clone
  at 05:18 got the same answer. Everything between was the painter trying worse routes.
- **The answer is all-or-nothing.** flat_block was exactly 1.0 on the perfect copy and on the bad attempts (a gradient,
  sparse dabs). No threshold separates them: the question is "a new rectangle that is not present in BEFORE", and on
  empty canvas every batch is one.
- **The exemption is one answer for the whole canvas.** `established` (is BEFORE a finished painting?) was 0.96-1.0 in all
  ten reviews, because half the canvas is finished. The block-in exemption never applied to the empty half.
- **Undoing on empty canvas never helped.** Eight undos returned the right half to empty; the painter started again each
  time. The one success was a dab layer Luna flagged at 1.0 (flat block, pasted ellipses) that the artist kept: the next
  blend over it scored flat_block 0.
- **Luna is told nothing.** Two whole-canvas images at 1568 px wide, no words. Nothing says what was empty.
- **Auto-approve kept the loop going.** Move 6: "Luna undid 2 of 2 batches". Auto-approve pressed Keep after 60 s and
  move 7 started.
- **Transfers stop after their first chunk.** Four `paint_from_reference` jobs painted 1,024 of about 39,000 strokes and
  failed with "This chunk has an uncertain outcome", run one after another, and one alone. The message hides the
  plugin's reason. Single-chunk transfers and `paint_reference_surface` (20 chunks) completed. Cause unknown.

The Decisions guide (developers.openai.com/api/docs/guides/decisions) says: write questions around observable
criteria, combine text and image parts for context, set thresholds from labelled examples.

## Goals

1. **Code measures what was empty.** A new plugin operation compares the BEFORE and AFTER views and returns, exactly:
   the share of the changed pixels that were empty canvas before (`fresh_share`), the share of painted pixels that
   became empty (`removed_share`), the box of the new ground, and both per ninth (the cells Luna's location question
   already uses). Empty means the view's dominant colour within a small tolerance (as `painted_share`).
2. **Three kinds of batch**, decided in code from goal 1:
   - *over paint* (little of the change is on empty canvas): reviewed as today. Nothing changes.
   - *new ground* (nearly all of it is): the BEFORE/AFTER artifact questions are not asked. One new question is.
   - *mixed*: both are asked; an artifact finding located in a ninth that was empty is dropped.
3. **Luna is told the facts.** Every review of a new-ground or mixed batch starts with a text part: which ninths were
   empty before, and that paint there is new ground, not a patch over the painting.
4. **A question that fits empty canvas.** `new_ground` (a choice, with `other`), asked about a crop of the new ground
   alone, so the finished part of the canvas does not answer for it:
   - `picture`: reads as a painted picture: forms, light and continuous paint.
   - `underpainting`: colours and big shapes are placed, but separate dabs or blocks still show.
   - `placeholder`: a flat fill, a plain gradient or scattered marks, with no forms.
   - `other`.
5. **New ground is never undone for roughness.** `picture`: kept, no note. `underpainting` and `placeholder`: kept, and
   the painter is told what it reads as and to blend or finish it next. Undo protects paint; empty canvas has none.
6. **Removing artwork is always undone.** `removed_share` over a threshold is a finding of its own (`artwork_removed`),
   measured, not asked. It is undone like a severe finding (the 05:11 batch hid the original layer).
7. **A move that needs the artist is not auto-approved.** When Luna undid every batch of a move, or stopped the move,
   or new ground read as `placeholder` in three moves running, the move card says so and Auto-approve does not press
   Keep.
8. **Transfers say why they stopped.** "Uncertain outcome" carries the plugin's reason. Then the first-chunk stop is
   reproduced on a copy and fixed.
9. **A truth set from this chat.** The ten reviewed pairs, hand-labelled, run through the new review before it ships:
   the clone must be kept with no note; the gradient and the sparse dabs must read as `placeholder` or `underpainting`.
   The pictures are the artist's painting: the set stays out of git (Langfuse dataset and `local-notes/`).

## Non-goals

- No change to the review of a batch over existing paint, to `established`, or to the artifact questions' wording.
- No new "extend the painting" tool. With the review fixed, the clone the painter already chose is kept.
- No higher-resolution render for the crop yet: it is cut from the AFTER view. If the truth set shows the crop is too
  coarse, a region render follows.
- Sharpen is not changed. It works on a goal placed over the whole canvas; this chat had none. Offering it for a patch
  reference is a separate idea.

## Calls made by Claude (the artist can change them)

- Thresholds: new ground at `fresh_share` 0.9 and above, over paint below 0.1; `removed_share` 0.2; a ninth counts as
  empty at 0.9. Checked against the truth set.
- Three `placeholder` moves running before the move stops for the artist.
- Empty is measured on the view image in the plugin (Qt reads PNG and JPEG; the companion has no JPEG decoder).

## Compatibility

Companion: `src/visual-checks.ts`, `src/visual-check-questions.json`, new `src/blank-canvas.ts`,
`extensions/luna-review.ts`, `src/studio.mjs`, `src/reference-tool.mjs`. Plugin: new `blank_canvas.py`, one operation in
`creative_tools.py`, the move card's auto-approve offer in `creative_docker.py`. Protocol: one new native operation
(`change_map`); an older plugin answers with an error and the review falls back to today's behaviour. Luna on Evaluate
records the new verdicts and acts on none.
