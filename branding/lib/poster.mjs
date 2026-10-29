// The shop's printed pieces share one look: the night-indigo background, gold foil, Didot and
// Avenir Next, the Sri Mana Wash logo files, QR tiles with the drop in the middle. Posters
// (flex/shop-posters) and street banners (flex/street-banners) draw with these. 1 unit = 1 mm.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import qrcode from 'qrcode-generator';
import sharp from 'sharp';

const LOGO = join(dirname(fileURLToPath(import.meta.url)), '../sri-mana-wash-logo');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const SANS = 'Avenir Next';
export const SERIF = 'Didot';
export const NUMBER = '91547 52999';
export const CHAT_URL = 'https://wa.me/919154752999?text=Hi';
export const ADDRESS = 'Near Highway · Sai Baba Temple · Kovur';
export const HOURS = '7 AM – 8 PM · Closed Mondays';

// ─── Shared drawing ──────────────────────────────────────────────────────────
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function inline(file, x, y, width, prefix) {
  const src = readFileSync(join(LOGO, file), 'utf8');
  const [, vw, vh] = src.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const height = (width * Number(vh)) / Number(vw);
  const body = src
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`);
  return { svg: `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 ${vw} ${vh}" overflow="visible">${body}</svg>`, height };
}

let badgeN = 0;
/** A QR code on a white tile with the drop in the middle (high error correction). */
export function qrTile(data, x, y, size, { badge = true } = {}) {
  const code = qrcode(0, 'H');
  code.addData(data);
  code.make();
  const n = code.getModuleCount();
  const quiet = 3;
  const m = size / (n + quiet * 2);
  let d = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (code.isDark(r, c)) d += `M${(x + (c + quiet) * m).toFixed(3)} ${(y + (r + quiet) * m).toFixed(3)}h${m.toFixed(3)}v${m.toFixed(3)}h-${m.toFixed(3)}z`;
  const b = size * 0.2;
  const mark = badge ? inline('sri-mana-wash-mark.svg', x + size / 2 - b * 0.32, y + size / 2 - b * 0.42, b * 0.64, `qb${badgeN++}`) : null;
  return (
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.06}" fill="#FFFFFF"/><path d="${d}" fill="#0C1442"/>` +
    (badge
      ? `<rect x="${x + size / 2 - b / 2 - size * 0.015}" y="${y + size / 2 - b / 2 - size * 0.015}" width="${b + size * 0.03}" height="${b + size * 0.03}" rx="${b * 0.24}" fill="#FFFFFF"/>` +
        `<rect x="${x + size / 2 - b / 2}" y="${y + size / 2 - b / 2}" width="${b}" height="${b}" rx="${b * 0.2}" fill="#1B2878"/>${mark.svg}`
      : '')
  );
}

/** A placeholder where a QR will go, until its link is filled in. */
export const qrPlaceholder = (x, y, size, what) =>
  `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.06}" fill="#FFFFFF" fill-opacity="0.08" stroke="#F0CF8E" stroke-width="${size * 0.008}" stroke-dasharray="${size * 0.04} ${size * 0.03}"/>` +
  `<text x="${x + size / 2}" y="${y + size / 2 - size * 0.03}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${size * 0.07}" fill="#F8E2B0">ADD ${esc(what)}</text>` +
  `<text x="${x + size / 2}" y="${y + size / 2 + size * 0.07}" text-anchor="middle" font-family="${SANS}" font-size="${size * 0.05}" fill="#C4CCF0">then build again</text>`;

export const sparkle = (x, y, r, o = 1, fill = '#F8E2B0') =>
  `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${fill}" opacity="${o}"/>`;

export const DEFS = `
<linearGradient id="night" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#1F2E86"/><stop offset="0.5" stop-color="#0E1650"/><stop offset="1" stop-color="#05081C"/></linearGradient>
<radialGradient id="spot" cx="0.5" cy="0.04" r="0.75"><stop offset="0" stop-color="#7E91F0" stop-opacity="0.5"/><stop offset="1" stop-color="#7E91F0" stop-opacity="0"/></radialGradient>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF1CF"/><stop offset="0.55" stop-color="#F0CF8E"/><stop offset="1" stop-color="#D2A250"/></linearGradient>
<linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E8BF78" stop-opacity="0"/><stop offset="0.5" stop-color="#F8E2B0"/><stop offset="1" stop-color="#E8BF78" stop-opacity="0"/></linearGradient>
<linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.09"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0.03"/></linearGradient>
<linearGradient id="foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9C7536"/><stop offset="0.22" stop-color="#E9C987"/><stop offset="0.45" stop-color="#FFF4DA"/><stop offset="0.62" stop-color="#E2BD76"/><stop offset="1" stop-color="#A37C3C"/></linearGradient>
<linearGradient id="foilH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#B8904A"/><stop offset="0.3" stop-color="#F3D9A0"/><stop offset="0.5" stop-color="#FFF6E0"/><stop offset="0.7" stop-color="#EBCB8C"/><stop offset="1" stop-color="#B8904A"/></linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.11"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0.025"/></linearGradient>
<radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#7E91F0" stop-opacity="0.35"/><stop offset="1" stop-color="#7E91F0" stop-opacity="0"/></radialGradient>
<linearGradient id="glow" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F0CF8E" stop-opacity="0"/><stop offset="0.5" stop-color="#F0CF8E" stop-opacity="0.13"/><stop offset="1" stop-color="#F0CF8E" stop-opacity="0"/></linearGradient>
<linearGradient id="hair" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9BAEF5" stop-opacity="0"/><stop offset="0.12" stop-color="#9BAEF5" stop-opacity="0.32"/><stop offset="0.88" stop-color="#9BAEF5" stop-opacity="0.32"/><stop offset="1" stop-color="#9BAEF5" stop-opacity="0"/></linearGradient>
<linearGradient id="rib" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9BAEF5" stop-opacity="0"/><stop offset="0.3" stop-color="#9BAEF5" stop-opacity="0.5"/><stop offset="0.7" stop-color="#9BAEF5" stop-opacity="0.5"/><stop offset="1" stop-color="#9BAEF5" stop-opacity="0"/></linearGradient>`;

/** The night background, spotlight, stars and gold frame every poster shares. */
export function frame(W, H, k = 1, { stars: withStars = true } = {}) {
  const stars = (withStars ? [[0.1, 0.18], [0.9, 0.12], [0.06, 0.55], [0.94, 0.6], [0.15, 0.85], [0.85, 0.82], [0.5, 0.03]]
    .map(([x, y], i) => `<circle cx="${x * W}" cy="${y * H}" r="${(i % 2 ? 0.8 : 1.3) * k}" fill="#E6EAFF" opacity="0.55"/>`)
    .join('') : '');
  const inset = 14 * k;
  return (
    `<rect width="${W}" height="${H}" fill="url(#night)"/><rect width="${W}" height="${H}" fill="url(#spot)"/>${stars}` +
    `<rect x="${inset}" y="${inset}" width="${W - inset * 2}" height="${H - inset * 2}" rx="${12 * k}" fill="none" stroke="#E8BF78" stroke-opacity="0.6" stroke-width="${1.1 * k}"/>`
  );
}

/** Ribbon of water lines along the bottom. */
export const ribbon = (W, y, k = 1) =>
  `<path d="M0 ${y} C ${W * 0.25} ${y - 28 * k}, ${W * 0.42} ${y + 30 * k}, ${W * 0.66} ${y + 4 * k} S ${W * 0.9} ${y - 20 * k}, ${W} ${y}" fill="none" stroke="url(#rib)" stroke-width="${1.5 * k}"/>` +
  `<path d="M0 ${y + 18 * k} C ${W * 0.28} ${y - 8 * k}, ${W * 0.45} ${y + 44 * k}, ${W * 0.7} ${y + 22 * k} S ${W * 0.92} ${y - 2 * k}, ${W} ${y + 20 * k}" fill="none" stroke="url(#rib)" stroke-width="${k}" opacity="0.7"/>`;

export const ICONS = {
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 9v6M18.5 9v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 18.5h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  gold: '<path d="M12 21c-4 0-7-2.6-7-6.2C5 10.6 9 7 12 5c3 2 7 5.6 7 9.8 0 3.6-3 6.2-7 6.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 3l3 2 3-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="14" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  docs: '<path d="M7 2.5h7l4 4v15H7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 2.5v4h4M9.5 11h6M9.5 14h6M9.5 17h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  keys: '<circle cx="8" cy="9" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11.2 12.2 20 21M16.5 17.5l2-2M18.5 19.5l2-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  glasses: '<circle cx="7" cy="14" r="3.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="17" cy="14" r="3.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.6 14h2.8M3.4 13l1.6-6M20.6 13l-1.6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  wash: '<path d="M12 3c-3 4-5 6.6-5 9.4a5 5 0 0 0 10 0C17 9.6 15 7 12 3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.5 13a2.5 2.5 0 0 0 2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  chat: '<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16a2.5 2.5 0 0 1-2-2.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 10.5l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  car: '<path d="M4 14l1.6-4.6A2 2 0 0 1 7.5 8h9a2 2 0 0 1 1.9 1.4L20 14v4h-2.2a2 2 0 0 1-3.6 0H9.8a2 2 0 0 1-3.6 0H4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="18" r="1.5" fill="currentColor"/><circle cx="16" cy="18" r="1.5" fill="currentColor"/>',
  bill: '<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  star: '<path d="M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.3L12 15.8l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" fill="currentColor"/>',
  calendar: '<rect x="4" y="6" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 10.5h16M8.5 4v4M15.5 4v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9 14.5l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
};
/** An icon in a gold ring, centred on (cx, cy), `r` its ring's radius. */
export const ringIcon = (name, cx, cy, r, color = '#F0CF8E') =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF" fill-opacity="0.05" stroke="#E8BF78" stroke-opacity="0.6" stroke-width="${r * 0.05}"/>` +
  `<g color="${color}" transform="translate(${cx - r * 0.62} ${cy - r * 0.62}) scale(${(r * 1.24) / 24})">${ICONS[name]}</g>`;

/** A gold hairline with a small diamond in the middle. */
export const ornament = (cx, y, w, k = 1) =>
  `<rect x="${cx - w / 2}" y="${y - 0.6 * k}" width="${w}" height="${1.2 * k}" fill="url(#goldLine)"/>` +
  `<path d="M${cx} ${y - 5 * k}L${cx + 5 * k} ${y}L${cx} ${y + 5 * k}L${cx - 5 * k} ${y}Z" fill="url(#foil)"/>`;

/** Side views, 140 × 56, standing on y = 44: a small car, a mid-size sedan, a big SUV, a bike. */
export const SILHOUETTES = {
  small: {
    body: 'M14 44H22A9 9 0 0 1 40 44H84A9 9 0 0 1 102 44H112Q116 44 116 39V33Q116 28 110 27L104 26Q98 14 88 13H56Q48 13 40 22L22 26Q14 28 14 34Z',
    glass: 'M44 24Q50 17 57 17H70V24ZM74 17H87Q94 17 98 24H74Z',
    wheels: [31, 93],
  },
  mid: {
    body: 'M6 44H18A9 9 0 0 1 36 44H96A9 9 0 0 1 114 44H128Q132 44 132 39V34Q132 30 127 29L112 27Q104 15 92 14H62Q52 14 44 23L18 27Q6 29 6 35Z',
    glass: 'M48 25Q54 18 62 18H76V25ZM80 18H91Q99 18 105 25H80Z',
    wheels: [27, 105],
  },
  large: {
    body: 'M8 44H20A9 9 0 0 1 38 44H92A9 9 0 0 1 110 44H124Q128 44 128 39V28Q128 23 123 22L116 21L106 8Q104 5 99 5H40Q34 5 31 9L23 21L13 23Q8 24 8 30Z',
    glass: 'M35 20L42 10H66V20ZM70 10H98Q101 10 103 13L108 20H70Z',
    wheels: [29, 101],
  },
};
/** A gold line-art side view of `kind`, `w` wide, centred on cx with its wheels on `baseY`. */
export function silhouette(kind, cx, baseY, w, color = '#F0CF8E') {
  const s = SILHOUETTES[kind];
  const k = w / 140;
  const sw = 1.6 / k;
  return (
    `<g transform="translate(${cx - 70 * k} ${baseY - 53 * k}) scale(${k})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round">` +
    `<path d="${s.body}"/><path d="${s.glass}" fill="${color}" fill-opacity="0.16"/>` +
    s.wheels.map((x) => `<circle cx="${x}" cy="44" r="6.6"/><circle cx="${x}" cy="44" r="2.2" fill="${color}"/>`).join('') +
    `<path d="M0 53.5H140" stroke-opacity="0.35"/></g>`
  );
}
/** A motorbike in gold line art, `w` wide, centred on cx, wheels on baseY. */
export function bikeArt(cx, baseY, w, color = '#F0CF8E') {
  const k = w / 120;
  return (
    `<g transform="translate(${cx - 60 * k} ${baseY - 50 * k}) scale(${k})" fill="none" stroke="${color}" stroke-width="${1.7 / k}" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="22" cy="38" r="12"/><circle cx="98" cy="38" r="12"/><circle cx="22" cy="38" r="2.4" fill="${color}"/><circle cx="98" cy="38" r="2.4" fill="${color}"/>` +
    `<path d="M22 38L44 22H70L84 14M84 14L98 38M44 22L54 38H76L70 22M84 14H92M58 18H74Q80 18 80 22"/><path d="M40 16Q48 12 58 14" stroke-width="${2.4 / k}"/></g>`
  );
}

// ─── Output ──────────────────────────────────────────────────────────────────
/**
 * A writer into folder `out`: each piece as a print-ready SVG, a vector PDF (headless Chrome) and
 * a PNG preview. ONLY=name,… builds just those; NO_PDF=1 skips the PDFs (quick previews).
 */
export function writer(out) {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  return async function write(name, W, H, body, label) {
    if (only && !only.includes(name)) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
<defs>${DEFS}</defs>
${body}
</svg>
`;
    const svgPath = join(out, `${name}.svg`);
    writeFileSync(svgPath, svg);
    const px = Math.round(Math.min(2400 / Math.max(W, H), 6) * 100) / 100;
    await sharp(Buffer.from(svg.replace(`width="${W}mm" height="${H}mm"`, `width="${Math.round(W * px)}" height="${Math.round(H * px)}"`)))
      .png()
      .toFile(join(out, `${name}-preview.png`));
    if (existsSync(CHROME) && !process.env.NO_PDF) {
      const htmlPath = join(out, `.${name}.html`);
      writeFileSync(
        htmlPath,
        `<!doctype html><meta charset="utf-8"><title>${esc(label)}</title><style>@page{size:${W}mm ${H}mm;margin:0}html,body{margin:0;padding:0}img{display:block;width:${W}mm;height:${H}mm}</style><img src="${pathToFileURL(svgPath).href}">`,
      );
      execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files', `--print-to-pdf=${join(out, `${name}.pdf`)}`, pathToFileURL(htmlPath).href], { stdio: 'ignore' });
      execFileSync('rm', ['-f', htmlPath]);
    }
    console.log(`wrote ${name} (${W} × ${H} mm)`);
  };
}
