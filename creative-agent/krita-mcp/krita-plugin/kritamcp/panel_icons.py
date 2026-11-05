# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""The panel's icons: one drawn set in one style (16 pt, 1.4 stroke), tinted from the theme when drawn, so no text character
or emoji stands in for an icon (openspec panel-redesign, "The look").

`themed(button, name)` gives a button its icon and remembers the name on the button; `retint(root)` redraws every such button
under `root` after a theme change. The role says which theme colour the icon takes: 'muted' for quiet chrome, 'text' for what
is in use, 'buttonText' on a filled button.
"""
from .qt_compat import QAbstractButton, QIcon, QPixmap, QSize

STROKE = 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"'
SOLID = 'fill="currentColor"'

ICONS = {
    'plus': (STROKE, '<path d="M8 3v10M3 8h10"/>'),
    'clock': (STROKE, '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>'),
    'more': (SOLID, '<circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/>'),
    'image': (STROKE, '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="M2.5 10.5l3-2.5 2.5 2 2-1.5 3.5 2.5"/>'),
    'refresh': (STROKE, '<path d="M13 8a5 5 0 11-1.5-3.500L13 6M13 3v3h-3"/>'),
    'close': (STROKE, '<path d="M4 4l8 8M12 4l-8 8"/>'),
    'crop': (STROKE, '<path d="M4.5 1.500v10h10M1.5 4.500h10v10"/>'),
    'shield': (STROKE, '<path d="M8 2l5 1.800v4c0 3-2.1 5-5 6.2-2.9-1.2-5-3.2-5-6.200v-4z"/>'),
    'stop': (SOLID, '<rect x="4" y="4" width="8" height="8" rx="1"/>'),
    'send': (STROKE, '<path d="M8 13V3M4 7l4-4 4 4"/>'),
    'down': (STROKE, '<path d="M8 3v10M4 9l4 4 4-4"/>'),
    'attach': (STROKE, '<path d="M13 7.500l-5.2 5.200a3 3 0 01-4.3-4.300l5.5-5.500a2 2 0 012.9 2.900l-5.4 5.400a1 1 0 01-1.4-1.400l4.6-4.6"/>'),
    'chevron-right': (STROKE, '<path d="M6 3.500L10.5 8 6 12.5"/>'),
    'chevron-down': (STROKE, '<path d="M3.5 6L8 10.5 12.5 6"/>'),
    'check': (STROKE, '<path d="M3 8.500l3.5 3.500L13 4.5"/>'),
    'redo': (STROKE, '<path d="M3 8a5 5 0 105-5H4.500M6.5 1L4.5 3l2 2"/>'),
    'attention': (STROKE, '<circle cx="8" cy="8" r="6"/><path d="M8 4.500v4M8 11v.2"/>'),
}

_colors = {'muted': '#a7aab3', 'text': '#e7e8eb', 'buttonText': '#24272d'}


def set_colors(colors):
    """The theme the next icons are drawn in (the panel's colours, panel_theme.py)."""
    _colors.update({key: colors[key] for key in _colors if key in colors})


def _pixmap(name, color, size):
    paint, shapes = ICONS[name]
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 16 16" %s>%s</svg>' % (
        size * 2, size * 2, paint.replace('currentColor', color), shapes)
    pixmap = QPixmap(); pixmap.loadFromData(svg.encode('utf-8'), 'SVG'); pixmap.setDevicePixelRatio(2)
    return pixmap


def icon(name, role='muted', size=16):
    """The named icon in a theme colour; disabled, it fades to the muted colour."""
    drawn = QIcon(); drawn.addPixmap(_pixmap(name, _colors[role], size))
    drawn.addPixmap(_pixmap(name, _colors['muted'], size), QIcon.Mode.Disabled)
    return drawn


def themed(button, name, role='muted', size=16):
    """Give a button its icon; `retint` keeps it in the theme."""
    button.setProperty('panelIcon', name); button.setProperty('panelIconRole', role); button.setProperty('panelIconSize', size)
    button.setIcon(icon(name, role, size)); button.setIconSize(QSize(size, size))
    return button


def retint(root):
    """Redraw every themed button under `root`, after set_colors."""
    for button in root.findChildren(QAbstractButton):
        name = button.property('panelIcon')
        if name: button.setIcon(icon(name, button.property('panelIconRole') or 'muted', button.property('panelIconSize') or 16))
