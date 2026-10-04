// Geometry helpers for the logo concepts. Self-contained so the live branding/shapes.mjs stays untouched.
// Coordinates live in a 256 box with the droplet centred on x = 128 (same drop as the live mark).

import { n } from '../shapes.mjs';

export const CX = 128;
const CENTRE_Y = 160;
// Right half of the droplet's upper contour: tip -> widest point.
const RIGHT = [[128, 14], [128, 14], [212, 96], [212, 158]];

const insetBy = (f) => ([x, y]) => [CX + f * (x - CX), CENTRE_Y + f * (y - CENTRE_Y)];
const mirror = ([x, y]) => [2 * CX - x, y];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const pt = (a) => a.map(n).join(' ');

function tail([p0, p1, p2, p3], t) {
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
  const d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t);
  return [f, e, c, p3];
}
const bezier = (p, t) => {
  const u = 1 - t;
  return [0, 1].map((i) => u ** 3 * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t ** 3 * p[3][i]);
};
function tAtY(p, y) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (bezier(p, m)[1] < y) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/** The droplet scaled by f about its centre of mass (a nested drop). */
export function dropAt(f) {
  const [tip, , c2, end] = RIGHT.map(insetBy(f));
  const c1 = tip;
  const [lTip, lc1, lc2, lEnd] = [tip, c1, c2, end].map(mirror);
  const r = 84 * f;
  return (
    `M${pt(tip)}C${pt(c1)} ${pt(c2)} ${pt(end)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${pt(lEnd)}` +
    `C${pt(lc2)} ${pt(lc1)} ${pt(lTip)}Z`
  );
}

/**
 * An open band (a "U") following the droplet's contour between scale fo (outside) and fi (inside),
 * stopping at height yO on the outside. `taper` makes the inner edge meet the outer one at the top
 * so the ends become points (a crescent); otherwise the ends are cut slantwise to height yI.
 */
export function band({ fo, fi, yO, yI = yO + 16, taper = false }) {
  const Ro = RIGHT.map(insetBy(fo));
  const Ri = RIGHT.map(insetBy(fi));
  const [to, co1, co2, eo] = tail(Ro, tAtY(Ro, yO));
  const inner = tail(Ri, tAtY(Ri, taper ? yO : yI));
  if (taper) inner[0] = to;
  const [ti, ci1, ci2, ei] = inner;
  const [lto, lco1, lco2, leo] = [to, co1, co2, eo].map(mirror);
  const [lti, lci1, lci2, lei] = [ti, ci1, ci2, ei].map(mirror);
  const ro = 84 * fo, ri = 84 * fi;
  return (
    `M${pt(lto)}C${pt(lco1)} ${pt(lco2)} ${pt(leo)}` + // down the outer left
    `A${n(ro)} ${n(ro)} 0 0 0 ${pt(eo)}` + // round the outer bottom
    `C${pt(co2)} ${pt(co1)} ${pt(to)}` + // up the outer right
    `L${pt(ti)}` + // across the top
    `C${pt(ci1)} ${pt(ci2)} ${pt(ei)}` + // down the inner right
    `A${n(ri)} ${n(ri)} 0 0 1 ${pt(lei)}` + // round the inner bottom
    `C${pt(lci2)} ${pt(lci1)} ${pt(lti)}Z` // up the inner left
  );
}

/** A slim drop standing upright (tip up, round bottom). */
export function slimDrop(tipY, bottomY, half) {
  const body = tipY + (bottomY - tipY) * 0.6;
  return (
    `M${CX} ${tipY}C${CX} ${tipY} ${n(CX - half)} ${n(body)} ${n(CX - half)} ${n(bottomY - half)}` +
    `A${half} ${half} 0 0 0 ${n(CX + half)} ${n(bottomY - half)}` +
    `C${n(CX + half)} ${n(body)} ${CX} ${tipY} ${CX} ${tipY}Z`
  );
}

/** A four-point glint, taller than it is wide, with pinched sides. */
export function glint(cx, cy, rx, ry, pinch = 0.16) {
  const kx = rx * pinch, ky = ry * pinch;
  return (
    `M${n(cx)} ${n(cy - ry)}Q${n(cx + kx)} ${n(cy - ky)} ${n(cx + rx)} ${n(cy)}` +
    `Q${n(cx + kx)} ${n(cy + ky)} ${n(cx)} ${n(cy + ry)}` +
    `Q${n(cx - kx)} ${n(cy + ky)} ${n(cx - rx)} ${n(cy)}` +
    `Q${n(cx - kx)} ${n(cy - ky)} ${n(cx)} ${n(cy - ry)}Z`
  );
}

/** The droplet's contour at scale f as a dense polyline, from the bottom up the right side, with arc length. */
export function contour(f) {
  const R = RIGHT.map(insetBy(f));
  const cy = CENTRE_Y - 2 * f, r = 84 * f;
  const pts = [];
  for (let a = 0; a <= 90; a += 0.5) {
    const rad = (a * Math.PI) / 180;
    pts.push([CX + r * Math.sin(rad), cy + r * Math.cos(rad)]); // bottom -> widest point
  }
  for (let i = 1; i <= 240; i++) pts.push(bezier(R, 1 - i / 240)); // widest point -> tip
  let s = 0;
  return pts.map((p, i) => {
    if (i > 0) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    return { p, s };
  });
}

/** The point at arc length s along a contour() polyline (null past its end). */
export function atArc(poly, s) {
  for (let i = 1; i < poly.length; i++) {
    if (poly[i].s >= s) {
      const a = poly[i - 1], b = poly[i];
      const t = (s - a.s) / (b.s - a.s || 1);
      return lerp(a.p, b.p, t);
    }
  }
  return null;
}

export const mirrorPt = ([x, y]) => [2 * CX - x, y];
