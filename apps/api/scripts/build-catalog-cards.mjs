// Draws the WhatsApp catalog's pictures: one styled card per product (no photos), with its name,
// the kind of vehicle, what's included and the time or saving, in the brand's indigo and gold.
// Reads the products from the API (GET /whatsapp/catalog.json) and uploads each card to the photos
// bucket as catalog/<id>.jpg, where GET /whatsapp/catalog/<id>.jpg serves it. Run after the menu
// changes (a new service, a renamed one, a new checklist).
//   node scripts/build-catalog-cards.mjs --staging     (or local; --dry writes them to .wrangler/catalog-cards only)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { API, apiFetch, API_DIR, STAGING } from './lib/target.mjs';

const DRY = process.argv.includes('--dry');
const BUCKET = STAGING ? 'mana-files-staging' : 'mana-files';
const OUT = fileURLToPath(new URL('../.wrangler/catalog-cards/', import.meta.url));
const LOGO = fileURLToPath(new URL('../../../branding/sri-mana-wash-logo/sri-mana-wash-name-on-dark.png', import.meta.url));
const S = 1080;
const SANS = 'Avenir Next';
const SERIF = 'Didot';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Greedy word wrap to about `max` characters a line. */
function wrap(text, max) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

function card(p, place) {
  // "Shine Plan · 3 months" breaks at its dot; other long names wrap.
  const titleLines = (p.title.includes(' · ') ? p.title.split(' · ') : wrap(p.title, 16)).slice(0, 2);
  const titleSize = titleLines.length > 1 ? 82 : 96;
  let y = 385;
  const title = titleLines
    .map((l, i) => `<text x="80" y="${y + i * (titleSize + 6)}" font-family="${SERIF}" font-size="${titleSize}" fill="#FFFFFF">${esc(l)}</text>`)
    .join('');
  y += (titleLines.length - 1) * (titleSize + 6) + 64;
  const subtitle = p.card.subtitle && p.kind === 'service'
    ? wrap(p.card.subtitle, 44).slice(0, 2).map((l, i) => `<text x="80" y="${y + i * 44}" font-family="${SANS}" font-size="34" fill="#C4CCF0">${esc(l)}</text>`).join('')
    : '';
  if (subtitle) y += (Math.min(2, wrap(p.card.subtitle, 44).length) - 1) * 44 + 40;
  y += 20;
  const rule = `<rect x="80" y="${y}" width="140" height="3" fill="url(#gold)"/>`;
  y += 70;
  const lines = p.card.lines.slice(0, p.kind === 'plan' ? 5 : 7);
  const step = lines.length > 5 ? 58 : 66;
  const items = lines
    .map((l, i) => {
      const ly = y + i * step;
      return (
        `<circle cx="102" cy="${ly - 11}" r="19" fill="#E8BF78" opacity="0.18"/>` +
        `<path d="M93 ${ly - 11} l6 6 l12 -13" fill="none" stroke="#F8E2B0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<text x="140" y="${ly}" font-family="${SANS}" font-size="34" fill="#FFFFFF">${esc(l.length > 40 ? `${l.slice(0, 39)}…` : l)}</text>`
      );
    })
    .join('');
  const pill = p.card.footer
    ? `<rect x="80" y="938" width="${60 + p.card.footer.length * 19}" height="66" rx="33" fill="none" stroke="url(#gold)" stroke-width="2.5"/>` +
      `<text x="${110}" y="982" font-family="${SANS}" font-weight="600" font-size="30" fill="#F8E2B0">${esc(p.card.footer)}</text>`
    : '';
  const kindLabel = p.kind === 'plan' ? 'WASH PLAN' : 'WASH';
  const popular = p.card.popular
    ? `<rect x="${80 + kindLabel.length * 22 + 30}" y="226" width="180" height="46" rx="23" fill="url(#gold)"/><text x="${80 + kindLabel.length * 22 + 120}" y="257" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="22" letter-spacing="3" fill="#1B2878">★ POPULAR</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#1F2E86"/><stop offset="0.6" stop-color="#0E1650"/><stop offset="1" stop-color="#060A22"/></linearGradient>
  <radialGradient id="glow" cx="0.85" cy="0.05" r="0.7"><stop offset="0" stop-color="#7E91F0" stop-opacity="0.45"/><stop offset="1" stop-color="#7E91F0" stop-opacity="0"/></radialGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF1CF"/><stop offset="0.55" stop-color="#F0CF8E"/><stop offset="1" stop-color="#D2A250"/></linearGradient>
</defs>
<rect width="${S}" height="${S}" fill="url(#bg)"/>
<rect width="${S}" height="${S}" fill="url(#glow)"/>
<rect x="28" y="28" width="${S - 56}" height="${S - 56}" rx="26" fill="none" stroke="url(#gold)" stroke-opacity="0.45" stroke-width="2"/>
<text x="80" y="258" font-family="${SANS}" font-weight="600" font-size="24" letter-spacing="8" fill="#9BAEF5">${kindLabel}</text>
${popular}
${title}
${subtitle}
${rule}
${items}
${pill}
<text x="${S - 80}" y="982" text-anchor="end" font-family="${SANS}" font-weight="700" font-size="30" letter-spacing="5" fill="#C4CCF0">${esc(p.section.toUpperCase())}</text>
<text x="${S - 80}" y="1022" text-anchor="end" font-family="${SANS}" font-size="22" letter-spacing="2" fill="#6F7FC9">${esc(place.toUpperCase())}</text>
</svg>`;
}

const res = await apiFetch(`${API}/whatsapp/catalog.json`);
if (!res.ok) throw new Error(`GET /whatsapp/catalog.json → ${res.status}`);
const { businessName, city, products } = await res.json();
const place = [businessName, city].filter(Boolean).join(' · ');
const logo = await sharp(LOGO).resize({ width: 420 }).toBuffer();
mkdirSync(OUT, { recursive: true });
for (const p of products) {
  const file = `${OUT}${p.id}.jpg`;
  const jpg = await sharp(Buffer.from(card(p, place)))
    .composite([{ input: logo, left: 80, top: 86 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  writeFileSync(file, jpg);
  if (!DRY) {
    execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/catalog/${p.id}.jpg`, '--file', file, '--content-type', 'image/jpeg', ...(STAGING ? [] : ['--local'])], {
      cwd: API_DIR,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    });
  }
  console.log(`${DRY ? 'drew' : 'uploaded'} ${p.id}`);
}
console.log(`${products.length} cards${DRY ? ` in ${OUT}` : ` in ${BUCKET}/catalog/`}`);
