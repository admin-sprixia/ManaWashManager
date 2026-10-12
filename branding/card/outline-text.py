# Turns lines of text into SVG path outlines, so the card needs no fonts installed to print.
# Reads a JSON list on stdin: [{ "id", "font", "index", "text", "size", "tracking" }]
#   font = path to a .ttf/.ttc, index = face inside a .ttc, size = em size in card units,
#   tracking = extra space after each letter, in em.
# Writes JSON on stdout: { id: { "d": path with baseline at y=0 and the first letter at x=0, "width" } }
# Needs fontTools (pip install fonttools). Called by build-card.mjs.

import json
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

_fonts = {}


def load(path, index):
    key = (path, index)
    if key not in _fonts:
        _fonts[key] = TTFont(path, fontNumber=index)
    return _fonts[key]


def outline(spec):
    font = load(spec["font"], spec.get("index", 0))
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    k = spec["size"] / font["head"].unitsPerEm
    track = spec.get("tracking", 0) * font["head"].unitsPerEm
    pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    x = 0.0
    text = spec["text"]
    for i, ch in enumerate(text):
        name = cmap.get(ord(ch))
        if name is None:
            raise SystemExit(f'No glyph for "{ch}" in {spec["font"]}')
        glyphs[name].draw(TransformPen(pen, (k, 0, 0, -k, x * k, 0)))
        x += hmtx[name][0]
        if i < len(text) - 1:
            x += track
    return {"d": pen.getCommands(), "width": round(x * k, 2)}


specs = json.load(sys.stdin)
json.dump({s["id"]: outline(s) for s in specs}, sys.stdout)
