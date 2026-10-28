# Like branding/card/outline-text.py, but every line comes back as ONE merged outline: the pieces a
# glyph is built from (and touching letters) are unioned, so outlines, bevels and glows drawn along
# the edge never show the joins inside a letter. Needs fontTools, uharfbuzz and skia-pathops.
# Reads [{ "id", "font", "index", "text", "size", "tracking" }] on stdin; writes
# { id: { "d", "width", "top", "bottom" } } with the baseline at y=0 and y pointing down.

import json
import sys

import pathops
import uharfbuzz as hb
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
    k = spec["size"] / tt["head"].unitsPerEm
    track = spec.get("tracking", 0) * tt["head"].unitsPerEm

    buf = hb.Buffer()
    buf.add_str(spec["text"])
    buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": False})

    merged = pathops.Path()
    x = 0.0
    last = None
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        if last is not None and info.cluster != last:
            x += track
        last = info.cluster
        piece = pathops.Path()
        place = (k, 0, 0, -k, (x + pos.x_offset) * k, -pos.y_offset * k)
        glyphs[order[info.codepoint]].draw(TransformPen(piece.getPen(), place))
        merged = pathops.op(merged, piece, pathops.PathOp.UNION)
        x += pos.x_advance
    merged.simplify()

    pen = SVGPathPen(None, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    merged.draw(pen)
    left, top, right, bottom = merged.bounds if len(merged) else (0, 0, 0, 0)
    return {"d": pen.getCommands(), "width": round(x * k, 2), "top": round(top, 2), "bottom": round(bottom, 2)}


specs = json.load(sys.stdin)
json.dump({s["id"]: outline(s) for s in specs}, sys.stdout)
