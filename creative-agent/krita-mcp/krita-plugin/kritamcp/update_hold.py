# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""An app update waits while the agent paints (openspec app-updates, task 3.2).

Toska's updater asks the application for its `toskaAgentBusy` property before an update relaunches the app
(libs/ui/KisMainWindow.cpp, libs/ui/osx_updater.mm). The panel sets it for the length of a run. Each window has its own
panel, so the property is true while any of them is busy. Setting it can never break the panel.
"""
PROPERTY = 'toskaAgentBusy'
BUSY = set()           # ids of the panels with a run in progress


def set_busy(owner, busy, app=None):
    """Record that `owner` (a panel) is or is not busy and set the application's property. Returns the property's value.
    app: the application; None asks Qt for it."""
    if busy:
        BUSY.add(id(owner))
    else:
        BUSY.discard(id(owner))
    value = bool(BUSY)
    try:
        if app is None:
            from .qt_compat import QApplication
            app = QApplication.instance()
        if app is not None:
            app.setProperty(PROPERTY, value)
    except Exception:
        pass
    return value
