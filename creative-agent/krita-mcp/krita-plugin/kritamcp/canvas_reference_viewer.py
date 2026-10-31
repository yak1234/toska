# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""The canvas edit reference, up close (openspec canvas-reference-viewer; the artist, 2026-10-31: "I want it to actually be
zoomable for me to be able to click on the image … something similar to ChatGPT's edit image chat").

Clicking the card's picture opens this window (its own window, never over the canvas):
  - the reference large: the wheel or a pinch zooms around the pointer, dragging pans, the zoom menu has Fit and 50-200 %;
  - Before / after: the toggle, or hold Space, shows the canvas the reference was made from;
  - Show area: the found change in red;
  - Mark: drag a box, or draw around a part. The mark goes with every answer as a polygon in 0-1 canvas coordinates
    (canvas-reference.ts readMark): the area to use, and the area later pictures are compared in;
  - Describe edits: words along the bottom, sent with Return, edit the reference (Try again with words);
  - the card's answers. Any answer closes the window and the card's buttons.
The geometry (normalized, simplified, box_points) is plain Python, tested without Qt."""
from .qt_compat import (QButtonGroup, QCheckBox, QColor, QComboBox, QEvent, QGraphicsPathItem, QGraphicsPixmapItem, QGraphicsScene,
                        QGraphicsView, QHBoxLayout, QImage, QLabel, QLineEdit, QPainter, QPainterPath, QPen, QPixmap, QPointF,
                        QPushButton, QSizePolicy, Qt, QVBoxLayout, QWidget, pyqtSignal)

ZOOMS = (('Fit', None), ('50%', 0.5), ('100%', 1.0), ('200%', 2.0))
MIN_ZOOM, MAX_ZOOM, WHEEL_STEP = 0.05, 8.0, 1.15


def box_points(x0, y0, x1, y1):
    """A box as four corners, clockwise from its top left, whichever way it was dragged."""
    left, right, top, bottom = min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1)
    return [(left, top), (right, top), (right, bottom), (left, bottom)]


def simplified(points, step):
    """Freehand points, keeping one at least `step` from the last kept (a drawn outline has hundreds a second)."""
    kept = []
    for x, y in points:
        if not kept or (x - kept[-1][0]) ** 2 + (y - kept[-1][1]) ** 2 >= step * step:
            kept.append((x, y))
    return kept


def normalized(points, width, height):
    """Points on the picture (pixels) as a mark in 0-1 canvas coordinates, or None when it encloses nothing."""
    if width <= 0 or height <= 0 or len(points) < 3:
        return None
    mark = [[round(min(1.0, max(0.0, x / width)), 5), round(min(1.0, max(0.0, y / height)), 5)] for x, y in points]
    twice_area = sum(mark[i][0] * mark[i - 1][1] - mark[i - 1][0] * mark[i][1] for i in range(len(mark)))
    return mark if abs(twice_area) / 2 >= 1e-5 else None


def event_point(event):
    """The pointer's position on the widget (PyQt6 position(), PyQt5 pos())."""
    return event.position().toPoint() if hasattr(event, 'position') else event.pos()


class PictureButton(QLabel):
    """The card's picture, clickable: it opens the viewer."""
    clicked = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setToolTip('Click to look closer, mark the area and describe edits')

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mouseReleaseEvent(event)


class ReferenceView(QGraphicsView):
    """The picture: zoom around the pointer, pan by dragging; in a mark tool, dragging marks instead."""
    zoomed = pyqtSignal(float)
    marked = pyqtSignal(object)            # the mark's points in picture pixels, or None when cleared

    def __init__(self, reference, canvas, area):
        super().__init__()
        self.setScene(QGraphicsScene(self))
        self.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setBackgroundBrush(QColor(30, 30, 32))
        self.reference = self.scene().addPixmap(reference)
        size = reference.size()
        # The canvas view is smaller than the reference: scaled to it, both share one set of coordinates.
        self.canvas = self.scene().addPixmap(canvas.scaled(size, Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)) if not canvas.isNull() else None
        if self.canvas: self.canvas.setVisible(False)
        self.area = self.scene().addPixmap(area.scaled(size, Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.FastTransformation)) if not area.isNull() else None
        self.mark_item = QGraphicsPathItem()
        pen = QPen(QColor(255, 214, 10)); pen.setWidth(2); pen.setCosmetic(True); pen.setStyle(Qt.PenStyle.DashLine)
        self.mark_item.setPen(pen); self.mark_item.setBrush(QColor(255, 214, 10, 40)); self.mark_item.setZValue(3)
        self.scene().addItem(self.mark_item)
        self.tool = 'move'; self.drawing = None; self.fit = True
        self.set_tool('move')

    def picture_size(self):
        return self.reference.pixmap().width(), self.reference.pixmap().height()

    def zoom(self):
        return self.transform().m11()

    def set_zoom(self, value):
        """A zoom (1 = 100 %), or None to fit the window."""
        if value is None:
            self.fit = True
            self.fitInView(self.reference, Qt.AspectRatioMode.KeepAspectRatio)
        else:
            self.fit = False
            self.resetTransform(); self.scale(value, value)
        self.zoomed.emit(self.zoom())

    def zoom_by(self, factor):
        target = min(MAX_ZOOM, max(MIN_ZOOM, self.zoom() * factor))
        if target != self.zoom():
            self.fit = False
            self.scale(target / self.zoom(), target / self.zoom()); self.zoomed.emit(self.zoom())

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if self.fit: self.set_zoom(None)

    def wheelEvent(self, event):
        steps = event.angleDelta().y() / 120.0
        if steps: self.zoom_by(WHEEL_STEP ** steps)

    def viewportEvent(self, event):
        # A trackpad pinch on macOS arrives as a native zoom gesture.
        if event.type() == QEvent.Type.NativeGesture and event.gestureType() == Qt.NativeGestureType.ZoomNativeGesture:
            self.zoom_by(1.0 + event.value()); return True
        return super().viewportEvent(event)

    def show_before(self, before):
        if self.canvas: self.canvas.setVisible(before)

    def show_area(self, shown):
        if self.area: self.area.setVisible(shown)

    def set_tool(self, tool):
        """'move' pans; 'box' and 'draw' mark."""
        self.tool = tool
        self.setDragMode(QGraphicsView.DragMode.ScrollHandDrag if tool == 'move' else QGraphicsView.DragMode.NoDrag)
        self.viewport().setCursor(Qt.CursorShape.OpenHandCursor if tool == 'move' else Qt.CursorShape.CrossCursor)

    def scene_point(self, event):
        point = self.mapToScene(event_point(event))
        width, height = self.picture_size()
        return min(float(width), max(0.0, point.x())), min(float(height), max(0.0, point.y()))

    def mousePressEvent(self, event):
        if self.tool != 'move' and event.button() == Qt.MouseButton.LeftButton:
            self.drawing = [self.scene_point(event)]; return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self.drawing is not None:
            point = self.scene_point(event)
            if self.tool == 'box': self.drawing = [self.drawing[0], point]
            else: self.drawing.append(point)
            self.draw_mark(self.current_points()); return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        if self.drawing is not None:
            point = self.scene_point(event)               # the release point ends the box or the outline, moved or not
            if self.tool == 'box': self.drawing = [self.drawing[0], point]
            else: self.drawing.append(point)
            points = self.current_points(); self.drawing = None
            self.draw_mark(points if len(points) >= 3 else [])
            self.marked.emit(points if len(points) >= 3 else None); return
        super().mouseReleaseEvent(event)

    def current_points(self):
        if not self.drawing: return []
        if self.tool == 'box':
            if len(self.drawing) < 2: return []
            (x0, y0), (x1, y1) = self.drawing
            return box_points(x0, y0, x1, y1)
        return simplified(self.drawing, max(1.0, 3.0 / max(self.zoom(), 1e-6)))

    def draw_mark(self, points):
        path = QPainterPath()
        if points:
            path.moveTo(QPointF(*points[0]))
            for point in points[1:]: path.lineTo(QPointF(*point))
            path.closeSubpath()
        self.mark_item.setPath(path)


def area_pixmap(mask_path):
    """The found area as a red tint (transparent outside it)."""
    mask = QImage(mask_path) if mask_path else QImage()
    if mask.isNull():
        return QPixmap()
    tint = QImage(mask.size(), QImage.Format.Format_ARGB32); tint.fill(QColor(235, 40, 40))
    tint.setAlphaChannel(mask.convertToFormat(QImage.Format.Format_Grayscale8))     # opaque inside the area, clear outside
    faded = QImage(tint.size(), QImage.Format.Format_ARGB32); faded.fill(QColor(0, 0, 0, 0))
    painter = QPainter(faded); painter.setOpacity(0.35); painter.drawImage(0, 0, tint); painter.end()
    return QPixmap.fromImage(faded)


class ReferenceViewer(QWidget):
    """The window: the view, its tools, Describe edits and the card's answers. `answer(action, extra)` sends one."""

    def __init__(self, event, answer, parent=None):
        super().__init__(parent, Qt.WindowType.Window)
        self.setObjectName('referenceViewer'); self.setWindowTitle(event.get('title') or 'Canvas edit reference')
        self.answer = answer; self.answered = False; self.mark = None; self.before_held = False
        reference = QPixmap(event.get('reference_path') or event.get('image_path') or '')
        self.view = ReferenceView(reference, QPixmap(event.get('canvas_path') or ''), area_pixmap(event.get('mask_path')))
        self.view.zoomed.connect(self.show_zoom); self.view.marked.connect(self.set_mark)

        tools = QHBoxLayout()
        self.zoom_box = QComboBox(); self.zoom_box.setAccessibleName('Zoom')
        for label, _value in ZOOMS: self.zoom_box.addItem(label)
        self.zoom_box.activated.connect(lambda index: self.view.set_zoom(ZOOMS[index][1]))
        self.zoom_label = QLabel(); self.zoom_label.setObjectName('muted'); self.zoom_label.setMinimumWidth(44)
        self.before = QPushButton('Before / after'); self.before.setCheckable(True)
        self.before.setToolTip('Show your canvas as it was (or hold Space)')
        self.before.toggled.connect(lambda on: self.view.show_before(on))
        self.before.setEnabled(self.view.canvas is not None)
        self.show_found = QCheckBox('Show area'); self.show_found.setChecked(True)
        self.show_found.setToolTip('The change Toska found, in red'); self.show_found.toggled.connect(self.view.show_area)
        self.show_found.setEnabled(self.view.area is not None)
        self.tool_group = QButtonGroup(self)
        self.tool_buttons = {}
        for tool, label, tip in (('move', 'Move', 'Drag to move around the picture'), ('box', 'Mark box', 'Drag a box around the part to change'),
                                 ('draw', 'Mark freehand', 'Draw around the part to change')):
            button = QPushButton(label); button.setCheckable(True); button.setToolTip(tip)
            button.clicked.connect(lambda _checked=False, chosen=tool: self.view.set_tool(chosen))
            self.tool_group.addButton(button); self.tool_buttons[tool] = button; tools.addWidget(button)
        self.tool_buttons['move'].setChecked(True)
        self.clear = QPushButton('Clear mark'); self.clear.setEnabled(False); self.clear.clicked.connect(lambda: self.set_mark(None, drawn=False))
        tools.addWidget(self.clear); tools.addStretch(1)
        for widget in (self.show_found, self.before, self.zoom_label, self.zoom_box): tools.addWidget(widget)

        self.hint = QLabel('Scroll or pinch to zoom, drag to move. Hold Space to see your canvas as it was.')
        self.hint.setObjectName('muted'); self.hint.setWordWrap(True)

        edits = QHBoxLayout()
        self.describe = QLineEdit(); self.describe.setPlaceholderText('Describe edits'); self.describe.setAccessibleName('Describe edits')
        self.describe.returnPressed.connect(self.send_edit)
        self.send = QPushButton('Send'); self.send.clicked.connect(self.send_edit)
        edits.addWidget(self.describe, 1); edits.addWidget(self.send)

        answers = QHBoxLayout(); self.answer_buttons = []
        for label, action in zip(event.get('options') or [], event.get('actions') or []):
            button = QPushButton(label); button.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Fixed)
            button.clicked.connect(lambda _checked=False, chosen=action: self.choose(chosen))
            answers.addWidget(button); self.answer_buttons.append(button)

        layout = QVBoxLayout(self)
        layout.addLayout(tools); layout.addWidget(self.view, 1); layout.addWidget(self.hint); layout.addLayout(edits); layout.addLayout(answers)
        self.resize(1100, 860)
        self.view.set_zoom(None)

    def show_zoom(self, value):
        self.zoom_label.setText(f'{round(value * 100)}%')

    def set_mark(self, points, drawn=True):
        width, height = self.view.picture_size()
        self.mark = normalized(points, width, height) if points else None
        if not drawn or self.mark is None: self.view.draw_mark([])
        self.clear.setEnabled(self.mark is not None)
        self.hint.setText('The marked area goes with your answer: Use paints inside it, an edit is compared inside it.' if self.mark
                          else 'Scroll or pinch to zoom, drag to move. Hold Space to see your canvas as it was.')

    def extra(self):
        return {'area': self.mark} if self.mark else {}

    def choose(self, action):
        self.finish(action, self.extra())

    def send_edit(self):
        words = self.describe.text().strip()
        if words: self.finish('retry', dict(self.extra(), text=words))

    def finish(self, action, extra):
        if self.answered: return
        self.answered = True
        for button in self.answer_buttons + [self.send]: button.setEnabled(False)
        self.answer(action, extra)
        self.close()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Space and not event.isAutoRepeat() and not self.describe.hasFocus():
            self.before_held = True; self.view.show_before(True); return
        super().keyPressEvent(event)

    def keyReleaseEvent(self, event):
        if event.key() == Qt.Key.Key_Space and not event.isAutoRepeat() and self.before_held:
            self.before_held = False; self.view.show_before(self.before.isChecked()); return
        super().keyReleaseEvent(event)
