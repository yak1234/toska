"""A bounded wait for the canvas to go idle, and the order every command that paints through Node.paint* must keep.

Node.paintPath, paintEllipse, paintRectangle, paintLine and paintPolygon return at once: the stroke runs on Krita's pool.
A whole-image refresh requested before it ends queues one update job per tile region (about 108 on a 6000 x 4500
canvas) behind it. With a selection active the stroke paints indirectly, and its final merge holds the layer's
indirect-painting write lock while every pool thread runs an update job blocked on the read lock: the merge never gets a
thread, and Document.waitForDone() on the GUI thread waits forever. So: settle first, refresh after, and never wait
without a deadline on the GUI thread.

Document.waitForDone() has no deadline, so this polls Document.tryBarrierLock() (which never blocks), running Qt's events
between tries so Krita can finish the stroke. A document class without the try (a test double) waits as before.
"""
import time

SETTLE_SECONDS = 60          # the fork's own libkis wait limit (KisToolFunctions::waitLimit)
POLL_SECONDS = 0.01
NOT_SETTLED = ('The canvas did not settle: Krita was still painting after %d seconds, so the screen was not refreshed. '
               'Check the painting before the next command.')


def _pump():
    try:
        from .qt_compat import QCoreApplication
        QCoreApplication.processEvents()
    except (ImportError, AttributeError, TypeError):
        pass


def not_settled(seconds=None):
    return NOT_SETTLED % round(SETTLE_SECONDS if seconds is None else seconds)


def settle(doc, deadline=None):
    """True when the image's queued work has finished, False when `deadline` seconds (SETTLE_SECONDS by default) pass first."""
    if not hasattr(doc, 'tryBarrierLock'):
        doc.waitForDone()
        return True
    limit = time.monotonic() + (SETTLE_SECONDS if deadline is None else deadline)
    while True:
        if doc.tryBarrierLock():
            doc.unlock()
            return True
        if time.monotonic() >= limit:
            return False
        _pump()
        time.sleep(POLL_SECONDS)


def refresh_settled(doc, deadline=None):
    """The whole-image refresh after an async paint call: settle, then refresh. False (nothing refreshed) when the canvas
    did not settle in time; the caller reports it."""
    if not settle(doc, deadline):
        return False
    doc.refreshProjection()
    doc.waitForDone()
    return True
