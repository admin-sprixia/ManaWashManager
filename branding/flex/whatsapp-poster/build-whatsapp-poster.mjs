// Builds the WhatsApp poster for the shop wall (2 ft × 4 ft, portrait, printed as a vinyl sticker):
// the logo, "Your car, beautifully cared for.", a big QR code that opens a chat with 91547 52999
// with "Hi" typed in, and what customers get there. Print-ready SVG, full-size and half-scale PDFs
// (vector, through headless Chrome like the other boards), and a PNG preview.
//   node branding/flex/whatsapp-poster/build-whatsapp-poster.mjs
//
// 1 unit = 1 mm, so the poster is 610 × 1220 units. It scales to any size: keep the 1 : 2 shape.
// Scan the QR on the preview with a phone before printing.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import qrcode from 'qrcode-generator';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGO = join(HERE, '../../sri-mana-wash-logo');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const NUMBER = '91547 52999';
const CHAT_URL = 'https://wa.me/919154752999?text=Hi';
const W = 610;
const H = 1220;
const SANS = 'Avenir Next';
const SERIF = 'Didot';

/** A logo file inlined at (x, y) and `width` wide, its ids prefixed so two logos can't clash. */
function inline(file, x, y, width, prefix) {
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

/** The chat link as a QR code (high error correction, so the badge in the middle is fine). */
function qr(x, y, size) {
  const code = qrcode(0, 'H');
  code.addData(CHAT_URL);
  code.make();
  const n = code.getModuleCount();
  const quiet = 3;
  const m = size / (n + quiet * 2);
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (code.isDark(r, c)) d += `M${(x + (c + quiet) * m).toFixed(3)} ${(y + (r + quiet) * m).toFixed(3)}h${m.toFixed(3)}v${m.toFixed(3)}h-${m.toFixed(3)}z`;
    }
  }
  return `<path d="${d}" fill="#0C1442"/>`;
}

const sparkle = (x, y, r, o = 1) =>
  `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="#F8E2B0" opacity="${o}"/>`;

/** A gold line icon on the 24-unit grid. */
const ICONS = {
  tag: '<path d="M4 12.5V5a1 1 0 0 1 1-1h7.5L20 11.5 12.5 19z" fill="none" stroke="#F0CF8E" stroke-width="1.6" stroke-linejoin="round"/><circle cx="8.5" cy="8.5" r="1.5" fill="#F0CF8E"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" fill="none" stroke="#F0CF8E" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 20.5a2 2 0 0 0 4 0" fill="none" stroke="#F0CF8E" stroke-width="1.6" stroke-linecap="round"/>',
  bill: '<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" fill="none" stroke="#F0CF8E" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5" stroke="#F0CF8E" stroke-width="1.4" stroke-linecap="round"/>',
  calendar: '<rect x="4" y="6" width="16" height="14" rx="2.5" fill="none" stroke="#F0CF8E" stroke-width="1.6"/><path d="M4 10.5h16M8.5 4v4M15.5 4v4" stroke="#F0CF8E" stroke-width="1.6" stroke-linecap="round"/><path d="M9 14.5l2 2 4-4" fill="none" stroke="#F0CF8E" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
};
const feature = (x, y, icon, line1, line2) =>
  `<circle cx="${x + 22}" cy="${y}" r="22" fill="none" stroke="#E8BF78" stroke-opacity="0.55" stroke-width="1.2"/>` +
  `<g transform="translate(${x + 8} ${y - 14}) scale(1.17)">${ICONS[icon]}</g>` +
  `<text x="${x + 58}" y="${y - 3}" font-family="${SANS}" font-weight="600" font-size="17" fill="#FFFFFF">${line1}</text>` +
  `<text x="${x + 58}" y="${y + 18}" font-family="${SANS}" font-size="15" fill="#C4CCF0">${line2}</text>`;

// ─── Layout (top to bottom) ──────────────────────────────────────────────────
const logo = inline('sri-mana-wash-stacked-on-dark.svg', (W - 360) / 2, 60, 360, 'logo');
const tagY = 60 + logo.height + 44;
const QR = 290;
const qrX = (W - QR) / 2;
const qrY = tagY + 266;
const badge = inline('sri-mana-wash-mark.svg', W / 2 - 22, qrY + QR / 2 - 29, 44, 'badge');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" role="img" aria-label="Sri Mana Wash WhatsApp poster">
<title>Sri Mana Wash WhatsApp poster (2 ft × 4 ft)</title>
<defs>
  <linearGradient id="night" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0" stop-color="#1F2E86"/><stop offset="0.5" stop-color="#0E1650"/><stop offset="1" stop-color="#05081C"/>
  </linearGradient>
  <radialGradient id="spot" cx="0.5" cy="0.05" r="0.7">
    <stop offset="0" stop-color="#7E91F0" stop-opacity="0.5"/><stop offset="1" stop-color="#7E91F0" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#9BAEF5" stop-opacity="0.35"/><stop offset="1" stop-color="#9BAEF5" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFF1CF"/><stop offset="0.55" stop-color="#F0CF8E"/><stop offset="1" stop-color="#D2A250"/>
  </linearGradient>
  <linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#E8BF78" stop-opacity="0"/><stop offset="0.5" stop-color="#F8E2B0"/><stop offset="1" stop-color="#E8BF78" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="rib" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#9BAEF5" stop-opacity="0"/><stop offset="0.3" stop-color="#9BAEF5" stop-opacity="0.5"/>
    <stop offset="0.7" stop-color="#9BAEF5" stop-opacity="0.5"/><stop offset="1" stop-color="#9BAEF5" stop-opacity="0"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#night)"/>
<rect width="${W}" height="${H}" fill="url(#spot)"/>
${[[60, 210], [550, 160], [40, 640], [575, 720], [90, 1010], [520, 960], [300, 40]]
  .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 2 ? 1 : 1.6}" fill="#E6EAFF" opacity="0.55"/>`)
  .join('')}
${sparkle(540, 70, 11)}${sparkle(72, 690, 8, 0.8)}${sparkle(545, 640, 7, 0.7)}
<rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="14" fill="none" stroke="#E8BF78" stroke-opacity="0.6" stroke-width="1.2"/>

${logo.svg}
<text x="${W / 2}" y="${tagY}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="15" letter-spacing="7" fill="#C4CCF0">CAR &amp; BIKE WASH · KOVUR</text>

<text x="${W / 2}" y="${tagY + 78}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="14" letter-spacing="7" fill="#9BAEF5">NOW ON WHATSAPP</text>
<rect x="${W / 2 - 34}" y="${tagY + 90}" width="68" height="1.4" fill="url(#gold)"/>
<text x="${W / 2}" y="${tagY + 148}" text-anchor="middle" font-family="${SERIF}" font-size="54" fill="#FFFFFF">Your car,</text>
<text x="${W / 2}" y="${tagY + 206}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="52" fill="url(#gold)">beautifully cared for.</text>

<ellipse cx="${W / 2}" cy="${qrY + QR / 2}" rx="${QR * 0.85}" ry="${QR * 0.75}" fill="url(#halo)"/>
<rect x="${qrX - 14}" y="${qrY - 14}" width="${QR + 28}" height="${QR + 28}" rx="28" fill="none" stroke="url(#gold)" stroke-width="2.2"/>
<rect x="${qrX}" y="${qrY}" width="${QR}" height="${QR}" rx="18" fill="#FFFFFF"/>
${qr(qrX, qrY, QR)}
<rect x="${W / 2 - 34}" y="${qrY + QR / 2 - 34}" width="68" height="68" rx="16" fill="#FFFFFF"/>
<rect x="${W / 2 - 30}" y="${qrY + QR / 2 - 30}" width="60" height="60" rx="13" fill="#1B2878"/>
${badge.svg}

<text x="${W / 2}" y="${qrY + QR + 70}" text-anchor="middle" font-family="${SERIF}" font-size="40" fill="#FFFFFF">Scan &amp; say <tspan font-style="italic" fill="url(#gold)">Hi</tspan></text>
<text x="${W / 2}" y="${qrY + QR + 104}" text-anchor="middle" font-family="${SANS}" font-size="17" fill="#C4CCF0">or WhatsApp <tspan font-weight="700" fill="#FFFFFF">${NUMBER}</tspan>  ·  English or Telugu</text>

<rect x="70" y="${qrY + QR + 132}" width="${W - 140}" height="1" fill="url(#goldLine)"/>
${feature(70, qrY + QR + 182, 'tag', 'Exact prices', 'for your car or bike')}
${feature(330, qrY + QR + 182, 'calendar', 'Monthly plans', 'that save more')}
${feature(70, qrY + QR + 250, 'bell', 'Ready for pickup', 'we tell you on WhatsApp')}
${feature(330, qrY + QR + 250, 'bill', 'Bills in your chat', 'no paper, nothing lost')}

<path d="M0 ${H - 92} C 150 ${H - 120}, 260 ${H - 62}, 400 ${H - 86} S 560 ${H - 110}, ${W} ${H - 90}" fill="none" stroke="url(#rib)" stroke-width="1.6"/>
<path d="M0 ${H - 74} C 170 ${H - 98}, 280 ${H - 46}, 420 ${H - 68} S 570 ${H - 92}, ${W} ${H - 72}" fill="none" stroke="url(#rib)" stroke-width="1" opacity="0.7"/>
<text x="${W / 2}" y="${H - 54}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="13" letter-spacing="3" fill="#C4CCF0">NEAR HIGHWAY · SAI BABA TEMPLE · KOVUR</text>
<text x="${W / 2}" y="${H - 34}" text-anchor="middle" font-family="${SANS}" font-size="12" letter-spacing="3" fill="#9BAEF5">OPEN DAILY 7 AM – 8 PM</text>
</svg>
`;

const svgPath = join(HERE, 'whatsapp-poster-2x4ft.svg');
writeFileSync(svgPath, svg);
await sharp(Buffer.from(svg.replace(`width="${W}mm" height="${H}mm"`, `width="${W * 2}" height="${H * 2}"`)))
  .png()
  .toFile(join(HERE, 'whatsapp-poster-preview.png'));
console.log('wrote whatsapp-poster-2x4ft.svg and whatsapp-poster-preview.png');

if (existsSync(CHROME)) {
  for (const [suffix, scale] of [
    ['', 1],
    ['-half-scale', 0.5],
  ]) {
    const w = `${W * scale}mm`;
    const h = `${H * scale}mm`;
    const htmlPath = join(HERE, `.poster-print${suffix}.html`);
    writeFileSync(
      htmlPath,
      `<!doctype html><meta charset="utf-8"><title>Sri Mana Wash WhatsApp poster</title><style>@page{size:${w} ${h};margin:0}html,body{margin:0;padding:0}img{display:block;width:${w};height:${h}}</style><img src="${pathToFileURL(svgPath).href}">`,
    );
    const out = join(HERE, `whatsapp-poster-2x4ft${suffix}.pdf`);
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files', `--print-to-pdf=${out}`, pathToFileURL(htmlPath).href], { stdio: 'ignore' });
    execFileSync('rm', ['-f', htmlPath]);
    console.log('wrote', `whatsapp-poster-2x4ft${suffix}.pdf`);
  }
}
