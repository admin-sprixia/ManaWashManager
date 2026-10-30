// Street banners for Kovur: "Sri Mana Wash, now in Kovur", where the shop is, and the WhatsApp QR
// (say Hi: prices, plans, directions and bills are all there). No prices, dates or offers, so a
// banner stays right for years. English only (the logo's శ్రీ aside):
//   big banner    (10 × 4 ft, ×3)  · main road and junctions
//   street banner (2 × 3 ft, ×15)  · poles, walls, gates: three designs, five of each
//      ride      · "Where every ride shines." (the visiting card's tagline)
//      care      · "Cars & bikes, washed with care."
//      whatsapp  · "Prices, plans & bills on WhatsApp."
// Each as a print-ready SVG, vector PDF and PNG preview, in Documents (lib/output.mjs).
//   npm run banners
// 1 unit = 1 mm.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputDir } from '../../lib/output.mjs';
import { ADDRESS, bikeArt, CHAT_URL, esc, frame, HOURS, inline, NUMBER, ornament, qrTile, SANS, SERIF, silhouette, sparkle, writer } from '../../lib/poster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const write = writer(outputDir(HERE));

/** "Say Hi on WhatsApp" under or beside a QR: the line, the number, and the hours. */
function sayHi(x, y, size, anchor = 'middle') {
  return (
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${SERIF}" font-size="${size}" fill="#FFFFFF">Scan &amp; say <tspan font-style="italic" fill="url(#foil)">Hi</tspan></text>` +
    `<text x="${x}" y="${y + size * 0.72}" text-anchor="${anchor}" font-family="${SANS}" font-size="${size * 0.36}" letter-spacing="${size * 0.02}" fill="#C4CCF0">prices, plans &amp; directions on WhatsApp</text>` +
    `<text x="${x}" y="${y + size * 1.32}" text-anchor="${anchor}" font-family="${SANS}" font-weight="700" font-size="${size * 0.5}" letter-spacing="${size * 0.03}" fill="#F8E2B0">${NUMBER}</text>`
  );
}

// ─── Big banner (10 × 4 ft) ──────────────────────────────────────────────────
{
  const W = 3048;
  const H = 1219;
  const k = 3.4;
  const markH = 560;
  const markW = markH * (295.1 / 383.5);
  const mark = inline('sri-mana-wash-mark.svg', 170, (H - markH) / 2 - 40, markW, 'bm');
  const tx = 170 + markW + 110;
  const qs = 520;
  const qx = W - 190 - qs;
  const qy = 170;
  const textW = qx - tx - 130; // clear of the QR's glow
  const name = inline('sri-mana-wash-name-on-dark.svg', tx, 250, textW, 'bn');
  const ny = 250 + name.height;
  const body = `${frame(W, H, k, { stars: false })}
<circle cx="${qx + qs / 2}" cy="${qy + qs / 2}" r="${qs * 0.85}" fill="url(#halo)"/>
${mark.svg}
${sparkle(tx + 12, 214, 20)}
<text x="${tx + 52}" y="232" font-family="${SANS}" font-weight="700" font-size="56" letter-spacing="24" fill="url(#foilH)">NOW IN KOVUR</text>
${name.svg}
<text x="${tx}" y="${ny + 170}" font-family="${SERIF}" font-size="124" fill="#FFFFFF">Where every ride <tspan font-style="italic" fill="url(#foil)">shines.</tspan></text>
${ornament(tx + textW / 2, ny + 245, textW, 3)}
<text x="${tx}" y="${ny + 335}" font-family="${SANS}" font-weight="700" font-size="58" letter-spacing="10" fill="#E6EAFF">CAR &amp; BIKE WASH</text>
<text x="${tx}" y="${ny + 405}" font-family="${SANS}" font-size="46" letter-spacing="4" fill="#C4CCF0">${esc(ADDRESS)}</text>
<text x="${tx}" y="${ny + 467}" font-family="${SANS}" font-size="42" letter-spacing="4" fill="#9BAEF5">${esc(HOURS)}</text>
${qrTile(CHAT_URL, qx, qy, qs)}
${sayHi(qx + qs / 2, qy + qs + 140, 104)}
`;
  await write('big-banner-10x4ft', W, H, body, 'Sri Mana Wash street banner, now in Kovur (10 ft × 4 ft)');
}

// ─── Street banners (2 × 3 ft): three designs ────────────────────────────────
// The name first and big, one idea, and the same QR on every one; read from across the street.
async function streetBanner(name, label, { eyebrow, line1, line2, art }) {
  const W = 610;
  const H = 915;
  const markH = 92;
  const markW = markH * (295.1 / 383.5);
  const mark = inline('sri-mana-wash-mark.svg', (W - markW) / 2, 42, markW, `sm${name}`);
  const brand = inline('sri-mana-wash-name-on-dark.svg', 50, 42 + markH + 18, W - 100, `sn${name}`);
  let y = 42 + markH + 18 + brand.height + 14;
  let body = `${frame(W, H, 1, { stars: false })}${mark.svg}${brand.svg}
<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="16" letter-spacing="7" fill="url(#foilH)">${esc(eyebrow)}</text>
<text x="${W / 2}" y="${y + 56}" text-anchor="middle" font-family="${SERIF}" font-size="48" fill="#FFFFFF">${esc(line1)}</text>
<text x="${W / 2}" y="${y + 118}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="58" fill="url(#foil)">${esc(line2)}</text>`;
  y += 140;
  body += art(W / 2, y + 70);
  y += 92;
  const qs = 220;
  const qx = (W - qs) / 2;
  body += `<circle cx="${W / 2}" cy="${y + qs / 2}" r="${qs * 0.8}" fill="url(#halo)"/>`;
  body += qrTile(CHAT_URL, qx, y, qs);
  body += sayHi(W / 2, y + qs + 46, 36);
  body += `<text x="${W / 2}" y="${H - 54}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="14" letter-spacing="2.6" fill="#C4CCF0">${esc(ADDRESS.toUpperCase())}</text>`;
  body += `<text x="${W / 2}" y="${H - 33}" text-anchor="middle" font-family="${SANS}" font-size="13" letter-spacing="2.6" fill="#9BAEF5">${esc(HOURS.toUpperCase())}</text>`;
  await write(`street-banner-${name}-2x3ft`, W, H, body, label);
}

/** A car and a bike side by side. */
const carAndBike = (cx, baseY) => silhouette('mid', cx - 86, baseY, 236) + bikeArt(cx + 156, baseY - 2, 168);

await streetBanner('ride', 'Sri Mana Wash street banner: where every ride shines (2 ft × 3 ft)', {
  eyebrow: 'NOW IN KOVUR',
  line1: 'Where every ride',
  line2: 'shines.',
  art: carAndBike,
});
await streetBanner('care', 'Sri Mana Wash street banner: cars and bikes (2 ft × 3 ft)', {
  eyebrow: 'CAR & BIKE WASH · KOVUR',
  line1: 'Cars & bikes,',
  line2: 'washed with care.',
  art: carAndBike,
});
await streetBanner('whatsapp', 'Sri Mana Wash street banner: WhatsApp (2 ft × 3 ft)', {
  eyebrow: 'NOW IN KOVUR',
  line1: 'Prices, plans & bills',
  line2: 'on WhatsApp.',
  art: (cx, baseY) =>
    `<g transform="translate(${cx - 46} ${baseY - 86}) scale(3.8)" color="#F0CF8E">` +
    `<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16a2.5 2.5 0 0 1-2-2.5z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>` +
    `<text x="12" y="12.2" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="6" fill="currentColor">Hi</text></g>`,
});
