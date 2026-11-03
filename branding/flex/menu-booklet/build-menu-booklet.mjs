// The customer menu, an A4 booklet to photo-print and laminate for the counter and the waiting
// area, in the customer app's look: the night-indigo hero with the drop, the soft indigo-white page,
// white rounded cards, small spaced capitals, gold for the popular wash and the offers.
//   cover · car washes · Premium Care & care services · bikes & scooters · monthly plans · back
// Prices and what each wash includes come from the live menu (the staging API's catalog, like the
// shop posters), so the booklet always matches the app and WhatsApp. English only (the logo's శ్రీ
// aside); never a supplier's name (the build stops if one slips in).
//   npm run menu
// Writes the booklet as one PDF, the HTML it prints from, and a PNG preview of each page.

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { outputDir } from '../../lib/output.mjs';
import { ADDRESS, CHAT_URL, esc, HOURS, inline, NUMBERS, qrTile } from '../../lib/poster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = outputDir(HERE);
const API = process.env.API ?? 'https://api-staging.manawashmanager.com';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** Brands we buy from: trade secrets, never in front of a customer. */
const SECRET = /k(a|ä)rcher|wavex|motul|shakti|hybrid-?x|autogo|plvr/i;
/** Google Business Profile → "Ask for reviews" link; the back page shows its QR once it is set. */
const REVIEW_URL = process.env.REVIEW_URL ?? '';

// ─── The menu ────────────────────────────────────────────────────────────────
const info = await fetch(`${API}/whatsapp/catalog.json`).then((r) => {
  if (!r.ok) throw new Error(`catalog: ${r.status}`);
  return r.json();
});
/** The catalog CSV's rows as objects (its fields are quoted and may hold commas). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n') row.push(cell), rows.push(row), (row = []), (cell = '');
    else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const csv = await fetch(`${API}/whatsapp/catalog.csv`).then((r) => r.text());
/** id → price in rupees, from the CSV (catalog.json carries the cards, the CSV the prices). */
const prices = new Map(parseCsv(csv).map((r) => [r.id, Math.round(Number(String(r.price).split(' ')[0]))]));
const card = (id) => info.products.find((p) => p.id === id);
const price = (id) => prices.get(id) ?? null;
const rupees = (n) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const soon = (name) => (info.comingSoon ?? []).find((c) => c.name === name);
const soonPrice = (c, classKey, sizeKey) => {
  const p = c?.prices.find((x) => x.classKey === classKey && x.sizeKey === sizeKey);
  return p ? Math.round(p.price / 100) : null;
};

const SIZES = [
  ['small', 'S', 'Hatchback', 'Swift, i20, Baleno, Kwid'],
  ['mid', 'M', 'Sedan / Compact SUV', 'Dzire, City, Nexon, Brezza'],
  ['large', 'L', 'SUV / 7-seater', 'Creta, XUV700, Innova'],
];
/** Car washes in menu order, as the catalog lists them for hatchbacks. */
const washes = info.products.filter((p) => p.section === 'Hatchbacks' && p.kind === 'service').map((p) => p.id.split('--')[0]);
const bikeWashes = info.products.filter((p) => p.id.endsWith('--bike') && p.kind === 'service').map((p) => p.id.split('--')[0]);
const monthly = (section) =>
  info.products.filter((p) => p.id.endsWith(`--${section}`) && p.kind === 'plan' && !/-\d+-months?--/.test(p.id)).map((p) => p.id.split('--')[0]);
/** Lines the menu says differently from the catalog (what the service now includes). */
const LINE_FIXES = { 'Express Wash free': 'Express Wash + Premium Care: free' };
const fixLine = (l) => LINE_FIXES[l] ?? l;

// ─── Pieces ──────────────────────────────────────────────────────────────────
/** A logo file as an inline SVG, `w` mm wide. */
function logo(file, w, prefix) {
  const l = inline(file, 0, 0, 100, prefix);
  return `<svg viewBox="0 0 100 ${l.height.toFixed(2)}" style="width:${w}mm;display:block">${l.svg}</svg>`;
}
const qr = (data, w) => `<svg viewBox="0 0 100 100" style="width:${w}mm;display:block">${qrTile(data, 0, 0, 100)}</svg>`;
const ICON = {
  car: '<path d="M4 14l1.6-4.6A2 2 0 0 1 7.5 8h9a2 2 0 0 1 1.9 1.4L20 14v4h-2.2a2 2 0 0 1-3.6 0H9.8a2 2 0 0 1-3.6 0H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="8" cy="18" r="1.5" fill="currentColor"/><circle cx="16" cy="18" r="1.5" fill="currentColor"/>',
  bike: '<circle cx="6" cy="16" r="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="16" r="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 16l4-7h5l3 7M10 9l3 7M14 6h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  seat: '<path d="M8 4h5a2 2 0 0 1 2 2l-1 8H8.5L7 6a2 2 0 0 1 1-2zM6 14h11l1 4H5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 18v2M16 18v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  calendar: '<rect x="4" y="6" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 10.5h16M8.5 4v4M15.5 4v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M9 14.5l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};
const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24">${ICON[name]}</svg>`;
/**
 * A few small white stars over a dark box w × h mm, as on the shop posters: placed by hand at
 * `spots` ([x, y] as fractions of the box), alternately small and large.
 */
function stars(w, h, spots) {
  const c = spots
    .map(([x, y], i) => `<circle cx="${(x * w).toFixed(1)}" cy="${(y * h).toFixed(1)}" r="${i % 2 ? 0.35 : 0.6}" fill="#E6EAFF" fill-opacity="0.55"/>`)
    .join('');
  return `<svg class="dots" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${c}</svg>`;
}
/** The posters' stars, round a full page. */
const PAGE_STARS = [[0.1, 0.18], [0.9, 0.12], [0.06, 0.55], [0.94, 0.6], [0.15, 0.85], [0.85, 0.82], [0.5, 0.03]];
/** The posters' ribbon of water lines across a page, at y mm. */
const ribbon = (y) => `<svg class="dots" viewBox="0 0 210 297" preserveAspectRatio="none">
<defs><linearGradient id="rib${y}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9BAEF5" stop-opacity="0"/><stop offset="0.3" stop-color="#9BAEF5" stop-opacity="0.5"/><stop offset="0.7" stop-color="#9BAEF5" stop-opacity="0.5"/><stop offset="1" stop-color="#9BAEF5" stop-opacity="0"/></linearGradient></defs>
<path d="M0 ${y} C 52 ${y - 12}, 88 ${y + 13}, 139 ${y + 2} S 189 ${y - 9}, 210 ${y}" fill="none" stroke="url(#rib${y})" stroke-width="0.6"/>
<path d="M0 ${y + 8} C 59 ${y - 4}, 95 ${y + 19}, 147 ${y + 10} S 193 ${y - 1}, 210 ${y + 9}" fill="none" stroke="url(#rib${y})" stroke-width="0.4" opacity="0.7"/></svg>`;
/** A gold hairline with a small diamond in the middle, `w` mm wide. */
const ornament = (w) => `<div class="ornament" style="width:${w}mm"><i></i></div>`;
/** A title in Didot, its last word in gold italic. */
const didot = (title) => {
  const words = title.split(' ');
  return `${esc(words.slice(0, -1).join(' '))} <em>${esc(words.at(-1))}</em>`;
};
const tile = (name) => `<div class="tile">${icon(name)}</div>`;
const checks = (lines) => `<ul class="checks">${lines.map((l) => `<li>${icon('check')}<span>${esc(fixLine(l))}</span></li>`).join('')}</ul>`;
const minutes = (footer) => (footer ? `<span class="time">${icon('clock')}${esc(footer.replace(/^About /, ''))}</span>` : '');

/** The indigo hero band each inside page opens with, as in the app. */
const hero = (kicker, title, sub) => `
<div class="hero">
  ${stars(210, 60, [[0.62, 0.2], [0.93, 0.32], [0.78, 0.78], [0.97, 0.88]])}
  <div class="brandrow">${logo('sri-mana-wash-horizontal-on-dark.svg', 40, `hb${slug(title)}`)}<span class="kicker">${esc(kicker)}</span></div>
  <h1>${didot(title)}</h1>
  <p>${esc(sub)}</p>
  <div class="hero-line"></div>
</div>`;
const PAGES = 6;
/** The footer: address, the page of the booklet (so the sheets go back in order), numbers. */
const pageFoot = (n) => `<div class="foot"><span>${esc(ADDRESS)}</span><span class="pageno">PAGE ${n} OF ${PAGES}</span><span>${esc(NUMBERS)}</span></div>`;

// ─── Pages ───────────────────────────────────────────────────────────────────
const pages = [];

// 1. Cover: as the shop posters, the drop and the name, the title in Didot, gold frame and stars.
pages.push(`
<section class="page cover">
  <div class="glow"></div>
  ${stars(210, 297, PAGE_STARS)}
  ${ribbon(228)}
  <div class="frame"></div>
  <div class="cover-mark">${logo('sri-mana-wash-mark.svg', 26, 'cvm')}</div>
  <div class="cover-name">${logo('sri-mana-wash-name-on-dark.svg', 132, 'cvn')}</div>
  <div class="cover-mid">
    <div class="kicker gold">THE MENU</div>
    <h1>Our <em>menu</em></h1>
    ${ornament(90)}
    <div class="spaced">CAR &amp; BIKE WASH</div>
    <p>Washes, care and monthly plans,<br>priced by size, whatever the brand.</p>
    <div class="contents">${[['Car washes', 2], ['Care & extras', 3], ['Bikes & scooters', 4], ['Monthly plans', 5]].map(([t, n]) => `<span>${esc(t)}<b>${n}</b></span>`).join('<i></i>')}</div>
  </div>
  <div class="cover-foot">
    <div class="spaced">${esc(ADDRESS.toUpperCase())}</div>
    <div class="num">${esc(NUMBERS)}</div>
    <div class="spaced soft">${esc(HOURS.toUpperCase())}</div>
  </div>
</section>`);

// 2. Car washes: a size key, then a card per wash with its price for each size.
{
  const sizeKey = `<div class="sizes">${SIZES.map(([, , label, eg]) => `<div>${icon('car')}<b>${esc(label)}</b><span>${esc(eg)}</span></div>`).join('')}</div>`;
  const cards = washes
    .map((w) => {
      const c = card(`${w}--small`);
      const pop = c.card.popular;
      return `
<div class="card ${pop ? 'popular' : ''}">
  ${pop ? stars(184, 60, [[0.72, 0.1], [0.97, 0.45], [0.86, 0.06]]) : ''}
  <div class="card-head">${tile('car')}<div class="name"><h2>${esc(c.title)}${pop ? '<span class="badge">★ MOST POPULAR</span>' : ''}</h2><p>${esc(c.card.subtitle)}</p></div>${minutes(c.card.footer)}</div>
  ${checks(c.card.lines)}
  <div class="prices">${SIZES.map(([sec, , label]) => `<div><span>${esc(label)}</span><b>${rupees(price(`${w}--${sec}`))}</b></div>`).join('')}</div>
</div>`;
    })
    .join('');
  pages.push(`
<section class="page">
  ${hero('MENU', 'Car washes', 'Every wash uses a gentle, pH-neutral shampoo and soft microfiber.')}
  <div class="body">
    ${sizeKey}
    ${cards}
  </div>
  ${pageFoot(2)}
</section>`);
}

// 3. Premium Care, and the care services.
{
  const pc = soon('Premium Care');
  const care = (info.comingSoon ?? []).filter((c) => c.kind === 'protection');
  const pcCard = pc
    ? `
<div class="card gold">
  <div class="card-head">${tile('sparkle')}<div class="name"><h2>${esc(pc.name)}</h2><p>${esc(pc.description)}</p></div><span class="addon">ADD-ON · WITH ANY WASH</span></div>
  ${checks(pc.checklist)}
  <div class="prices">${SIZES.map(([, key, label]) => `<div><span>${esc(label)}</span><b>+${rupees(soonPrice(pc, 'car', key))}</b></div>`).join('')}<div><span>Bike</span><b>+${rupees(soonPrice(pc, 'twoWheeler', 'M'))}</b></div></div>
</div>`
    : '';
  const careCards = care
    .map((c) => {
      const one = new Set(SIZES.map(([, key]) => soonPrice(c, 'car', key))).size === 1;
      const lines = c.checklist.map(fixLine);
      return `
<div class="card">
  <div class="card-head">${tile(/interior/i.test(c.name) ? 'seat' : 'shield')}<div class="name"><h2>${esc(c.name)}</h2><p>${esc(c.description.replace(/\s*Express Wash free\.?$/, ''))}</p></div>${c.durationMin ? minutes(`${Math.round(c.durationMin / 60)} hours`) : ''}</div>
  ${checks(lines)}
  <div class="prices">${one ? `<div class="wide"><span>Any car</span><b>${rupees(soonPrice(c, 'car', 'S'))}</b></div>` : SIZES.map(([, key, label]) => `<div><span>${esc(label)}</span><b>${rupees(soonPrice(c, 'car', key))}</b></div>`).join('')}</div>
</div>`;
    })
    .join('');
  pages.push(`
<section class="page">
  ${hero('MENU', 'Care & extras', 'Add a deeper shine to any wash, or give the inside a full reset.')}
  <div class="body">
    ${pcCard}
    <div class="label">CARE &amp; PROTECTION</div>
    ${careCards}
  </div>
  ${pageFoot(3)}
</section>`);
}

// 4. Bikes & scooters (their plans are with the others, on the plans page).
{
  const cards = bikeWashes
    .map((w) => {
      const c = card(`${w}--bike`);
      const pop = c.card.popular;
      return `
<div class="card ${pop ? 'popular' : ''}">
  <div class="card-head">${tile('bike')}<div class="name"><h2>${esc(c.title.replace(/^Bike /, ''))}${pop ? '<span class="badge">★ MOST POPULAR</span>' : ''}</h2><p>${esc(c.card.subtitle)}</p></div>${minutes(c.card.footer)}<div class="one-price">${rupees(price(`${w}--bike`))}</div></div>
  ${checks(c.card.lines)}
</div>`;
    })
    .join('');
  const pc = soon('Premium Care');
  pages.push(`
<section class="page">
  ${hero('MENU', 'Bikes & scooters', 'One price for every bike and scooter, whatever the size.')}
  <div class="body">
    ${cards}
    ${pc ? `<div class="strip">${icon('sparkle')}<span><b>Premium Care for bikes</b> · thick yellow snow foam &amp; a wash-and-wax lather</span><b class="gold-text">+${rupees(soonPrice(pc, 'twoWheeler', 'M'))}</b></div>` : ''}
  </div>
  ${pageFoot(4)}
</section>`);
}

// 5. Monthly plans: each car plan per size, Build your own, the longer terms, the bike plans.
{
  const packOf = (id) => (card(id)?.card?.lines?.[1] ?? '').replace(/, in any order$/, '').replace(/ Wash\b/g, '');
  const saveOf = (id) => card(id)?.card?.footer ?? '';
  const bikePlans = monthly('bike')
    .map((p) => `<div><span><b>${esc(card(`${p}--bike`).title.replace(/^Bike /, ''))}</b> · ${esc(packOf(`${p}--bike`).replace(/Bike /g, ''))}</span><span class="save">${esc(saveOf(`${p}--bike`))}</span><b>${rupees(price(`${p}--bike`))}</b></div>`)
    .join('');
  const rows = monthly('small')
    .map((p) => {
      const pop = card(`${p}--small`).card.popular;
      return `<tr class="${pop ? 'pop' : ''}"><td><b>${esc(card(`${p}--small`).title)}</b>${pop ? '<span class="badge sm">★ POPULAR</span>' : ''}<span>${esc(packOf(`${p}--small`))}</span></td>${SIZES.map(([sec]) => `<td class="num"><b>${rupees(price(`${p}--${sec}`))}</b><span>${esc(saveOf(`${p}--${sec}`))}</span></td>`).join('')}</tr>`;
    })
    .join('');
  pages.push(`
<section class="page plans-page">
  ${hero('MENU', 'Monthly plans', 'A pack of 4 washes a month. Use them in any order, whenever you like.')}
  <div class="body">
    <div class="card flat">
      <table class="plans">
        <tr><th>CAR PLAN · 4 WASHES A MONTH</th>${SIZES.map(([, , label]) => `<th class="num">${esc(label.toUpperCase())}</th>`).join('')}</tr>
        ${rows}
      </table>
    </div>
    <div class="byo">${icon('sparkle')}<div><b>Build your own</b><span>Pick any 4 washes, any mix: the 4 added up, <b class="gold-text">less 8%</b></span></div></div>
    <div class="facts">
      <div>${icon('calendar')}<b>3 months</b><span>13 washes, 1 free · best value</span></div>
      <div>${icon('calendar')}<b>12 months</b><span>13 months of washes for 12</span></div>
      <div>${icon('check')}<b>Any day</b><span>One a day · a better wash? Pay the difference</span></div>
      <div>${icon('clock')}<b>7 extra days</b><span>For leftovers · 1 carries over when you renew</span></div>
    </div>
    <div class="label">BIKE &amp; SCOOTER PLANS · 4 WASHES A MONTH</div>
    <div class="card flat bikeplans">${bikePlans}</div>
    <div class="cta">${stars(184, 40, [[0.9, 0.18], [0.97, 0.75], [0.8, 0.85]])}${qr(CHAT_URL, 22)}<div><b>Start a plan today</b><span>At the counter, or scan &amp; say <b>Hi</b> on WhatsApp: pick your plan, pay, and we keep count of your washes for you.</span></div></div>
  </div>
  ${pageFoot(5)}
</section>`);
}

// 6. Back: thank you, WhatsApp (and Google once the link is in), the details.
pages.push(`
<section class="page cover back">
  <div class="glow"></div>
  ${stars(210, 297, PAGE_STARS)}
  <div class="frame"></div>
  <div class="cover-mark">${logo('sri-mana-wash-mark.svg', 22, 'bkm')}</div>
  <div class="cover-name back-name">${logo('sri-mana-wash-name-on-dark.svg', 100, 'bkn')}</div>
  <div class="cover-mid">
    <h1>Thank <em>you</em></h1>
    ${ornament(90)}
    <p>We'll WhatsApp you when your car is ready,<br>with photos and your bill.</p>
    <div class="qrs">
      <div class="qr">${qr(CHAT_URL, 44)}<b>Scan &amp; say <em>Hi</em></b><span>Prices for your car, plans,<br>bookings and bills on WhatsApp</span></div>
      ${REVIEW_URL ? `<div class="qr">${qr(REVIEW_URL, 44)}<b>Loved the <em>shine?</em></b><span>A quick Google review<br>helps us a lot</span></div>` : ''}
    </div>
    <div class="see-you">See you at your next <em>shine.</em></div>
  </div>
  <div class="cover-foot">
    <div class="spaced">${esc(ADDRESS.toUpperCase())}</div>
    <div class="num">${esc(NUMBERS)}</div>
    <div class="spaced soft">${esc(HOURS.toUpperCase())}</div>
  </div>
</section>`);

// ─── The document ────────────────────────────────────────────────────────────
// No shadows, filters or rotated overlays: PDF viewers flatten them into grey boxes behind the cards.
const CSS = `
@page { size: A4; margin: 0; }
:root {
  --indigo:#1B2878; --mid:#142066; --deep:#0C1442; --night:#060A22; --ink:#0F1743; --surface:#F4F6FF; --pale:#E8ECFF;
  --mist:#C4CCF0; --soft:#9BAEF5; --bright:#5468D4; --slate:#4A5280; --border:#E2E7FB;
  --amber:#F59E0B; --amberPale:#FFF4D6; --goldInk:#4D2F00; --gold:#F0CF8E; --goldDeep:#B07C2C; --teal:#0D9488;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--surface); color: var(--ink); font-family: -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 297mm; position: relative; overflow: hidden; background: var(--surface); break-after: page; }
.page:last-child { break-after: auto; }
.ico { width: 1em; height: 1em; flex: none; }
.dots { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

/* Cover and back: the shop posters' night, stars, gold frame and Didot. */
.cover { background: linear-gradient(172deg, #1F2E86 0%, #0E1650 50%, #05081C 100%); color: #fff; }
.cover .glow { position: absolute; inset: 0; background: radial-gradient(75% 45% at 50% 4%, rgba(126,145,240,0.5), transparent 100%); }
.frame { position: absolute; inset: 7mm; border: 0.35mm solid rgba(232,191,120,0.6); border-radius: 6mm; }
.cover-mark { position: absolute; top: 30mm; left: 0; right: 0; display: flex; justify-content: center; }
.cover-name { position: absolute; top: 72mm; left: 0; right: 0; display: flex; justify-content: center; }
.cover-mid { position: absolute; top: 118mm; left: 20mm; right: 20mm; text-align: center; display: flex; flex-direction: column; align-items: center; }
.cover .kicker { font-size: 9.5pt; font-weight: 700; letter-spacing: 0.5em; color: var(--soft); }
.cover .kicker.gold { color: var(--gold); }
.cover h1 { font-family: Didot, "Bodoni 72", serif; font-weight: 400; font-size: 66pt; margin: 4mm 0 5mm; line-height: 1; letter-spacing: 0.01em; }
.cover h1 em, .hero h1 em, .qr b em, .see-you em { font-style: italic; color: #EBC97F; }
.ornament { position: relative; height: 0.35mm; background: linear-gradient(90deg, transparent, #F8E2B0 50%, transparent); }
.ornament i { position: absolute; left: 50%; top: 50%; width: 2.4mm; height: 2.4mm; transform: translate(-50%, -50%) rotate(45deg); background: linear-gradient(135deg, #FFF4DA, #E2BD76 60%, #A37C3C); }
.spaced { font-size: 10pt; font-weight: 600; letter-spacing: 0.32em; color: #fff; }
.spaced.soft { color: var(--soft); font-size: 9pt; }
.cover-mid .spaced { margin-top: 6mm; }
.cover p { font-size: 12.5pt; line-height: 1.55; color: #C4CCF0; margin-top: 4mm; }
.contents { display: flex; align-items: center; gap: 2.6mm; margin-top: 10mm; font-size: 8.6pt; font-weight: 600; letter-spacing: 0.08em; color: var(--gold); text-transform: uppercase; }
.contents i { width: 1.6mm; height: 1.6mm; transform: rotate(45deg); background: #C99A4E; display: inline-block; }
.contents span { display: inline-flex; align-items: center; gap: 1.6mm; white-space: nowrap; }
.contents b { font-size: 8pt; color: var(--deep); background: var(--gold); border-radius: 99px; width: 4.4mm; height: 4.4mm; display: inline-flex; align-items: center; justify-content: center; letter-spacing: 0; }
.cover-foot { position: absolute; left: 18mm; right: 18mm; bottom: 17mm; display: flex; flex-direction: column; align-items: center; gap: 2.2mm; text-align: center; }
.cover-foot .num { font-size: 13pt; font-weight: 700; letter-spacing: 0.08em; color: var(--gold); }
.back-name { top: 60mm; }
.back .cover-mark { top: 28mm; }
.back .cover-mid { top: 92mm; }
.back h1 { font-size: 64pt; }
.qrs { display: flex; justify-content: center; gap: 10mm; margin-top: 10mm; }
.qr { width: 62mm; display: flex; flex-direction: column; align-items: center; gap: 2mm; background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03)); border: 0.35mm solid rgba(232,191,120,0.5); border-radius: 5mm; padding: 6mm 4mm 5mm; }
.qr b { font-family: Didot, "Bodoni 72", serif; font-weight: 400; font-size: 17pt; margin-top: 2mm; color: #fff; }
.qr span { font-size: 9.5pt; color: var(--mist); line-height: 1.45; }
.see-you { font-family: Didot, "Bodoni 72", serif; font-size: 17pt; color: #fff; margin-top: 10mm; }

/* Inside pages: the hero band, then cards on the soft page. */
.hero > :not(.dots) { position: relative; }
.hero { position: relative; background: radial-gradient(70% 120% at 80% 0%, rgba(126,145,240,0.35), transparent 70%), linear-gradient(172deg, #1F2E86 0%, #0E1650 60%, #05081C 100%); color: #fff; padding: 11mm 16mm 13mm; border-radius: 0 0 9mm 9mm; overflow: hidden; }
.hero-line { position: absolute; left: 16mm; right: 16mm; bottom: 5mm; height: 0.3mm; background: linear-gradient(90deg, rgba(248,226,176,0.9), rgba(248,226,176,0.35) 60%, transparent); }
.hero .brandrow { display: flex; align-items: center; justify-content: space-between; }
.hero .kicker { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.3em; color: var(--soft); }
.hero h1 { font-family: Didot, "Bodoni 72", serif; font-weight: 400; font-size: 36pt; letter-spacing: 0.005em; margin-top: 5mm; line-height: 1.05; }
.hero p { font-size: 11.5pt; color: #D9DEFF; margin-top: 1.5mm; }
.body { padding: 6mm 11mm 0 17mm; display: flex; flex-direction: column; gap: 4.2mm; }
.foot { position: absolute; left: 17mm; right: 11mm; bottom: 12mm; align-items: center; display: flex; justify-content: space-between; font-size: 8pt; color: var(--slate); letter-spacing: 0.04em; }
.label { font-size: 9pt; font-weight: 700; letter-spacing: 0.22em; color: var(--indigo); margin: 1mm 0 -1mm 1mm; }

.sizes { display: flex; gap: 3mm; }
.sizes div { position: relative; overflow: hidden; flex: 1; background: linear-gradient(135deg, #FFF3D2 0%, #F4D592 38%, #FFF6DF 52%, #EFC572 70%, #D9A24A 100%); border: 0.35mm solid #E2B65F; border-radius: 4mm; padding: 2.6mm 3.5mm; display: grid; grid-template-columns: auto 1fr; column-gap: 2.5mm; align-items: center; }
.sizes .ico { grid-row: span 2; font-size: 15pt; color: var(--goldInk); }
.sizes b { font-size: 10pt; color: var(--goldInk); }
.sizes span { font-size: 8pt; color: #6B4A12; }

.card { background: #fff; border-radius: 5.5mm; padding: 4.6mm 5mm; border: 0.3mm solid var(--border); }
.card { position: relative; overflow: hidden; }
.card.popular { background: radial-gradient(70% 120% at 85% 0%, rgba(126,145,240,0.3), transparent 70%), linear-gradient(172deg, #1F2E86 0%, #0E1650 60%, #05081C 100%); color: #fff; border: 0.6mm solid #E9BF6E; }
.card.popular > :not(.dots) { position: relative; }
.card.popular .name h2 { color: #fff; }
.card.popular .name p { color: #CDD5FF; }
.card.popular .tile { background: rgba(255,255,255,0.1); border-color: rgba(240,207,142,0.55); color: var(--gold); }
.card.popular .time { background: rgba(255,255,255,0.12); color: #fff; }
.card.popular .checks li { color: #EEF1FF; }
.card.popular .checks .ico { color: #5EEAD4; }
.card.gold { border: 0.6mm solid var(--gold); background: linear-gradient(180deg, #FFFDF6, #fff); }
.card.flat { padding: 1mm 0; }
.card-head { display: flex; align-items: flex-start; gap: 3.5mm; }
.tile { width: 12mm; height: 12mm; border-radius: 3.6mm; background: linear-gradient(160deg, #F2F4FF, var(--pale)); border: 0.3mm solid var(--mist); display: flex; align-items: center; justify-content: center; color: var(--indigo); font-size: 17pt; flex: none; }
.name { flex: 1; }
.name h2 { font-size: 17pt; font-weight: 800; letter-spacing: -0.01em; color: var(--ink); display: flex; align-items: center; gap: 2.5mm; flex-wrap: wrap; }
.name p { font-size: 10pt; color: var(--slate); margin-top: 0.6mm; line-height: 1.35; }
.badge { font-size: 7.5pt; font-weight: 800; letter-spacing: 0.12em; background: var(--amberPale); color: var(--goldInk); border: 0.3mm solid #F7D488; padding: 0.8mm 2.2mm; border-radius: 99px; }
.badge.sm { font-size: 6.5pt; margin-left: 2mm; vertical-align: 1px; }
.addon { font-size: 7.5pt; font-weight: 800; letter-spacing: 0.12em; color: var(--goldDeep); white-space: nowrap; margin-top: 1.5mm; }
.time { display: inline-flex; align-items: center; gap: 1.2mm; font-size: 9pt; font-weight: 700; color: var(--indigo); background: var(--pale); padding: 1mm 2.6mm; border-radius: 99px; white-space: nowrap; margin-top: 0.8mm; }
.checks { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 1.4mm 5mm; margin: 3.6mm 0 0 15.5mm; }
.checks li { display: flex; align-items: center; gap: 1.8mm; font-size: 10.5pt; color: var(--ink); }
.checks .ico { color: var(--teal); font-size: 10pt; }
.prices { display: flex; gap: 2.5mm; margin-top: 4mm; }
.prices div { flex: 1; background: var(--surface); border-radius: 3.4mm; padding: 2.2mm 3mm; display: flex; flex-direction: column; }
.prices div.wide { flex: none; width: 50%; }
.prices span { font-size: 8pt; color: var(--slate); font-weight: 600; }
.prices b { font-size: 17pt; font-weight: 800; color: var(--indigo); letter-spacing: -0.01em; }
.card.popular .prices div { background: rgba(255,255,255,0.08); border: 0.3mm solid rgba(240,207,142,0.45); }
.card.popular .prices span { color: #CDD5FF; }
.card.popular .prices b { color: var(--gold); }
.card.gold .prices b { color: var(--goldDeep); }
.one-price { font-size: 22pt; font-weight: 800; color: var(--indigo); margin-left: 3mm; }
.card.popular .one-price { color: var(--gold); }
.strip { display: flex; align-items: center; gap: 3mm; background: #fff; border: 0.5mm solid var(--gold); border-radius: 5mm; padding: 4mm 5mm; font-size: 10.5pt; }
.strip .ico { color: var(--goldDeep); font-size: 14pt; }
.strip > span:nth-child(2) { flex: 1; }
.gold-text { color: var(--goldDeep); }
.strip .gold-text { font-size: 15pt; }

table.plans { width: 100%; border-collapse: collapse; }
.plans th { font-size: 7.5pt; letter-spacing: 0.14em; color: var(--slate); text-align: left; padding: 3mm 5mm 2mm; font-weight: 700; }
.plans td { padding: 2.6mm 5mm; border-top: 0.3mm solid var(--border); vertical-align: middle; }
.plans td b { font-size: 12.5pt; color: var(--ink); }
.plans td span { display: block; font-size: 8.5pt; color: var(--slate); margin-top: 0.4mm; }
.plans td span.badge { display: inline-block; margin-top: 0; }
.plans .num { text-align: right; }
.plans .num b { font-size: 14pt; color: var(--indigo); }
.plans .num span { color: var(--teal); font-weight: 700; }
.plans tr.pop td { background: var(--amberPale); }
.plans tr.pop .num b { color: var(--goldInk); }
.byo { display: flex; align-items: center; gap: 3.5mm; background: #fff; border: 0.5mm dashed var(--goldDeep); border-radius: 5mm; padding: 3.6mm 5mm; }
.byo > .ico { font-size: 16pt; color: var(--goldDeep); }
.byo div > b { font-size: 12.5pt; display: block; }
.byo span { font-size: 10pt; color: var(--slate); }
.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5mm; }
.facts div { background: #fff; border: 0.3mm solid var(--border); border-radius: 4mm; padding: 2.8mm 3.5mm; display: grid; grid-template-columns: auto 1fr; column-gap: 2.5mm; align-items: center; }
.facts .ico { grid-row: span 2; font-size: 13pt; color: var(--indigo); }
.facts b { font-size: 10.5pt; }
.facts span { font-size: 8.8pt; color: var(--slate); }
.bikeplans div { display: flex; justify-content: space-between; align-items: center; padding: 2.4mm 5mm; border-top: 0.3mm solid var(--border); font-size: 10.5pt; }
.bikeplans div:first-child { border-top: 0; }
.bikeplans div > b { font-size: 13pt; color: var(--indigo); width: 18mm; text-align: right; }
.bikeplans div > span:first-child { flex: 1; }
.bikeplans .save { font-size: 9pt; font-weight: 700; color: var(--teal); }
.note { font-size: 9.5pt; color: var(--slate); text-align: center; }
/* The plans page holds car and bike plans: a little tighter. */
.plans-page .hero { padding: 9mm 16mm 10mm; }
.plans-page .hero h1 { margin-top: 4mm; }
.plans-page .body { gap: 3mm; padding-top: 5mm; }
.pageno { font-weight: 800; letter-spacing: 0.2em; color: var(--indigo); font-size: 7.5pt; }
.plans-page .plans td { padding: 1.6mm 5mm; }
.plans-page .bikeplans div { padding: 1.8mm 5mm; }
.plans-page .facts div { padding: 2mm 3.5mm; }
.plans-page .byo { padding: 2.6mm 5mm; }
.plans-page .cta { padding: 3.4mm 5mm; margin-top: 0.5mm; gap: 5mm; }
.plans-page .cta b { font-size: 13pt; }
.plans-page .cta span { font-size: 9.6pt; }
.plans-page .cta span b { font-size: inherit; }
.cta { position: relative; overflow: hidden; display: flex; align-items: center; gap: 6mm; background: linear-gradient(172deg, #1F2E86 0%, #0E1650 60%, #05081C 100%); border: 0.35mm solid rgba(232,191,120,0.5); color: #fff; border-radius: 6mm; padding: 5mm 6mm; margin-top: 2mm; }
.cta > :not(.dots) { position: relative; }
.cta b { font-size: 15pt; display: block; color: var(--gold); }
.cta span { font-size: 10.5pt; color: #D9DEFF; line-height: 1.45; display: block; margin-top: 1mm; }
.cta span b { display: inline; font-size: inherit; }
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sri Mana Wash menu</title><style>${CSS}</style></head><body>${pages.join('\n')}</body></html>`;
const leak = html.match(SECRET);
if (leak) throw new Error(`the menu names a supplier ("${leak[0]}")`);

const htmlPath = join(OUT, 'sri-mana-wash-menu-a4.html');
writeFileSync(htmlPath, html);
if (existsSync(CHROME)) {
  if (!process.env.NO_PDF)
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${join(OUT, 'sri-mana-wash-menu-a4.pdf')}`, pathToFileURL(htmlPath).href], { stdio: 'ignore' });
  // A preview of each page: the whole booklet as one tall screenshot, cut into pages.
  const pxW = 794;
  const pxH = 1123;
  const tall = join(OUT, '.menu-tall.png');
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${pxW},${pxH * pages.length}`, '--force-device-scale-factor=2', `--screenshot=${tall}`, pathToFileURL(htmlPath).href], { stdio: 'ignore' });
  for (let i = 0; i < pages.length; i++) {
    await sharp(tall)
      .extract({ left: 0, top: i * pxH * 2, width: pxW * 2, height: pxH * 2 })
      .png()
      .toFile(join(OUT, `sri-mana-wash-menu-a4-page-${i + 1}-preview.png`));
  }
  rmSync(tall);
}
console.log(`wrote sri-mana-wash-menu-a4 (${pages.length} × A4)`);
