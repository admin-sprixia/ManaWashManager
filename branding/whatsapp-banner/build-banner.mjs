// Builds the picture on top of the WhatsApp welcome message: the Sri Mana Wash logo on the name
// board's indigo night, with "Car & Bike Wash · Kovur" in English and Telugu.
//   node branding/whatsapp-banner/build-banner.mjs
//
// WhatsApp shows a header image at about 1.91:1, so it's 1200 × 628, with everything kept well
// inside the edges. Writes the JPEG the API serves (apps/api/src/assets/whatsapp-banner.jpg) and
// a PNG copy here. Bump BANNER_VERSION in apps/api/src/routes/whatsapp.ts after changing it, since
// WhatsApp caches the picture by its link.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const W = 1200;
const H = 628;

const sparkle = (x, y, r, o) =>
  `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="#F8E2B0" opacity="${o}"/>`;
const dots = [
  [92, 88], [210, 520], [318, 64], [512, 590], [690, 52], [860, 560], [1010, 96], [1120, 470], [150, 330], [1080, 300],
]
  .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 1.6 : 2.4}" fill="#C4CCF0" opacity="${i % 2 ? 0.35 : 0.55}"/>`)
  .join('');

const background = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0.25" y2="1">
    <stop offset="0" stop-color="#1B2878"/><stop offset="0.6" stop-color="#0C1442"/><stop offset="1" stop-color="#060A22"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.36" r="0.55">
    <stop offset="0" stop-color="#5468D4" stop-opacity="0.55"/><stop offset="1" stop-color="#5468D4" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="aqua" cx="0.5" cy="1.05" r="0.6">
    <stop offset="0" stop-color="#5EEAD4" stop-opacity="0.14"/><stop offset="1" stop-color="#5EEAD4" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="rib" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#9BAEF5" stop-opacity="0"/><stop offset="0.25" stop-color="#9BAEF5" stop-opacity="0.55"/>
    <stop offset="0.5" stop-color="#E6EAFF" stop-opacity="0.45"/><stop offset="0.75" stop-color="#9BAEF5" stop-opacity="0.55"/>
    <stop offset="1" stop-color="#9BAEF5" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#E8BF78" stop-opacity="0"/><stop offset="0.5" stop-color="#F8E2B0"/><stop offset="1" stop-color="#E8BF78" stop-opacity="0"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<rect width="${W}" height="${H}" fill="url(#aqua)"/>
${dots}
${sparkle(1060, 120, 16, 0.9)}${sparkle(140, 470, 10, 0.7)}${sparkle(1000, 500, 8, 0.6)}
<path d="M0 560 C 260 520, 420 600, 640 566 S 1000 520, 1200 556" fill="none" stroke="url(#rib)" stroke-width="2.5"/>
<path d="M0 584 C 300 552, 470 618, 700 590 S 1020 556, 1200 584" fill="none" stroke="url(#rib)" stroke-width="1.5" opacity="0.6"/>
<rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="18" fill="none" stroke="#E8BF78" stroke-opacity="0.35" stroke-width="1.5"/>
<rect x="430" y="404" width="340" height="1.6" fill="url(#gold)"/>
<text x="600" y="456" text-anchor="middle" font-family="Avenir Next" font-weight="600" font-size="30" letter-spacing="7" fill="#F8E2B0">CAR &amp; BIKE WASH · KOVUR</text>
<text x="600" y="506" text-anchor="middle" font-family="Telugu Sangam MN" font-size="30" fill="#E6EAFF">కార్ &amp; బైక్ వాష్ · కోవూరు</text>
</svg>`;

const logo = await sharp(join(ROOT, 'branding/sri-mana-wash-logo/sri-mana-wash-stacked-on-dark.png'))
  .resize({ height: 300 })
  .toBuffer();
const { width: lw } = await sharp(logo).metadata();

const banner = sharp(Buffer.from(background)).composite([{ input: logo, left: Math.round((W - lw) / 2), top: 70 }]);
await banner.clone().png().toFile(join(HERE, 'whatsapp-banner.png'));
await banner.clone().jpeg({ quality: 86, mozjpeg: true }).toFile(join(ROOT, 'apps/api/src/assets/whatsapp-banner.jpg'));
console.log('wrote whatsapp-banner.png and apps/api/src/assets/whatsapp-banner.jpg');
