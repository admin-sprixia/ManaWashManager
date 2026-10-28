// Builds the picture on top of the WhatsApp welcome message ("Editorial"): "Now on WhatsApp", the
// headline "Your car, beautifully cared for.", what customers get on WhatsApp in this version, and
// the glass drop standing on a glossy floor under a soft spotlight. Nothing about doorstep washes or
// booking until those launch.
//   node branding/whatsapp-banner/build-banner.mjs
//
// WhatsApp shows a header image at about 1.91:1, so it's 1200 × 628 (drawn at 2× for sharpness).
// Writes the JPEG the API serves (apps/api/src/assets/whatsapp-banner.jpg) and a PNG copy here.
// Bump BANNER_VERSION in apps/api/src/routes/whatsapp.ts after changing it, since WhatsApp caches
// the picture by its link.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGO = join(HERE, '../sri-mana-wash-logo');
const W = 1200;
const H = 628;
const S = 2; // drawn at 2× for crisp edges
const SANS = 'Avenir Next';
const SERIF = 'Didot';
const TELUGU = 'Telugu Sangam MN';

const defs = `
<linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#121C5A"/><stop offset="0.55" stop-color="#0A1140"/><stop offset="1" stop-color="#04071C"/>
</linearGradient>
<radialGradient id="spot" cx="0.5" cy="0.02" r="0.75">
  <stop offset="0" stop-color="#7E91F0" stop-opacity="0.55"/><stop offset="0.45" stop-color="#3A4DB0" stop-opacity="0.18"/><stop offset="1" stop-color="#3A4DB0" stop-opacity="0"/>
</radialGradient>
<radialGradient id="pool" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0" stop-color="#9BAEF5" stop-opacity="0.35"/><stop offset="1" stop-color="#9BAEF5" stop-opacity="0"/>
</radialGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#1A2670" stop-opacity="0"/><stop offset="0.25" stop-color="#16205E" stop-opacity="0.85"/><stop offset="1" stop-color="#03051A"/>
</linearGradient>
<linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#E8BF78" stop-opacity="0"/><stop offset="0.5" stop-color="#F8E2B0"/><stop offset="1" stop-color="#E8BF78" stop-opacity="0"/>
</linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFF1CF"/><stop offset="0.55" stop-color="#F0CF8E"/><stop offset="1" stop-color="#D2A250"/>
</linearGradient>
<radialGradient id="bead" cx="0.35" cy="0.3" r="0.75">
  <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.95"/><stop offset="0.35" stop-color="#C4CCF0" stop-opacity="0.55"/><stop offset="1" stop-color="#5468D4" stop-opacity="0.15"/>
</radialGradient>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
<filter id="haze" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
<filter id="blur2"><feGaussianBlur stdDeviation="1.2"/></filter>
`;

/** A glass water bead with a highlight. */
const bead = (x, y, r, o = 1) =>
  `<g opacity="${o}"><circle cx="${x}" cy="${y}" r="${r}" fill="url(#bead)"/>` +
  `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#E6EAFF" stroke-opacity="0.5" stroke-width="${Math.max(0.6, r / 10)}"/>` +
  `<ellipse cx="${x - r * 0.32}" cy="${y - r * 0.38}" rx="${r * 0.28}" ry="${r * 0.18}" fill="#FFFFFF" opacity="0.9"/></g>`;

/** Ripples on the floor around (cx, cy). */
const ripples = (cx, cy, n, rx0, step, ratio = 0.16) =>
  Array.from({ length: n }, (_, i) => {
    const rx = rx0 + i * step;
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx * ratio}" fill="none" stroke="#C4CCF0" stroke-opacity="${(0.55 * (1 - i / n)).toFixed(2)}" stroke-width="${(1.6 - i * 0.12).toFixed(2)}"/>`;
  }).join('');

const diamond = (x, y, r = 4) => `<path d="M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z" fill="url(#gold)"/>`;

const frame = `<rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="14" fill="none" stroke="url(#goldLine)" stroke-opacity="0.55" stroke-width="1.2"/>`;

const stars = [[60, 70], [210, 40], [980, 54], [1140, 120], [90, 250], [1110, 300], [330, 110], [870, 150]]
  .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 1.1 : 1.7}" fill="#E6EAFF" opacity="${i % 2 ? 0.35 : 0.6}"/>`)
  .join('');

async function render(file, svg, overlays) {
  const base = sharp(Buffer.from(svg));
  const layers = await Promise.all(
    overlays.map(async (o) => {
      let img = sharp(o.file).resize(o.width ? { width: Math.round(o.width * S) } : { height: Math.round(o.height * S) });
      if (o.flip) img = img.flip();
      let buf = await img.png().toBuffer();
      if (o.opacity != null || o.fade) {
        const m = await sharp(buf).metadata();
        const mask = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${o.opacity ?? 1}"/><stop offset="${o.fade ?? 1}" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#f)"/></svg>`,
        );
        buf = await sharp(buf).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
      }
      return { input: buf, left: Math.round(o.left * S), top: Math.round(o.top * S) };
    }),
  );
  const out = await base.composite(layers).png().toBuffer();
  await sharp(out).resize(W, H).png().toFile(join(HERE, `${file}.png`));
  await sharp(out).resize(W, H).jpeg({ quality: 90, mozjpeg: true }).toFile(join(HERE, '../../apps/api/src/assets/whatsapp-banner.jpg'));
  console.log(`wrote ${file}.png and apps/api/src/assets/whatsapp-banner.jpg`);
}

// ─── The banner ──────────────────────────────────────────────────────────────
{
  const mx = 905;
  const floorY = 452;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * S}" height="${H * S}" viewBox="0 0 ${W} ${H}">
<defs>${defs}
  <linearGradient id="fadeLg" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="0.7" stop-color="#fff" stop-opacity="1"/>
  </linearGradient>
  <mask id="fadeL"><rect width="${W}" height="${H}" fill="url(#fadeLg)"/></mask>
  <radialGradient id="spotR" cx="0.75" cy="0.05" r="0.7">
    <stop offset="0" stop-color="#7E91F0" stop-opacity="0.6"/><stop offset="0.5" stop-color="#3A4DB0" stop-opacity="0.15"/><stop offset="1" stop-color="#3A4DB0" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#night)"/>
<rect width="${W}" height="${H}" fill="url(#spotR)"/>
${stars}
<path d="M${mx - 50} 0 L${mx - 230} ${floorY} L${mx + 230} ${floorY} L${mx + 50} 0Z" fill="#9BAEF5" opacity="0.08" filter="url(#haze)"/>
<rect x="0" y="${floorY - 8}" width="${W}" height="${H - floorY + 8}" fill="url(#floor)" mask="url(#fadeL)"/>
<ellipse cx="${mx}" cy="${floorY + 4}" rx="220" ry="34" fill="url(#pool)"/>
${ripples(mx, floorY + 4, 6, 90, 50)}
<ellipse cx="${mx}" cy="${floorY + 2}" rx="56" ry="7" fill="#02030F" opacity="0.55" filter="url(#blur2)"/>
${bead(mx - 190, floorY + 14, 6, 0.8)}${bead(mx + 200, floorY + 4, 4.5, 0.7)}${bead(mx + 140, floorY + 24, 3, 0.6)}
<text x="72" y="190" font-family="${SANS}" font-weight="600" font-size="15" letter-spacing="8" fill="#C4CCF0">NOW ON WHATSAPP</text>
<rect x="72" y="206" width="64" height="1.5" fill="url(#gold)"/>
<text x="68" y="282" font-family="${SERIF}" font-size="66" fill="#FFFFFF">Your car,</text>
<text x="68" y="356" font-family="${SERIF}" font-style="italic" font-size="66" fill="url(#gold)">beautifully cared for.</text>
<g font-family="${SANS}" font-size="19" fill="#E6EAFF">
  ${diamond(80, 410)}<text x="96" y="417">Exact prices for your model</text>
  ${diamond(80, 446)}<text x="96" y="453">Monthly plans that save more</text>
  ${diamond(80, 482)}<text x="96" y="489">Bills &amp; pickup alerts in your chat</text>
</g>
<rect x="72" y="526" width="300" height="50" rx="25" fill="none" stroke="url(#gold)" stroke-width="1.4"/>
<text x="222" y="558" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="17" letter-spacing="3" fill="#F8E2B0">SAY HI  ·  <tspan font-family="${TELUGU}" letter-spacing="0">తెలుగు</tspan> / ENGLISH</text>
${frame}
</svg>`;
  const markH = 250;
  const markW = (markH * 1200) / 1559;
  await render('whatsapp-banner', svg, [
    { file: join(LOGO, 'sri-mana-wash-mark.png'), height: markH, left: mx - markW / 2, top: floorY - markH + 16 },
    { file: join(LOGO, 'sri-mana-wash-mark.png'), height: markH * 0.5, left: mx - (markW * 0.5) / 2, top: floorY + 8, flip: true, opacity: 0.2, fade: 0.6 },
    { file: join(LOGO, 'sri-mana-wash-name-on-dark.png'), width: 360, left: 70, top: 58 },
  ]);
}
