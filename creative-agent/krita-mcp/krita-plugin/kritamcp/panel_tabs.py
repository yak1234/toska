# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""Layers and Brushes as tabs in the agent panel (openspec panel-layers-brushes).

A tab holds the real widget of one of the app's docks, never a copy, so everything the panel does keeps working. A widget can be in
one place, and the dock decides which: while the dock is open (in the artist's layout, even tabbed behind another dock) it keeps its
widget and the tab offers Move it here; while it is hidden the tab holds the widget. The Window menu and a workspace switch show or
hide docks, so both are followed without further code. An update never moves an open dock.

Open or hidden is read from the dock's toggleViewAction, not from isVisible: a dock tabbed behind another is not visible, and is
still in the artist's layout.
"""
from .qt_compat import QFrame, QHBoxLayout, QLabel, QPushButton, QSizePolicy, QVBoxLayout, QWidget


class DockTab(QWidget):
    def __init__(self, title, dock_name):
        super().__init__()
        self.title, self.dock_name = title, dock_name
        self.dock = None; self.held = None; self.stand_in = None
        self.setObjectName('creativeChat')
        column = QVBoxLayout(self); column.setContentsMargins(0, 8, 0, 0); column.setSpacing(8)
        self.notice = QFrame(); self.notice.setObjectName('waitingLine')
        line = QHBoxLayout(self.notice); line.setContentsMargins(8, 2, 4, 2); line.setSpacing(8)
        self.notice_text = QLabel('%s is open as its own panel.' % title); self.notice_text.setObjectName('waitingText')
        self.notice_text.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Preferred); line.addWidget(self.notice_text, 1)
        self.move_button = QPushButton('Move it here'); self.move_button.setObjectName('waitingShow')
        self.move_button.setAccessibleName('Move %s into this tab' % title)
        self.move_button.setToolTip('Hides the separate %s panel and shows it here. Window > Dockers brings it back.' % title)
        self.move_button.clicked.connect(self.move_here); line.addWidget(self.move_button)
        column.addWidget(self.notice)
        self.holder = QWidget(); self.holder.setObjectName('creativeChat')
        self.holder_layout = QVBoxLayout(self.holder); self.holder_layout.setContentsMargins(0, 0, 0, 0); self.holder_layout.setSpacing(0)
        column.addWidget(self.holder, 1)

    def attach(self, dock):
        """Start following a dock of this window."""
        self.dock = dock
        dock.toggleViewAction().toggled.connect(lambda _shown: self.follow())
        self.follow()

    def follow(self):
        if self.dock is None: return
        is_open = self.dock.toggleViewAction().isChecked()
        if is_open: self.give_back()
        else: self.take()
        self.notice.setVisible(is_open)

    def move_here(self):
        if self.dock is not None: self.dock.hide(); self.follow()

    def take(self):
        if self.held is not None: return
        widget = self.dock.widget()
        if widget is None: return
        # A dock is never left empty: what it would show if Krita opened it before this panel follows.
        self.stand_in = QWidget(); self.dock.setWidget(self.stand_in)
        self.holder_layout.addWidget(widget, 1); widget.show()
        self.held = widget

    def give_back(self):
        """The dock owns its widget again."""
        if self.held is None: return
        widget, stand_in = self.held, self.stand_in
        self.held = None; self.stand_in = None
        self.holder_layout.removeWidget(widget)
        self.dock.setWidget(widget); widget.show()
        if stand_in is not None: stand_in.deleteLater()
