// The MANA mark's geometry and palette, shared by build-logos.mjs (SVG files) and
// build-android-icon.mjs (launcher icon), so every output is drawn from the same shapes.
//
// The mark is a plain water droplet with a Venkateswara namam hidden inside it: a white U with a
// rippled base (water), and a red tapered line between the arms that also reads as a small drop.
// Coordinates live in a 256 box with the droplet centred on x = 128.

/** Round to 2 decimals for compact path data. */
export const n = (v) => String(Math.round(v * 100) / 100);

// Palette — from apps/mobile/src/theme/colors.ts, plus the namam's red.
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
  namamRed: '#E11D2A',
  white: '#FFFFFF',
};

/** The water droplet silhouette. */
export const DROP = 'M128 14C128 14 212 96 212 158A84 84 0 0 1 44 158C44 96 128 14 128 14Z';

// ─── The namam ───────────────────────────────────────────────────────────────
// Described as the left half only; the right half is its mirror image.
const CX = 128;
const mx = (x) => 2 * CX - x;

// The namam is drawn at full size below, then scaled about its own centre so it sits inside the
// droplet with a little room around it.
const FIT = 0.94;
const CY = 150;
const tx = (x) => CX + (x - CX) * FIT;
const ty = (y) => CY + (y - CY) * FIT;
const scaleSegs = (segs) =>
  segs.map(([c, ...v]) => [c, ...v.map((val, i) => (i % 2 === 0 ? tx(val) : ty(val)))]);

// Outer contour, from the top-left corner down the arm, round the rippled base, to the centre.
const OUTER_START = [tx(76), ty(112)];
const OUTER = scaleSegs([
  ['L', 86, 176],
  ['C', 86, 187, 92, 192, 99, 189], // outer foot
  ['C', 104, 187, 107, 183, 113, 186], // ripple
  ['C', 119, 189, 122, 205, 128, 205], // down to the lowest point of the base
]);
// Inner contour (the U's counter), from the top of the inner edge to the centre of its bottom.
const INNER_START = [tx(106), ty(112)];
const INNER = scaleSegs([
  ['L', 113, 152],
  ['C', 113, 168, 118, 176, 128, 176],
]);

const fmt = (cmd, ...v) => `${cmd}${v.map(n).join(' ')}`;
const mirrored = (segs) => segs.map(([c, ...v]) => [c, ...v.map((val, i) => (i % 2 === 0 ? mx(val) : val))]);

/** Walk a segment list backwards: same curve, opposite direction. */
function reversed(start, segs) {
  const out = [];
  let from = start;
  const froms = segs.map((s) => {
    const f = from;
    from = s.slice(-2);
    return f;
  });
  for (let i = segs.length - 1; i >= 0; i--) {
    const [c, ...v] = segs[i];
    const f = froms[i];
    if (c === 'L') out.push(['L', f[0], f[1]]);
    else out.push(['C', v[2], v[3], v[0], v[1], f[0], f[1]]);
  }
  return out;
}

const seg = (list) => list.map(([c, ...v]) => fmt(c, ...v)).join('');

/** The two white arms joined by the rippled base, as one closed shape. */
export const NAMAM_ARMS = (() => {
  const outerRight = reversed(
    [mx(OUTER_START[0]), OUTER_START[1]],
    mirrored(OUTER),
  );
  const innerRightForward = mirrored(INNER);
  const innerLeftBack = reversed(INNER_START, INNER);
  return (
    `M${n(OUTER_START[0])} ${n(OUTER_START[1])}` +
    seg(OUTER) +
    seg(outerRight) +
    fmt('L', mx(INNER_START[0]), INNER_START[1]) +
    seg(innerRightForward) +
    seg(innerLeftBack) +
    'Z'
  );
})();

/** The red line between the arms: a slim, pointed drop. */
export const NAMAM_DROP =
  `M128 ${n(ty(94))}C128 ${n(ty(94))} ${n(tx(118.5))} ${n(ty(134))} ${n(tx(118.5))} ${n(ty(154))}` +
  `A${n(9.5 * FIT)} ${n(9.5 * FIT)} 0 0 0 ${n(tx(137.5))} ${n(ty(154))}` +
  `C${n(tx(137.5))} ${n(ty(134))} 128 ${n(ty(94))} 128 ${n(ty(94))}Z`;

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
