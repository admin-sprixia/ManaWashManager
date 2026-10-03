// Generates every MANA logo file in ./logo from one set of shapes, so all variants stay identical.
//   node branding/build-logos.mjs
//
// The mark is a glass water drop: drops within a drop, like ripples (geometry in shapes.mjs).
// Colours are the app's own palette (apps/mobile/src/theme/colors.ts).
// All lettering is drawn as vector paths, never <text>, so the files look the same everywhere
// with no font installed. Set MARK_STYLE=gold for a warm centre drop instead of the water one.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE, CORE_STOPS, DROP, n, P, SHELL, sparkle } from './shapes.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'logo');
mkdirSync(OUT, { recursive: true });

const MARK_VIEWBOX = '0 0 256 256';

const stops = (list) =>
  list.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');

/** Full-colour mark parts. theme: 'light' | 'dark'. `idp` keeps gradient ids unique per file. */
function markColor(theme, idp) {
  const dark = theme === 'dark';
  // The dark droplet stays mid-blue at the bottom so it still stands off a navy background.
  const drop = dark
    ? [[0, P.skyBright], [0.5, P.water], [1, '#0284C7']]
    : [[0, P.waterLight], [0.5, P.water], [1, P.waterDeep]];
  const defs =
    `<linearGradient id="${idp}-drop" x1="0.15" y1="0" x2="0.85" y2="1">${stops(drop)}</linearGradient>` +
    `<linearGradient id="${idp}-shell" x1="0" y1="0" x2="0" y2="1">${stops([[0, P.white], [1, '#DDF3FE']])}</linearGradient>` +
    `<linearGradient id="${idp}-core" x1="0" y1="0" x2="0" y2="1">${stops(CORE_STOPS[dark ? 'dark' : 'light'])}</linearGradient>`;
  const body =
    `<path d="${DROP}" fill="url(#${idp}-drop)"/>` +
    `<path d="${SHELL}" fill="url(#${idp}-shell)"/>` +
    `<path d="${CORE}" fill="url(#${idp}-core)"/>`;
  return { defs, body };
}

/** One-colour mark: the drop with the shell and the centre drop knocked out of it. */
function markMono(color, idp) {
  const defs =
    `<mask id="${idp}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256">` +
    `<rect width="256" height="256" fill="#fff"/>` +
    `<path d="${SHELL}" fill="#000"/>` +
    `<path d="${CORE}" fill="#000"/>` +
    `</mask>`;
  const body = `<path d="${DROP}" fill="${color}" mask="url(#${idp}-cut)"/>`;
  return { defs, body };
}

// ─── Lettering: a geometric, round-ended alphabet (cap height 100, baseline y = 100) ──
const GLYPHS = {
  A: { w: 104, d: 'M0 100L52 0L104 100M18 68H86' },
  M: { w: 122, d: 'M0 100V0L61 68L122 0V100' },
  N: { w: 90, d: 'M0 100V0L90 100V0' },
  H: { w: 86, d: 'M0 0V100M86 0V100M0 50H86' },
  E: { w: 66, d: 'M66 0H0V100H66M0 50H54' },
  R: { w: 84, d: 'M0 100V0H46A27 27 0 0 1 46 54H0M42 54L84 100' },
  C: { w: 90, d: 'M84.8 17.9A48 50 0 1 0 84.8 82.1' },
  G: { w: 98, d: 'M86.5 17.9A49 50 0 1 0 98 50H54' },
  S: { w: 60, d: 'M54 17C48 5 38 0 30 0C13 0 5 11 5 24C5 38 16 44 30 50C44 56 55 62 55 76C55 89 46 100 30 100C17 100 8 93 4 81' },
  W: { w: 148, d: 'M0 0L37 100L74 0L111 100L148 0' },
  ' ': { w: 28, d: '' },
};

/** Lay a string out in a row. Returns glyph x-offsets (in glyph units) and the total width. */
function layoutRow(text, gap) {
  const items = [...text].map((ch) => {
    const g = GLYPHS[ch];
    if (!g) throw new Error(`No glyph for "${ch}"`);
    return g;
  });
  let x = 0;
  const placed = items.map((g, i) => {
    const at = x;
    x += g.w + (i < items.length - 1 ? gap : 0);
    return { ...g, x: at };
  });
  return { placed, width: x };
}

/** Gap (in glyph units) that makes a string exactly `targetPx` wide at scale k. */
function gapToFit(text, k, targetPx) {
  const items = [...text].map((ch) => GLYPHS[ch]);
  const sum = items.reduce((s, g) => s + g.w, 0);
  return (targetPx / k - sum) / (items.length - 1);
}

/**
 * Text as paths, left edge of the first letter at x, baseline at y.
 * cap = cap height in px, stroke = line weight in px. Pass `gap` (glyph units) or `fit` (px width).
 */
function textRow(text, { x, y, cap, stroke, color, gap, fit, anchor = 'start' }) {
  const k = cap / 100;
  const g = fit != null ? gapToFit(text, k, fit) : gap;
  const { placed, width } = layoutRow(text, g);
  const px = width * k;
  const x0 = anchor === 'middle' ? x - px / 2 : x;
  const paths = placed
    .filter((p) => p.d)
    .map((p) => `<path d="${p.d}" transform="translate(${n(x0 + p.x * k)} ${n(y - cap)}) scale(${n(k)})"/>`)
    .join('');
  // Each path is scaled by k, so the stroke width is given in glyph units (stroke / k).
  return {
    svg: `<g fill="none" stroke="${color}" stroke-width="${n(stroke / k)}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`,
    width: px,
    gap: g,
  };
}

// ─── Document helpers ────────────────────────────────────────────────────────
function doc({ viewBox, title, defs = '', body, bg }) {
  const [, , w, h] = viewBox.split(' ').map(Number);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${n(w)}" height="${n(h)}" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    (defs ? `<defs>${defs}</defs>` : '') +
    (bg ?? '') +
    body +
    `</svg>\n`
  );
}

const write = (name, content) => {
  writeFileSync(join(OUT, name), content);
  console.log('wrote', name);
};

// ─── Lockup geometry ─────────────────────────────────────────────────────────
const WORD = 'MANA';
const WORD_CAP = 72;
const WORD_STROKE = 15;
const WORD_GAP = 44; // glyph units
const WORD_WIDTH = layoutRow(WORD, WORD_GAP).width * (WORD_CAP / 100);

const DESC = { text: 'WASH MANAGER', cap: 24 };

/** Colours for text per theme. */
const TEXT = {
  light: { word: P.waterInk, desc: P.waterDeep },
  dark: { word: P.white, desc: P.waterLight },
  inkMono: { word: P.waterInk, desc: P.waterInk },
  whiteMono: { word: P.white, desc: P.white },
};

function markFor(kind, idp) {
  if (kind === 'light' || kind === 'dark') return markColor(kind, idp);
  return markMono(kind === 'inkMono' ? P.waterInk : P.white, idp);
}

function horizontal(kind, idp) {
  const mark = markFor(kind, idp);
  const d = DESC;
  const s = 0.72;
  const markLeft = 44 * s; // droplet's left edge after scaling
  const x0 = 200; // where the text starts
  const dropCenterY = 128 * s;
  const gapBetween = 26;
  const blockH = WORD_CAP + gapBetween + d.cap;
  const wordBase = dropCenterY - blockH / 2 + WORD_CAP;
  const descBase = wordBase + gapBetween + d.cap;
  const t = TEXT[kind];
  const word = textRow(WORD, { x: x0, y: wordBase, cap: WORD_CAP, stroke: WORD_STROKE, color: t.word, gap: WORD_GAP });
  const desc = textRow(d.text, { x: x0, y: descBase, cap: d.cap, stroke: Math.max(3.2, d.cap * 0.14), color: t.desc, fit: word.width });
  const pad = 14;
  const minX = markLeft - pad;
  const width = x0 + word.width + WORD_STROKE / 2 + pad - minX;
  const top = 14 * s - pad;
  const height = 242 * s - 14 * s + pad * 2;
  return doc({
    viewBox: `${n(minX)} ${n(top)} ${n(width)} ${n(height)}`,
    title: 'MANA Wash Manager',
    defs: mark.defs,
    body: `<g transform="scale(${s})">${mark.body}</g>${word.svg}${desc.svg}`,
  });
}

function stacked(kind, idp) {
  const mark = markFor(kind, idp);
  const d = DESC;
  const W = 520;
  const cx = W / 2;
  const t = TEXT[kind];
  const markTx = cx - 128;
  const markTy = 6;
  const dropBottom = markTy + 242;
  const wordBase = dropBottom + 46 + WORD_CAP;
  const descBase = wordBase + 28 + d.cap;
  const word = textRow(WORD, { x: cx, y: wordBase, cap: WORD_CAP, stroke: WORD_STROKE, color: t.word, gap: WORD_GAP, anchor: 'middle' });
  const desc = textRow(d.text, { x: cx, y: descBase, cap: d.cap, stroke: Math.max(3.2, d.cap * 0.14), color: t.desc, fit: word.width, anchor: 'middle' });
  const H = descBase + 24;
  return doc({
    viewBox: `0 0 ${W} ${n(H)}`,
    title: 'MANA Wash Manager',
    defs: mark.defs,
    body: `<g transform="translate(${markTx} ${markTy})">${mark.body}</g>${word.svg}${desc.svg}`,
  });
}

function markOnly(kind, idp) {
  const mark = markFor(kind, idp);
  return doc({ viewBox: MARK_VIEWBOX, title: 'MANA', defs: mark.defs, body: mark.body });
}

// ─── App icon: the mark in white on the app's own gradient, with the hero orbs ──
function appIcon() {
  const defs =
    `<linearGradient id="ic-bg" x1="0" y1="0" x2="1" y2="1">${stops([[0, P.waterLight], [0.45, P.water], [1, P.waterDeep]])}</linearGradient>` +
    `<linearGradient id="ic-drop" x1="0.2" y1="0" x2="0.8" y2="1">${stops([[0, P.white], [1, P.waterPale]])}</linearGradient>` +
    `<linearGradient id="ic-shell" x1="0" y1="0" x2="0" y2="1">${stops([[0, P.water], [1, P.waterDeep]])}</linearGradient>` +
    `<linearGradient id="ic-core" x1="0" y1="0" x2="0" y2="1">${stops(CORE_STOPS.icon)}</linearGradient>`;
  const body =
    `<rect width="512" height="512" fill="url(#ic-bg)"/>` +
    `<circle cx="448" cy="64" r="190" fill="#fff" fill-opacity="0.10"/>` +
    `<circle cx="56" cy="484" r="104" fill="${P.tealLight}" fill-opacity="0.2" stroke="#fff" stroke-opacity="0.14" stroke-width="2"/>` +
    `<g transform="translate(96 100) scale(1.25)">` +
    `<path d="${DROP}" fill="${P.waterInk}" fill-opacity="0.2" transform="translate(0 7)"/>` +
    `<path d="${DROP}" fill="url(#ic-drop)"/>` +
    `<path d="${SHELL}" fill="url(#ic-shell)"/>` +
    `<path d="${CORE}" fill="url(#ic-core)"/>` +
    `</g>`;
  return doc({ viewBox: '0 0 512 512', title: 'MANA Wash Manager app icon', defs, body });
}

// ─── Circular badge / seal: for stamps, uniforms, receipts and stickers ──────────
function badge(kind, idp) {
  const t = TEXT[kind === 'whiteMono' ? 'whiteMono' : kind === 'dark' ? 'dark' : 'light'];
  const ring = kind === 'dark' ? P.waterLight : kind === 'whiteMono' ? P.white : P.waterInk;
  const text = kind === 'dark' ? P.white : kind === 'whiteMono' ? P.white : P.waterInk;
  const mark = markFor(kind === 'whiteMono' ? 'whiteMono' : kind, idp);
  const C0 = 200;
  const cap = 26;
  const stroke = 4.4;
  const k = cap / 100;
  const spark = kind === 'whiteMono' ? P.white : P.amber;

  // `gap` is in glyph units; the longer bottom phrase is set tighter than "MANA" so it fits.
  const arc = (str, { r, top, gap }) => {
    const { placed, width } = layoutRow(str, gap);
    const arcPx = width * k;
    let out = '';
    for (const p of placed) {
      if (!p.d) continue;
      const mid = (p.x + p.w / 2) * k;
      const delta = (mid - arcPx / 2) / r;
      const theta = top ? -Math.PI / 2 + delta : Math.PI / 2 - delta;
      const deg = (theta * 180) / Math.PI;
      const rot = top ? deg + 90 : deg - 90;
      const px = C0 + r * Math.cos(theta);
      const py = C0 + r * Math.sin(theta);
      out += `<path d="${p.d}" transform="translate(${n(px)} ${n(py)}) rotate(${n(rot)}) translate(${n(-(p.w * k) / 2)} ${n(-cap)}) scale(${n(k)})"/>`;
    }
    return out;
  };

  const lettering =
    `<g fill="none" stroke="${text}" stroke-width="${n(stroke / k)}" stroke-linecap="round" stroke-linejoin="round">` +
    arc('MANA', { r: 134, top: true, gap: 46 }) +
    arc('WASH MANAGER', { r: 162, top: false, gap: 30 }) +
    `</g>`;
  // stroke-width above is in glyph units, but each path is scaled by k — so it ends up `stroke` px.

  const s = 0.7;
  const body =
    `<circle cx="${C0}" cy="${C0}" r="190" fill="none" stroke="${ring}" stroke-width="7"/>` +
    `<circle cx="${C0}" cy="${C0}" r="176" fill="none" stroke="${ring}" stroke-opacity="0.45" stroke-width="2"/>` +
    `<circle cx="${C0}" cy="${C0}" r="122" fill="none" stroke="${ring}" stroke-opacity="0.45" stroke-width="2"/>` +
    lettering +
    `<path d="${sparkle(C0 - 149, C0, 9)}" fill="${spark}"/>` +
    `<path d="${sparkle(C0 + 149, C0, 9)}" fill="${spark}"/>` +
    `<g transform="translate(${n(C0 - 128 * s)} ${n(C0 - 128 * s)}) scale(${s})">${mark.body}</g>`;
  return doc({
    viewBox: '0 0 400 400',
    title: 'MANA Wash Manager badge',
    defs: mark.defs,
    body,
  });
}

// ─── Write everything ────────────────────────────────────────────────────────
write('mana-mark.svg', markOnly('light', 'mk'));
write('mana-mark-dark.svg', markOnly('dark', 'mkd'));
write('mana-mark-mono.svg', markOnly('inkMono', 'mkm'));
write('mana-mark-mono-white.svg', markOnly('whiteMono', 'mkw'));

write('mana-logo-horizontal.svg', horizontal('light', 'h'));
write('mana-logo-horizontal-dark.svg', horizontal('dark', 'hd'));
write('mana-logo-horizontal-mono.svg', horizontal('inkMono', 'hm'));
write('mana-logo-horizontal-mono-white.svg', horizontal('whiteMono', 'hw'));

write('mana-logo-stacked.svg', stacked('light', 's'));
write('mana-logo-stacked-dark.svg', stacked('dark', 'sd'));

write('mana-app-icon.svg', appIcon());
write('mana-badge.svg', badge('light', 'b'));
write('mana-badge-dark.svg', badge('dark', 'bd'));
write('mana-badge-mono-white.svg', badge('whiteMono', 'bw'));
