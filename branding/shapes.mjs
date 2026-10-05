// The MANA mark's geometry and palette, shared by build-logos.mjs (SVG files) and
// build-android-icon.mjs (launcher icon), so every output is drawn from the same shapes.
//
// A glass water drop: an outer drop, a paler drop-shaped shell inside it with a cleft at the
// top, and a small drop at the centre (drops within a drop, like ripples).
// Coordinates live in a 256 box with the droplet centred on x = 128.

/** Round to 2 decimals for compact path data. */
export const n = (v) => String(Math.round(v * 100) / 100);

// Palette — from packages/ui/src/theme/colors.ts
export const P = {
  waterPale: '#E0F2FE',
  waterLight: '#7DD3FC',
  water: '#0EA5E9',
  waterDeep: '#0369A1',
  waterInk: '#0C4A6E',
  waterMidnight: '#082F49',
  skyBright: '#38BDF8',
  skyMist: '#BAE6FD',
  tealLight: '#5EEAD4',
  amberLight: '#FDE68A',
  amber: '#F59E0B',
  white: '#FFFFFF',
};

/** Colour of the small drop at the centre. 'water' (default) keeps the mark purely water;
 *  MARK_STYLE=gold gives it a warm gold glow instead. */
const STYLE = process.env.MARK_STYLE === 'gold' ? 'gold' : 'water';
export const CORE_STOPS = {
  water: {
    light: [[0, P.skyMist], [1, P.waterLight]], // on the blue counter
    dark: [[0, P.skyMist], [1, P.skyMist]],
    icon: [[0, P.skyBright], [1, P.water]], // on the icon's white counter
  },
  gold: {
    light: [[0, P.amberLight], [1, P.amber]],
    dark: [[0, P.amberLight], [1, P.amber]],
    icon: [[0, P.amberLight], [1, P.amber]],
  },
}[STYLE];

/** The outer water droplet silhouette. */
export const DROP = 'M128 14C128 14 212 96 212 158A84 84 0 0 1 44 158C44 96 128 14 128 14Z';

// ─── Geometry helpers (exact: scaling a Bézier path just scales its points) ──────
const CX = 128;
const CENTRE_Y = 160; // the drop's centre of mass, used to inset the shell
const insetBy = (f) => ([x, y]) => [CX + f * (x - CX), CENTRE_Y + f * (y - CENTRE_Y)];
const mirror = ([x, y]) => [2 * CX - x, y];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const pt = (a) => a.map(n).join(' ');

/** Split a cubic at t and return the part from t to the end (de Casteljau). */
function tail([p0, p1, p2, p3], t) {
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
  const d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t);
  return [f, e, c, p3];
}
const bezier = (p, t) => {
  const u = 1 - t;
  return [0, 1].map((i) => u ** 3 * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t ** 3 * p[3][i]);
};
/** The t at which a cubic (monotonic in y) reaches height y. */
function tAtY(p, y) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (bezier(p, m)[1] < y) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

// ─── The shell: the drop's own contour, inset, opened at the top, with a pointed counter ──
const SHELL_INSET = 0.9; // outer edge of the shell, as a fraction of the drop
const SHELL_TIP_Y = 76; // where the two arm tips end on the outside
const COUNTER_TOP_Y = 92; // where they end on the inside (so the tips are slanted)
const COUNTER_HALF = 24; // half the width of the cleft between the arms
const COUNTER_POINT_Y = 204; // the cleft ends in a point, like a drop pointing down

export const SHELL = (() => {
  const right = [[128, 14], [128, 14], [212, 96], [212, 158]].map(insetBy(SHELL_INSET));
  const [tip, c1, c2, end] = tail(right, tAtY(right, SHELL_TIP_Y));
  const [lTip, lc1, lc2, lEnd] = [tip, c1, c2, end].map(mirror);
  const r = 84 * SHELL_INSET;
  const h = COUNTER_HALF;
  const top = COUNTER_TOP_Y;
  return (
    `M${pt(lTip)}C${pt(lc1)} ${pt(lc2)} ${pt(lEnd)}` + // down the left side
    `A${n(r)} ${n(r)} 0 0 0 ${pt(end)}` + // round the bottom
    `C${pt(c2)} ${pt(c1)} ${pt(tip)}` + // up the right side
    `L${pt([CX + h, top])}` + // slanted tip, across to the cleft
    `C${pt([CX + h + 1, top + 46])} ${pt([CX + h - 2, top + 84])} ${pt([CX, COUNTER_POINT_Y])}` + // down the cleft
    `C${pt([CX - h + 2, top + 84])} ${pt([CX - h - 1, top + 46])} ${pt([CX - h, top])}Z` // and back up
  );
})();

// ─── The core: a slim drop standing in the cleft, its tip rising above the arms ──────────
const CORE_TIP_Y = 56;
const CORE_BOTTOM_Y = 176;
const CORE_HALF = 10;
export const CORE = (() => {
  const body = CORE_TIP_Y + (CORE_BOTTOM_Y - CORE_TIP_Y) * 0.6;
  const h = CORE_HALF;
  return (
    `M${CX} ${CORE_TIP_Y}C${CX} ${CORE_TIP_Y} ${n(CX - h)} ${n(body)} ${n(CX - h)} ${n(CORE_BOTTOM_Y - h)}` +
    `A${h} ${h} 0 0 0 ${n(CX + h)} ${n(CORE_BOTTOM_Y - h)}` +
    `C${n(CX + h)} ${n(body)} ${CX} ${CORE_TIP_Y} ${CX} ${CORE_TIP_Y}Z`
  );
})();

/** A four-point sparkle with curved, pinched sides (used for small ornaments). */
export const sparkle = (cx, cy, r) => {
  const k = r * 0.2;
  return (
    `M${n(cx)} ${n(cy - r)}Q${n(cx + k)} ${n(cy - k)} ${n(cx + r)} ${n(cy)}` +
    `Q${n(cx + k)} ${n(cy + k)} ${n(cx)} ${n(cy + r)}` +
    `Q${n(cx - k)} ${n(cy + k)} ${n(cx - r)} ${n(cy)}` +
    `Q${n(cx - k)} ${n(cy - k)} ${n(cx)} ${n(cy - r)}Z`
  );
};
