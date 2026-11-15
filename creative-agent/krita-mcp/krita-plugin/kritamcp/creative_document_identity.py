"""Live document identities, independent of copied layer UUIDs and file paths.

Krita's Document equality compares its underlying KisDocument, including when
the Python API returns a fresh wrapper. A cloned image retains layer UUIDs.
"""
import uuid
from krita import Krita

_identities = []
# Documents the plugin made for itself and never shows (the brush swatch sheet, brush_craft.py). Krita lists a document
# with no view among its documents, so they are left out here: the panel, the session checks and "no other document
# open" only ever see the artist's documents.
_hidden = []


def _same_document(left, right):
    try:
        return left is right or bool(left == right)
    except (RuntimeError, ReferenceError):
        return False


def is_hidden(doc):
    return any(_same_document(doc, hidden) for hidden in _hidden)


def hide_document(doc):
    """Keep `doc` out of open_documents() from now on."""
    if not is_hidden(doc):
        _hidden.append(doc)


def unhide_document(doc):
    """Forget a hidden document (the plugin let go of it)."""
    _hidden[:] = [hidden for hidden in _hidden if not _same_document(doc, hidden)]


def open_documents():
    app = Krita.instance()
    candidates = list(app.documents()) if hasattr(app, 'documents') else []
    if hasattr(app, 'activeDocument'):
        candidates.append(app.activeDocument())
    # Cloned documents can have views before appearing in app.documents().
    for window in app.windows() if hasattr(app, 'windows') else []:
        for view in window.views():
            candidates.append(view.document())
    result = []
    for doc in candidates:
        if doc is not None and not is_hidden(doc) and not any(_same_document(doc, known) for known in result):
            result.append(doc)
    return result


def document_id(doc):
    if doc is None:
        return None
    alive = open_documents()
    alive.append(doc)
    _identities[:] = [(known, identifier) for known, identifier in _identities
                     if any(_same_document(known, current) for current in alive)]
    for known, identifier in _identities:
        if _same_document(doc, known):
            return identifier
    identifier = 'canvas-' + str(uuid.uuid4())
    _identities.append((doc, identifier))
    return identifier
