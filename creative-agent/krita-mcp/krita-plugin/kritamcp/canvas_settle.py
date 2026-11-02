"""A bounded wait for the canvas to go idle, and the order every command that paints through Node.paint* must keep.

Node.paintPath, paintEllipse, paintRectangle, paintLine and paintPolygon return at once: the stroke runs on Krita's pool.
A whole-image refresh requested before it ends queues one update job per tile region (about 108 on a 6000 x 4500
canvas) behind it. With a selection active the stroke paints indirectly, and its final merge holds the layer's
indirect-painting write lock while every pool thread runs an update job blocked on the read lock: the merge never gets a
thread, and Document.waitForDone() on the GUI thread waits forever. So: settle first, refresh after, and never wait
without a deadline on the GUI thread.

Document.waitForDone() has no deadline, so this polls Document.tryBarrierLock() (which never blocks), running Qt's events
between tries so Krita can finish the stroke. A document class without the try (a test double) waits as before.

Busy is not stuck. On a big image with live filter masks a re-render after a pass can take many minutes; it keeps
recompositing areas, and every area it finishes moves Document.revision() on. So the wait gives up as stuck only when
the revision has stood still for SETTLE_SECONDS (the starved merge above recomposites nothing); while it moves the wait
goes on, up to CEILING_SECONDS and never past the time the command's reply is due (reply_due, set by the commands loop
from the HTTP request's timeout). Reaching the ceiling while still making progress is RENDERING: the paint landed and
Krita is still drawing the result, which the caller reports as such, never as a failed or partial pass. Without
revision() (stock Krita, test doubles) there is no progress signal and SETTLE_SECONDS is the whole wait, as before.
"""
import time

SETTLE_SECONDS = 60          # no progress this long is stuck (the fork's own libkis wait limit, KisToolFunctions::waitLimit)
CEILING_SECONDS = 1200       # the longest wait for a canvas that keeps making progress
REPLY_MARGIN_SECONDS = 15    # what the rest of the command needs after the wait, before its reply is due
POLL_SECONDS = 0.01
SETTLED, STUCK, RENDERING = 'settled', 'stuck', 'still_rendering'
NOT_SETTLED = ('The canvas did not settle: Krita was still painting after %d seconds, so the screen was not refreshed. '
               'Check the painting before the next command.')
STILL_RENDERING = ('The paint landed. Krita is still rendering the canvas after %d seconds (it is making progress, as '
                   'live filter masks on a large image do), so the screen was not refreshed yet. Do not repeat this '
                   'change; observe again once rendering has finished.')

_reply_due = None            # time.monotonic() by which the running command must reply; None: no reply deadline


def reply_due(at):
    """Set (a time.monotonic() value) or clear (None) the time the running command's reply is due."""
    global _reply_due
    _reply_due = at


def _pump():
    try:
        from .qt_compat import QCoreApplication
        QCoreApplication.processEvents()
    except (ImportError, AttributeError, TypeError):
        pass


def not_settled(seconds=None):
    return NOT_SETTLED % round(SETTLE_SECONDS if seconds is None else seconds)


def still_rendering(seconds):
    return STILL_RENDERING % round(seconds)


def _revision(doc):
    try:
        return doc.revision() if hasattr(doc, 'revision') else None
    except (RuntimeError, TypeError):
        return None


def settle_state(doc, deadline=None):
    """SETTLED when the image's queued work has finished; STUCK when it made no progress for `deadline` seconds
    (SETTLE_SECONDS by default); RENDERING when it was still making progress at the ceiling."""
    if not hasattr(doc, 'tryBarrierLock'):
        doc.waitForDone()
        return SETTLED
    stall = SETTLE_SECONDS if deadline is None else deadline
    started = time.monotonic()
    ceiling = started + max(stall, CEILING_SECONDS)
    if _reply_due is not None:
        ceiling = min(ceiling, _reply_due - REPLY_MARGIN_SECONDS)
    revision, progressed, moved_at = _revision(doc), False, started
    while True:
        if doc.tryBarrierLock():
            doc.unlock()
            return SETTLED
        now = time.monotonic()
        current = _revision(doc)
        if current is not None and current != revision:
            revision, progressed, moved_at = current, True, now
        if now - moved_at >= stall:
            return STUCK
        if now >= ceiling:
            return RENDERING if progressed else STUCK
        _pump()
        time.sleep(POLL_SECONDS)


def settle(doc, deadline=None):
    """True when the image's queued work has finished, False when it is stuck or still rendering at the ceiling."""
    return settle_state(doc, deadline) == SETTLED


def refresh_settled(doc, deadline=None):
    """The whole-image refresh after an async paint call: settle, then refresh. False (nothing refreshed) when the canvas
    did not settle in time; the caller reports it."""
    if not settle(doc, deadline):
        return False
    doc.refreshProjection()
    doc.waitForDone()
    return True


def outcome(state, waited):
    """What a command reports after a wait: nothing when settled, the error when stuck, and a notice (no error: the
    paint landed) when still rendering."""
    if state == STUCK:
        return {'error': not_settled()}
    if state == RENDERING:
        return {'rendering_code': 'canvas_still_rendering', 'rendering_note': still_rendering(waited)}
    return {}


def refresh_or_report(doc, deadline=None):
    """refresh_settled, reporting how it ended (outcome): the refresh runs only when the canvas settled."""
    started = time.monotonic()
    state = settle_state(doc, deadline)
    if state == SETTLED:
        doc.refreshProjection()
        doc.waitForDone()
    return outcome(state, time.monotonic() - started)
