// Street banners for Kovur: "Sri Mana Wash, now in Kovur", where the shop is, and the WhatsApp QR
// (say Hi: prices, plans, directions and bills are all there). No prices, dates or offers, so a
// banner stays right for years. English only (the logo's శ్రీ aside):
//   big banner    (10 × 4 ft, ×3)  · main road and junctions
//   street banner (2 × 3 ft, ×15)  · poles, walls, gates: three designs, five of each
//      car       · "Your car, beautifully cared for."
//      bike      · "Bikes & scooters, washed with care."
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
  const markH = 640;
  const markW = markH * (295.1 / 383.5);
  const mark = inline('sri-mana-wash-mark.svg', 180, (H - markH) / 2 - 50, markW, 'bm');
  const tx = 180 + markW + 140;
  const qs = 560;
  const qx = W - 200 - qs;
  const qy = 150;
  const textW = qx - tx - 170; // clear of the QR's glow
  const name = inline('sri-mana-wash-name-on-dark.svg', tx, 280, textW, 'bn');
  const ny = 280 + name.height;
  const body = `${frame(W, H, k, { stars: false })}
<circle cx="${qx + qs / 2}" cy="${qy + qs / 2}" r="${qs * 0.85}" fill="url(#halo)"/>
${mark.svg}
${sparkle(tx + 12, 214, 20)}
<text x="${tx + 52}" y="232" font-family="${SANS}" font-weight="700" font-size="56" letter-spacing="24" fill="url(#foilH)">NOW IN KOVUR</text>
${name.svg}
<text x="${tx}" y="${ny + 150}" font-family="${SERIF}" font-size="118" fill="#FFFFFF">Your car,</text>
<text x="${tx}" y="${ny + 270}" font-family="${SERIF}" font-style="italic" font-size="118" fill="url(#foil)">beautifully cared for.</text>
${ornament(tx + textW / 2, ny + 335, textW, 3)}
<text x="${tx}" y="${ny + 420}" font-family="${SANS}" font-weight="700" font-size="58" letter-spacing="10" fill="#E6EAFF">CAR &amp; BIKE WASH</text>
<text x="${tx}" y="${ny + 492}" font-family="${SANS}" font-size="46" letter-spacing="4" fill="#C4CCF0">${esc(ADDRESS)}</text>
<text x="${tx}" y="${ny + 556}" font-family="${SANS}" font-size="42" letter-spacing="4" fill="#9BAEF5">${esc(HOURS)}</text>
${qrTile(CHAT_URL, qx, qy, qs)}
${sayHi(qx + qs / 2, qy + qs + 140, 104)}
`;
  await write('big-banner-10x4ft', W, H, body, 'Sri Mana Wash street banner, now in Kovur (10 ft × 4 ft)');
}

// ─── Street banners (2 × 3 ft): three designs ────────────────────────────────
// One idea each, big enough to read from across the street, and the same QR on every one.
async function streetBanner(name, label, { eyebrow, line1, line2, art }) {
  const W = 610;
  const H = 915;
  const logo = inline('sri-mana-wash-stacked-on-dark.svg', (W - 250) / 2, 52, 250, `s${name}`);
  let y = 52 + logo.height + 60;
  let body = `${frame(W, H, 1, { stars: false })}${logo.svg}
<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="17" letter-spacing="8" fill="url(#foilH)">${esc(eyebrow)}</text>
<text x="${W / 2}" y="${y + 66}" text-anchor="middle" font-family="${SERIF}" font-size="54" fill="#FFFFFF">${esc(line1)}</text>
<text x="${W / 2}" y="${y + 124}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="52" fill="url(#foil)">${esc(line2)}</text>`;
  y += 150;
  body += art(W / 2, y + 74);
  y += 104;
  const qs = 250;
  const qx = (W - qs) / 2;
  body += `<circle cx="${W / 2}" cy="${y + qs / 2}" r="${qs * 0.8}" fill="url(#halo)"/>`;
  body += qrTile(CHAT_URL, qx, y, qs);
  body += sayHi(W / 2, y + qs + 52, 40);
  body += `<text x="${W / 2}" y="${H - 58}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="14" letter-spacing="2.6" fill="#C4CCF0">${esc(ADDRESS.toUpperCase())}</text>`;
  body += `<text x="${W / 2}" y="${H - 36}" text-anchor="middle" font-family="${SANS}" font-size="13" letter-spacing="2.6" fill="#9BAEF5">${esc(HOURS.toUpperCase())}</text>`;
  await write(`street-banner-${name}-2x3ft`, W, H, body, label);
}

await streetBanner('car', 'Sri Mana Wash street banner: cars (2 ft × 3 ft)', {
  eyebrow: 'NOW IN KOVUR',
  line1: 'Your car,',
  line2: 'beautifully cared for.',
  art: (cx, baseY) => silhouette('mid', cx, baseY, 300),
});
await streetBanner('bike', 'Sri Mana Wash street banner: bikes (2 ft × 3 ft)', {
  eyebrow: 'NOW IN KOVUR',
  line1: 'Bikes & scooters,',
  line2: 'washed with care.',
  art: (cx, baseY) => bikeArt(cx, baseY, 250),
});
await streetBanner('whatsapp', 'Sri Mana Wash street banner: WhatsApp (2 ft × 3 ft)', {
  eyebrow: 'CAR & BIKE WASH · KOVUR',
  line1: 'Prices, plans & bills',
  line2: 'on WhatsApp.',
  art: (cx, baseY) =>
    `<g transform="translate(${cx - 46} ${baseY - 86}) scale(3.8)" color="#F0CF8E">` +
    `<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16a2.5 2.5 0 0 1-2-2.5z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>` +
    `<text x="12" y="12.2" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="6" fill="currentColor">Hi</text></g>`,
});
