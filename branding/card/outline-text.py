# Turns lines of text into SVG path outlines, so the card needs no fonts installed to print.
# Reads a JSON list on stdin: [{ "id", "font", "index", "text", "size", "tracking" }]
#   font = path to a .ttf/.ttc, index = face inside a .ttc, size = em size in card units,
#   tracking = extra space after each letter, in em.
# Writes JSON on stdout: { id: { "d": path with baseline at y=0 and the first letter at x=0, "width", "top", "bottom" } }
# Text is shaped with HarfBuzz, so kerning and joined scripts (Telugu శ్రీ) come out right.
# Needs fontTools and uharfbuzz (pip install fonttools uharfbuzz). Called by build-card.mjs.

import json
import sys

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

_fonts = {}


def load(path, index):
    key = (path, index)
    if key not in _fonts:
        with open(path, "rb") as f:
            blob = hb.Blob(f.read())
        _fonts[key] = (TTFont(path, fontNumber=index), hb.Font(hb.Face(blob, index)))
    return _fonts[key]


def outline(spec):
    tt, hbfont = load(spec["font"], spec.get("index", 0))
    glyphs = tt.getGlyphSet()
    order = tt.getGlyphOrder()
    upem = tt["head"].unitsPerEm
    k = spec["size"] / upem
    track = spec.get("tracking", 0) * upem

    buf = hb.Buffer()
    buf.add_str(spec["text"])
    buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": False})

    pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    bounds = BoundsPen(glyphs)
    x = 0.0
    last_cluster = None
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        # tracking goes between letters (clusters), never inside a joined letter
        if last_cluster is not None and info.cluster != last_cluster:
            x += track
        last_cluster = info.cluster
        place = (k, 0, 0, -k, (x + pos.x_offset) * k, -pos.y_offset * k)
        glyphs[order[info.codepoint]].draw(TransformPen(pen, place))
        glyphs[order[info.codepoint]].draw(TransformPen(bounds, place))
        x += pos.x_advance
    # top / bottom: the ink's extent in card units, y down, baseline at 0 (top is negative)
    _, top, _, bottom = bounds.bounds or (0, 0, 0, 0)
    return {"d": pen.getCommands(), "width": round(x * k, 2), "top": round(top, 2), "bottom": round(bottom, 2)}


specs = json.load(sys.stdin)
json.dump({s["id"]: outline(s) for s in specs}, sys.stdout)
