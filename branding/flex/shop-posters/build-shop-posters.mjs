// Builds the shop's printed posters in the brand's indigo and gold, from the live menu so their
// prices always match the app and WhatsApp. English only (the logo's శ్రీ aside):
//   counter card (A5, two sides)  · MANA Pay (scan to pay), and "Rate us on Google"
//   plans poster (2 × 3 ft)       · three membership cards: each plan per car size, per wash
//   price board  (4 × 3 ft)       · every wash × car size (Small, Mid-size, Large), the Premium
//                                   Care add-on, and two-wheelers
//   waiting poster (A3)           · "We'll WhatsApp you when it's ready"
//   valuables notice (A3)         · take cash, phones, gold and documents out
//   highway board (6 × 3 ft)      · the brand on the night side, a gold panel with the arrow
// Each as a print-ready SVG and vector PDF (headless Chrome, like the other boards) and a PNG preview.
//   node branding/flex/shop-posters/build-shop-posters.mjs
// Prices come from the staging API's catalog (set API to another host to change). Fill in UPI_ID,
// REVIEW_URL and HIGHWAY below; until then the counter card's back shows a marked placeholder.
// 1 unit = 1 mm on every poster.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputDir } from '../../lib/output.mjs';
import {
  ADDRESS,
  bikeArt,
  CHAT_URL,
  esc,
  frame,
  HOURS,
  ICONS,
  inline,
  NUMBER,
  NUMBERS,
  ornament,
  qrPlaceholder,
  qrTile,
  ribbon,
  ringIcon,
  SANS,
  SERIF,
  silhouette,
  sparkle,
  writer,
} from '../../lib/poster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = process.env.API ?? 'https://api-staging.manawashmanager.com';

// ─── Fill these in ────────────────────────────────────────────────────────────
/**
 * MANA Pay: the shop's HDFC PayZapp / Vyapar UPI QR, the one the sound box announces payments
 * for, as the code inside it reads, redrawn here as a sharp vector QR. Replace it if the bank
 * issues a new one; the counter card never prints the UPI ID itself.
 */
const MANA_PAY_QR =
  process.env.MANA_PAY_QR ?? 'upi://pay?pa=Vyapar.178760059376@hdfcbank&pn=Default&mc=8999&tr=STQU178760059376&cu=INR';
/** Google Business Profile → "Ask for reviews" link; empty shows a placeholder. */
const REVIEW_URL = process.env.REVIEW_URL ?? '';
/** The highway sign: how far, and which way (left or right). */
const HIGHWAY = { distance: process.env.HIGHWAY_DISTANCE ?? '200 m', arrow: process.env.HIGHWAY_ARROW ?? 'right' };


// ─── The menu ────────────────────────────────────────────────────────────────
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
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const [csv, info] = await Promise.all([
  fetch(`${API}/whatsapp/catalog.csv`).then((r) => r.text()),
  fetch(`${API}/whatsapp/catalog.json`).then((r) => r.json()),
]);
const cards = new Map(info.products.map((p) => [p.id, p]));

const products = parseCsv(csv).map((r) => {
  const [service, section] = r.id.split('--');
  const kind = r.custom_label_1 === 'Wash plans' ? 'plan' : r.custom_label_1 === 'Add-ons' ? 'addon' : 'service';
  return { id: r.id, service, section, label: r.custom_label_0, kind, price: Math.round(Number(r.price.split(' ')[0])), card: cards.get(r.id) };
});
// Services not on sale yet (WhatsApp says "coming soon") are printed like any other: a poster
// stays up long after they start. Their waiting list prices, per class size, become sections.
const SOON_SECTIONS = { 'car:S': 'small', 'car:M': 'mid', 'car:L': 'large', 'twoWheeler:M': 'bike' };
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
for (const c of info.comingSoon ?? []) {
  for (const p of c.prices) {
    const section = SOON_SECTIONS[`${p.classKey}:${p.sizeKey}`];
    if (!section) continue;
    const id = `${slug(c.name)}--${section}`;
    products.push({
      id,
      service: slug(c.name),
      section,
      label: section,
      kind: c.kind === 'addon' ? 'addon' : 'service',
      price: Math.round(p.price / 100),
      card: { id, title: c.name, card: { subtitle: c.description, lines: c.checklist ?? [], footer: null, popular: false } },
    });
  }
}
const price = (service, section) => products.find((p) => p.service === service && p.section === section)?.price ?? null;
const cardOf = (service, section) => products.find((p) => p.service === service && p.section === section)?.card ?? null;
const rupees = (n) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);
/** Services in menu order, of one kind, on the menu for this section. */
const servicesIn = (section, kind) => [...new Set(products.filter((p) => p.section === section && p.kind === kind).map((p) => p.service))];
const titleOf = (service, section) => cardOf(service, section)?.title ?? service;
/** Shorter lines where a service's description is too long for the price board's name column. */
const BOARD_LINES = {
  'deep-interior-cleaning': 'Seats, carpets, roof & AC vents · Express Wash + Premium Care free',
  'premium-care': 'Thick yellow snow foam & wash-and-wax lather · deep gloss',
};
/** A service's one-line description, without anything about communities (not offered yet). */
const subtitleOf = (service, section) =>
  BOARD_LINES[service] ??
  ((cardOf(service, section)?.card?.subtitle ?? '')
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/communit/i.test(sentence))
    .join(' ') || null);

// ─── Output ──────────────────────────────────────────────────────────────────
/** Prints and previews go to Documents, outside the repo (lib/output.mjs). */
const OUT = outputDir(HERE);
const write = writer(OUT);

// ─── 1. Counter card (A5, two sides) ─────────────────────────────────────────
{
  const W = 148;
  const H = 210;
  const k = 0.32;
  const logo = inline('sri-mana-wash-stacked-on-dark.svg', (W - 78) / 2, 16, 78, 'cf');
  const qs = 74;
  // ── Front: MANA Pay ──
  // A payment card: a double gold frame, the MANA Pay name, the QR on white, the payee name to
  // check before paying, three steps, the apps, and both numbers. No icons.
  {
    const k2 = 0.32;
    const markW = 13;
    const mark = inline('sri-mana-wash-mark.svg', (W - markW) / 2, 15, markW, 'mp');
    const q = 82; // the QR's white tile
    const qx = (W - q) / 2;
    const qy = 66;
    const inner = 9; // the inner gold rule's inset
    const corner = (x, y) => `<path d="M${x} ${y - 2.2}L${x + 2.2} ${y}L${x} ${y + 2.2}L${x - 2.2} ${y}Z" fill="url(#foil)"/>`;
    const steps = ['Scan', 'Enter amount', 'Pay'];
    const stepW = 34;
    const stepsX = (W - stepW * 3) / 2;
    const stepRow = steps
      .map((label, i) => {
        const cx = stepsX + stepW * i + stepW / 2;
        return (
          `<circle cx="${cx}" cy="172" r="3.6" fill="none" stroke="url(#foil)" stroke-width="0.45"/>` +
          `<text x="${cx}" y="173.35" text-anchor="middle" font-family="${SERIF}" font-size="4" fill="#F8E2B0">${i + 1}</text>` +
          `<text x="${cx}" y="180.2" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="3.1" letter-spacing="0.3" fill="#E6EAFF">${label}</text>` +
          (i < 2 ? `<rect x="${cx + 6}" y="171.8" width="${stepW - 12}" height="0.35" fill="url(#goldLine)"/>` : '')
        );
      })
      .join('');
    const apps = ['GPay', 'PhonePe', 'Paytm', 'BHIM'];
    const pillW = 19.5;
    const pillGap = 2.4;
    const rowW = apps.length * pillW + (apps.length - 1) * pillGap;
    const pills = apps
      .map((a, i) => {
        const x = (W - rowW) / 2 + i * (pillW + pillGap);
        return `<rect x="${x}" y="185.5" width="${pillW}" height="6.4" rx="3.2" fill="#FFFFFF" fill-opacity="0.05" stroke="#E8BF78" stroke-opacity="0.4" stroke-width="0.25"/><text x="${x + pillW / 2}" y="189.8" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="3" fill="#E6EAFF">${a}</text>`;
      })
      .join('');
    await write(
      'counter-card-front-pay',
      W,
      H,
      `${frame(W, H, k2, { stars: false })}
<rect x="${inner}" y="${inner}" width="${W - inner * 2}" height="${H - inner * 2}" rx="7" fill="none" stroke="url(#foil)" stroke-width="0.35" stroke-opacity="0.8"/>
${corner(inner, inner)}${corner(W - inner, inner)}${corner(inner, H - inner)}${corner(W - inner, H - inner)}
<circle cx="${W / 2}" cy="${qy + q / 2}" r="${q * 0.78}" fill="url(#halo)"/>
${mark.svg}
<text x="${W / 2}" y="47" text-anchor="middle" font-family="${SERIF}" font-size="19" letter-spacing="1.4" fill="#FFFFFF">MANA <tspan font-style="italic" fill="url(#foil)">Pay</tspan></text>
<text x="${W / 2}" y="55" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="2.9" letter-spacing="1.5" fill="#9BAEF5">SCAN TO PAY · KOVUR</text>
<rect x="${qx - 2.4}" y="${qy - 2.4}" width="${q + 4.8}" height="${q + 4.8}" rx="6.6" fill="none" stroke="url(#foil)" stroke-width="0.7"/>
${qrTile(MANA_PAY_QR, qx, qy, q)}
<text x="${W / 2}" y="${qy + q + 12}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="4.4" letter-spacing="1.6" fill="#FFFFFF">SRI MANA WASH</text>
<text x="${W / 2}" y="${qy + q + 17.8}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="3.7" letter-spacing="0.2" fill="#F8E2B0">Check this name on your screen before you pay</text>
${stepRow}
${pills}
<text x="${W / 2}" y="${H - 14.2}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="3.4" letter-spacing="0.6" fill="#F8E2B0">${NUMBERS}</text>`,
      'Sri Mana Wash counter card, front: MANA Pay',
    );
  }
  const stars = [0, 1, 2, 3, 4].map((i) => `<g color="#F0CF8E" transform="translate(${W / 2 - 30 + i * 12} ${16 + logo.height + 22}) scale(0.5)">${ICONS.star}</g>`).join('');
  await write(
    'counter-card-back-review',
    W,
    H,
    `${frame(W, H, k)}
${logo.svg}
${stars}
<text x="${W / 2}" y="${16 + logo.height + 46}" text-anchor="middle" font-family="${SERIF}" font-size="13" fill="#FFFFFF">Loved the <tspan font-style="italic" fill="url(#gold)">shine?</tspan></text>
<text x="${W / 2}" y="${16 + logo.height + 55}" text-anchor="middle" font-family="${SANS}" font-size="4.4" fill="#C4CCF0">A quick Google review helps us a lot</text>
${REVIEW_URL ? qrTile(REVIEW_URL, (W - qs) / 2, 110, qs) : qrPlaceholder((W - qs) / 2, 110, qs, 'REVIEW LINK')}
<text x="${W / 2}" y="${110 + qs + 11}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="4.8" letter-spacing="1.6" fill="#F8E2B0">SCAN · RATE US ON GOOGLE</text>`,
    'Sri Mana Wash counter card, back: rate us on Google',
  );
}

// ─── 2. Plans poster (2 × 3 ft) ──────────────────────────────────────────────
// Every plan is a pack of 4 washes a month, used in any order: one row per plan (its name, what's
// in it), its price for each car size, the popular one lit in gold; then Build your own (any 4
// washes, less 8%), and the 3- and 12-month deals and the rules underneath.
{
  const W = 610;
  const H = 915;
  const L = 44;
  const CARS = [
    ['small', 'HATCHBACK'],
    ['mid', 'SEDAN /|COMPACT SUV'],
    ['large', 'SUV /|7-SEATER'],
  ];
  const monthly = servicesIn('small', 'plan').filter((s) => !/-\d+-months?$/.test(s));
  /** "3 Express Wash + 1 Premium Wash, in any order" → "3 Express + 1 Premium". */
  const packOf = (plan) => (cardOf(plan, 'small')?.card?.lines?.[1] ?? '').replace(/, in any order$/, '').replace(/ Wash\b/g, '');
  const logo = inline('sri-mana-wash-horizontal-on-dark.svg', (W - 220) / 2, 40, 220, 'pl');
  let y = 40 + logo.height + 40;
  let body = `${frame(W, H, 1, { stars: false })}${logo.svg}
<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="12" letter-spacing="6" fill="#9BAEF5">WASH PLANS</text>
<text x="${W / 2}" y="${y + 50}" text-anchor="middle" font-family="${SERIF}" font-size="46" fill="#FFFFFF">Your washes,</text>
<text x="${W / 2}" y="${y + 96}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="44" fill="url(#foil)">your way.</text>
<text x="${W / 2}" y="${y + 128}" text-anchor="middle" font-family="${SANS}" font-size="14.5" fill="#C4CCF0">A pack of 4 washes a month · use them in any order, whenever you like</text>
${ornament(W / 2, y + 148, 300)}`;
  y += 178;
  // The table: plan and its pack, then a price per car size.
  const nameW = 230;
  const colW = (W - L * 2 - nameW) / CARS.length;
  const colX = (i) => L + nameW + colW * i + colW / 2;
  CARS.forEach(([, label], i) => {
    label.split('|').forEach((part, j) => {
      body += `<text x="${colX(i)}" y="${y - 7 + j * 14}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="10.5" letter-spacing="1.2" fill="#F8E2B0">${esc(part)}</text>`;
    });
  });
  body += `<text x="${L}" y="${y}" font-family="${SANS}" font-weight="700" font-size="12" letter-spacing="3" fill="#9BAEF5">EVERY MONTH</text>`;
  y += 14;
  const rowH = 62;
  for (const plan of monthly) {
    const popular = !!cardOf(plan, 'small')?.card?.popular;
    if (popular) {
      body += `<rect x="${L - 16}" y="${y + 2}" width="${W - (L - 16) * 2}" height="${rowH - 4}" rx="12" fill="url(#glow)" stroke="url(#foilH)" stroke-width="1.4"/>`;
    }
    body += `<text x="${L}" y="${y + 29}" font-family="${SERIF}" font-size="22" fill="#FFFFFF">${esc(titleOf(plan, 'small'))}${popular ? `<tspan dx="8" dy="-4" font-family="${SANS}" font-size="9.5" font-weight="700" letter-spacing="1.4" fill="#F0CF8E">★ POPULAR</tspan>` : ''}</text>`;
    body += `<text x="${L}" y="${y + 48}" font-family="${SANS}" font-size="12.5" fill="#9BAEF5">${esc(packOf(plan))}</text>`;
    CARS.forEach(([section], i) => {
      body += `<text x="${colX(i)}" y="${y + 38}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="21" fill="${popular ? '#FFF1CF' : '#FFFFFF'}">${rupees(price(plan, section))}</text>`;
    });
    y += rowH;
    if (!popular) body += `<rect x="${L}" y="${y - 1}" width="${W - L * 2}" height="1" fill="url(#hair)"/>`;
  }
  // Build your own: any 4 washes, priced by the mix.
  y += 12;
  body += `<rect x="${L - 16}" y="${y}" width="${W - (L - 16) * 2}" height="56" rx="12" fill="none" stroke="url(#foilH)" stroke-width="1.2" stroke-dasharray="5 4"/>`;
  body += `<text x="${L}" y="${y + 25}" font-family="${SERIF}" font-size="22" fill="#FFFFFF">Build your own</text>`;
  body += `<text x="${L}" y="${y + 44}" font-family="${SANS}" font-size="12.5" fill="#9BAEF5">Pick any 4 washes, any mix</text>`;
  body += `<text x="${W - L}" y="${y + 25}" text-anchor="end" font-family="${SERIF}" font-style="italic" font-size="21" fill="url(#foil)">your mix, your price</text>`;
  body += `<text x="${W - L}" y="${y + 44}" text-anchor="end" font-family="${SANS}" font-size="12.5" fill="#E6EAFF">the 4 washes added up, <tspan font-weight="700" fill="#F8E2B0">less 8%</tspan></text>`;
  y += 56;
  // The deals and the rules.
  y += 24;
  const bikeFrom = Math.min(...servicesIn('bike', 'plan').map((s) => price(s, 'bike')).filter((n) => n != null));
  const facts = [
    ['3 months', '13 washes, 1 free  ★ Best value'],
    ['12 months', '13 months of washes for 12'],
    ['Any day', 'one a day · better wash? pay the difference'],
    ['7 extra days', 'for leftovers · 1 carries over on renewal'],
    ['Bikes', `the same packs, from ${rupees(bikeFrom)} a month`],
  ];
  const qs = 104;
  facts.forEach(([head, line], i) => {
    const fy = y + i * 23;
    body += `<path d="M${L + 2} ${fy - 5}l4.5 4.5 4.5-4.5-4.5-4.5z" fill="url(#foil)"/>`;
    body += `<text x="${L + 18}" y="${fy}" font-family="${SANS}" font-size="12.5" fill="#E6EAFF"><tspan font-weight="700" fill="#F8E2B0">${esc(head)}</tspan>  ${esc(line)}</text>`;
  });
  body += qrTile(CHAT_URL, W - L - qs, H - 52 - qs, qs);
  body += `<text x="${L}" y="${H - 66}" font-family="${SANS}" font-size="13" fill="#C4CCF0">Ask at the counter, or scan &amp; say <tspan font-weight="700" fill="#F8E2B0">Hi</tspan> to build yours →</text>`;
  body += `<text x="${W / 2}" y="${H - 30}" text-anchor="middle" font-family="${SANS}" font-size="11" letter-spacing="2.4" fill="#9BAEF5">${esc(HOURS.toUpperCase())}  ·  ${NUMBERS}</text>`;
  await write('plans-poster-2x3ft', W, H, body, 'Sri Mana Wash wash plans poster (2 ft × 3 ft)');
}

// ─── 3. Price board (4 × 3 ft) ───────────────────────────────────────────────
// A menu, not a spreadsheet: hairlines instead of boxes, the three car sizes drawn growing, the
// popular wash lit in gold, the care services (Anti-Rust, Deep Interior Cleaning) under their own
// heading, Premium Care framed in gold foil with a price per size, and two-wheelers, plans and the
// WhatsApp QR as three cards along the bottom.
{
  const W = 1220;
  const H = 915;
  const k = 1.4;
  const CARS = [
    ['small', 'Hatchback', 'Swift, i20, Baleno, Kwid', 120],
    ['mid', 'Sedan / Compact SUV', 'Dzire, City, Nexon, Brezza', 146],
    ['large', 'SUV / 7-seater', 'Creta, XUV700, Innova', 156],
  ];
  const L = 64; // left and right margin
  const nameW = 430;
  const colW = (W - L * 2 - nameW) / CARS.length;
  const colX = (i) => L + nameW + colW * i + colW / 2;
  const logo = inline('sri-mana-wash-horizontal-on-dark.svg', L, 52, 360, 'pb');
  let body = `${frame(W, H, k, { stars: false })}${logo.svg}
<text x="${W - L}" y="96" text-anchor="end" font-family="${SERIF}" font-size="70" fill="#FFFFFF">Price <tspan font-style="italic" fill="url(#foil)">list</tspan></text>
<text x="${W - L}" y="128" text-anchor="end" font-family="${SANS}" font-weight="600" font-size="13.5" letter-spacing="4" fill="#9BAEF5">PRICED BY SIZE, WHATEVER THE BRAND</text>
${ornament(W / 2, 156, W - L * 2, 1.2)}`;
  // Column heads: the car grows with its size.
  CARS.forEach(([kind, label, examples, w], i) => {
    const cx = colX(i);
    body += `<text x="${cx}" y="206" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="15" letter-spacing="1.4" fill="#F8E2B0">${esc(label.toUpperCase())}</text>`;
    body += `<text x="${cx}" y="228" text-anchor="middle" font-family="${SANS}" font-size="13" fill="#9BAEF5">${esc(examples)}</text>`;
  });
  body += `<text x="${L}" y="206" font-family="${SANS}" font-weight="700" font-size="16" letter-spacing="5" fill="#9BAEF5">CAR WASH</text>`;
  body += `<text x="${L}" y="228" font-family="${SANS}" font-size="13" fill="#6F7FC9">Every wash: high-lubricity, pH-neutral shampoo</text>`;
  let y = 248;
  // Washes, then the care services (catalog.json says which those are), each a row with its
  // price per size. More rows, shorter rows, so the cards below keep their room.
  const careNames = new Set((info.comingSoon ?? []).filter((c) => c.kind === 'protection').map((c) => slug(c.name)));
  const rows = servicesIn('small', 'service');
  const washRows = rows.filter((s) => !careNames.has(s));
  const careRows = rows.filter((s) => careNames.has(s));
  const rowH = rows.length > 4 ? 64 : 80;
  const row = (s) => {
    const c = cardOf(s, 'small');
    const sub = subtitleOf(s, 'small');
    const popular = !!c?.card?.popular;
    const short = rowH < 80;
    if (popular) body += `<rect x="${L - 18}" y="${y + 3}" width="${W - (L - 18) * 2}" height="${rowH - 6}" rx="12" fill="url(#glow)"/><rect x="${L - 18}" y="${y + 3}" width="4" height="${rowH - 6}" rx="2" fill="url(#foil)"/>`;
    body += `<text x="${L}" y="${y + (sub ? (short ? 30 : 38) : short ? 40 : 48)}" font-family="${SERIF}" font-size="${short ? 28 : 31}" fill="#FFFFFF">${esc(titleOf(s, 'small'))}${popular ? `<tspan dx="14" dy="-6" font-family="${SANS}" font-size="12" font-weight="700" letter-spacing="2" fill="#F0CF8E">★ MOST POPULAR</tspan>` : ''}</text>`;
    if (sub) body += `<text x="${L}" y="${y + (short ? 51 : 62)}" font-family="${SANS}" font-size="${short ? 13 : 14}" fill="#9BAEF5">${esc(sub.replace(/\.$/, ''))}</text>`;
    CARS.forEach(([section], i) => {
      body += `<text x="${colX(i)}" y="${y + (short ? 43 : 52)}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="${short ? 31 : 34}" fill="${popular ? '#FFF1CF' : '#FFFFFF'}">${rupees(price(s, section))}</text>`;
    });
    y += rowH;
    body += `<rect x="${L}" y="${y}" width="${W - L * 2}" height="1" fill="url(#hair)"/>`;
  };
  washRows.forEach(row);
  if (careRows.length) {
    body += `<text x="${L}" y="${y + 24}" font-family="${SANS}" font-weight="700" font-size="13" letter-spacing="5" fill="#9BAEF5">CARE &amp; PROTECTION</text>`;
    y += 30;
    careRows.forEach(row);
  }
  // Premium Care: an add-on with a price per size, framed in gold foil.
  for (const s of servicesIn('small', 'addon')) {
    y += 12;
    const boxH = 70;
    const sub = (subtitleOf(s, 'small') ?? '').replace(/\.$/, '');
    body += `<rect x="${L - 18}" y="${y}" width="${W - (L - 18) * 2}" height="${boxH}" rx="14" fill="url(#glass)" stroke="url(#foilH)" stroke-width="1.8"/>`;
    body += `<text x="${L}" y="${y + 32}" font-family="${SERIF}" font-size="28" fill="#FFFFFF">${esc(titleOf(s, 'small'))}<tspan dx="12" dy="-5" font-family="${SANS}" font-size="11" font-weight="700" letter-spacing="1.8" fill="#F0CF8E">ADD-ON · WITH ANY WASH</tspan></text>`;
    body += `<text x="${L}" y="${y + 54}" font-family="${SANS}" font-size="13" fill="#C4CCF0">${esc(sub)}</text>`;
    CARS.forEach(([section], i) => {
      body += `<text x="${colX(i)}" y="${y + 45}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="31" fill="url(#foil)">+${rupees(price(s, section))}</text>`;
    });
    y += boxH;
  }
  // Three cards: two-wheelers, monthly plans, WhatsApp.
  const cy = y + 22;
  const ch = H - 68 - cy;
  const gap = 22;
  const cw = (W - L * 2 - gap * 2) / 3;
  const card = (x, highlight) => `<rect x="${x}" y="${cy}" width="${cw}" height="${ch}" rx="16" fill="url(#glass)" stroke="${highlight ? 'url(#foilH)' : '#9BAEF5'}" stroke-opacity="${highlight ? 1 : 0.3}" stroke-width="${highlight ? 1.6 : 1}"/>`;
  // a) two-wheelers
  let x = L;
  body += card(x, false);
  body += `<text x="${x + 26}" y="${cy + 36}" font-family="${SERIF}" font-size="25" fill="#FFFFFF">Bikes &amp; scooters</text>`;
  body += `<text x="${x + 26}" y="${cy + 56}" font-family="${SANS}" font-size="12.5" letter-spacing="1.4" fill="#9BAEF5">ONE PRICE FOR EVERY BIKE</text>`;
  const bikeRows = [...servicesIn('bike', 'service').map((s) => [titleOf(s, 'bike').replace(/^Bike /, ''), rupees(price(s, 'bike')), false]), ...servicesIn('bike', 'addon').map((s) => [titleOf(s, 'bike'), `+${rupees(price(s, 'bike'))}`, true])];
  // Rows close up a little when the card is short, so the last one stays inside it.
  const bikeGap = Math.min(21, (ch - 92) / Math.max(1, bikeRows.length - 1));
  bikeRows.forEach(([name, amount, gold], i) => {
    const ry = cy + 78 + i * bikeGap;
    body += `<text x="${x + 26}" y="${ry}" font-family="${SANS}" font-size="15" fill="${gold ? '#F0CF8E' : '#E6EAFF'}">${esc(name)}</text>`;
    body += `<path d="M${x + 150} ${ry - 4}H${x + cw - 96}" stroke="#9BAEF5" stroke-opacity="0.35" stroke-dasharray="1.5 4"/>`;
    body += `<text x="${x + cw - 26}" y="${ry}" text-anchor="end" font-family="${SANS}" font-weight="700" font-size="16" fill="${gold ? '#F0CF8E' : '#FFFFFF'}">${amount}</text>`;
  });
  // b) monthly plans
  x += cw + gap;
  const planFrom = Math.min(...servicesIn('small', 'plan').map((s) => price(s, 'small')).filter((n) => n != null));
  const save = Math.max(...servicesIn('small', 'plan').filter((s) => !/-\d+-months?$/.test(s)).flatMap((s) => CARS.map(([sec]) => Number(String(cardOf(s, sec)?.card?.footer ?? '').replace(/[^\d]/g, '')) || 0)));
  body += card(x, true);
  body += `<text x="${x + 26}" y="${cy + 36}" font-family="${SERIF}" font-size="25" fill="#FFFFFF">Monthly plans</text>`;
  body += `<text x="${x + 26}" y="${cy + 56}" font-family="${SANS}" font-size="12.5" letter-spacing="1.4" fill="#9BAEF5">4 WASHES A MONTH</text>`;
  body += `<text x="${x + 26}" y="${cy + 104}" font-family="${SANS}" font-size="15" fill="#C4CCF0">from <tspan font-weight="700" font-size="30" fill="url(#foil)">${rupees(planFrom)}</tspan><tspan dx="6" font-size="15" fill="#C4CCF0">a month</tspan></text>`;
  if (save) body += `<text x="${x + 26}" y="${cy + 128}" font-family="${SANS}" font-size="14" fill="#E6EAFF">Save up to ${rupees(save)} · 3 &amp; 12 months save more</text>`;
  // c) WhatsApp
  x += cw + gap;
  body += card(x, false);
  const qs = Math.min(ch - 32, 118);
  body += qrTile(CHAT_URL, x + 18, cy + (ch - qs) / 2, qs);
  const tx = x + 18 + qs + 18;
  body += `<text x="${tx}" y="${cy + 40}" font-family="${SERIF}" font-size="25" fill="#FFFFFF">Scan &amp; say <tspan font-style="italic" fill="url(#foil)">Hi</tspan></text>`;
  body += `<text x="${tx}" y="${cy + 66}" font-family="${SANS}" font-size="14" fill="#C4CCF0">your car's exact price,</text>`;
  body += `<text x="${tx}" y="${cy + 85}" font-family="${SANS}" font-size="14" fill="#C4CCF0">plans &amp; bills on WhatsApp</text>`;
  body += `<text x="${tx}" y="${cy + 112}" font-family="${SANS}" font-weight="700" font-size="17" letter-spacing="0.6" fill="#F8E2B0">${NUMBERS.split(' · ')[0]}</text>`;
  body += `<text x="${tx}" y="${cy + 134}" font-family="${SANS}" font-weight="700" font-size="17" letter-spacing="0.6" fill="#F8E2B0">${NUMBERS.split(' · ')[1]}</text>`;
  body += `<text x="${W / 2}" y="${H - 36}" text-anchor="middle" font-family="${SANS}" font-size="14" letter-spacing="3" fill="#9BAEF5">${esc(ADDRESS.toUpperCase())}  ·  ${esc(HOURS.toUpperCase())}</text>`;
  await write('price-board-4x3ft', W, H, body, 'Sri Mana Wash price board (4 ft × 3 ft)');
}

// ─── 4. Waiting-area poster (A3) ─────────────────────────────────────────────
{
  const W = 297;
  const H = 420;
  const k = 0.5;
  const logo = inline('sri-mana-wash-stacked-on-dark.svg', (W - 124) / 2, 30, 124, 'wt');
  let y = 30 + logo.height + 38;
  let body = `${frame(W, H, k)}${logo.svg}
<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${SERIF}" font-size="30" fill="#FFFFFF">Relax.</text>
<text x="${W / 2}" y="${y + 24}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="15" fill="url(#gold)">We'll WhatsApp you when it's ready.</text>`;
  y += 62;
  const steps = [
    ['wash', 'We wash it', 'with care, inside and out'],
    ['chat', 'We WhatsApp you', `"Ready for pickup" from ${NUMBER}`],
    ['bill', 'Pick it up', 'and your bill comes on WhatsApp'],
  ];
  steps.forEach(([icon, title, line], i) => {
    const sy = y + i * 42;
    body += ringIcon(icon, 58, sy + 14, 14);
    body += `<text x="84" y="${sy + 11}" font-family="${SANS}" font-weight="700" font-size="10" fill="#FFFFFF">${i + 1}. ${esc(title)}</text>`;
    body += `<text x="84" y="${sy + 24}" font-family="${SANS}" font-size="7.6" fill="#C4CCF0">${esc(line)}</text>`;
    if (i < steps.length - 1) body += `<path d="M58 ${sy + 30} v12" stroke="#E8BF78" stroke-opacity="0.5" stroke-width="0.8" stroke-dasharray="1.6 1.6"/>`;
  });
  y += 128;
  const qs = 56;
  body += `<rect x="30" y="${y}" width="${W - 60}" height="${qs + 20}" rx="10" fill="url(#panel)" stroke="#E8BF78" stroke-opacity="0.45" stroke-width="0.6"/>`;
  body += qrTile(CHAT_URL, 40, y + 10, qs);
  body += `<text x="${40 + qs + 14}" y="${y + 30}" font-family="${SANS}" font-weight="700" font-size="9.4" fill="#FFFFFF">Not on our WhatsApp yet?</text>`;
  body += `<text x="${40 + qs + 14}" y="${y + 44}" font-family="${SANS}" font-size="8" fill="#C4CCF0">Scan &amp; say <tspan font-weight="700" fill="#F8E2B0">Hi</tspan> to get the</text>`;
  body += `<text x="${40 + qs + 14}" y="${y + 56}" font-family="${SANS}" font-size="8" fill="#C4CCF0">ready message and your bill</text>`;
  body += `<text x="${W / 2}" y="${H - 16}" text-anchor="middle" font-family="${SANS}" font-size="6.4" letter-spacing="1.4" fill="#9BAEF5">${esc(HOURS.toUpperCase())}</text>`;
  await write('waiting-area-a3', W, H, body, 'Sri Mana Wash waiting area poster (A3)');
}

// ─── 5. Valuables notice (A3) ────────────────────────────────────────────────
{
  const W = 297;
  const H = 420;
  const k = 0.5;
  const logo = inline('sri-mana-wash-horizontal-on-dark.svg', (W - 150) / 2, 28, 150, 'vl');
  let y = 28 + logo.height + 34;
  let body = `${frame(W, H, k)}${logo.svg}
<rect x="${W / 2 - 46}" y="${y - 12}" width="92" height="17" rx="8.5" fill="url(#gold)"/>
<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="7.6" letter-spacing="2.4" fill="#1B2878">PLEASE NOTE</text>
<text x="${W / 2}" y="${y + 36}" text-anchor="middle" font-family="${SERIF}" font-size="25" fill="#FFFFFF">Take your valuables</text>
<text x="${W / 2}" y="${y + 62}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="25" fill="url(#gold)">with you</text>`;
  y += 104;
  const items = [
    ['cash', 'Cash & wallets'],
    ['phone', 'Phones'],
    ['gold', 'Gold & jewellery'],
    ['docs', 'Documents'],
    ['keys', 'Spare keys'],
    ['glasses', 'Glasses'],
  ];
  const colW = (W - 60) / 3;
  items.forEach(([icon, label], i) => {
    const cx = 30 + colW * (i % 3) + colW / 2;
    const cy = y + Math.floor(i / 3) * 70 + 20;
    body += ringIcon(icon, cx, cy, 17);
    body += `<text x="${cx}" y="${cy + 31}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="8" fill="#FFFFFF">${esc(label)}</text>`;
  });
  y += 150;
  body += `<rect x="40" y="${y}" width="${W - 80}" height="0.6" fill="url(#goldLine)"/>`;
  body += `<text x="${W / 2}" y="${y + 18}" text-anchor="middle" font-family="${SANS}" font-size="7.6" fill="#C4CCF0">We are not responsible for items left in the vehicle.</text>`;
  body += `<text x="${W / 2}" y="${H - 22}" text-anchor="middle" font-family="${SANS}" font-size="6.4" letter-spacing="1.4" fill="#9BAEF5">THANK YOU</text>`;
  await write('valuables-notice-a3', W, H, body, 'Sri Mana Wash valuables notice (A3)');
}

// ─── 6. Highway board (6 × 3 ft) ─────────────────────────────────────────────
// Read from a moving vehicle: the brand big on the night side, and a gold panel with one huge
// arrow and the distance. Nothing small enough to need stopping for.
{
  const W = 1830;
  const H = 915;
  const right = HIGHWAY.arrow !== 'left';
  const panelX = 1270; // where the gold panel's curved edge starts
  const markH = 400;
  const markW = markH * (295.1 / 383.5);
  const mark = inline('sri-mana-wash-mark.svg', 110, (H - markH) / 2 - 20, markW, 'hw');
  const tx = 110 + markW + 64;
  const textW = panelX - tx - 110; // stays clear of the panel's curve
  const name = inline('sri-mana-wash-name-on-dark.svg', tx, 250, textW, 'hn');
  // The panel: gold foil with a soft S-curve against the night.
  const panel = `<path d="M${panelX} 0 C ${panelX - 70} ${H * 0.35}, ${panelX + 40} ${H * 0.65}, ${panelX - 40} ${H} H${W} V0 Z" fill="url(#foil)"/>` +
    `<path d="M${panelX} 0 C ${panelX - 70} ${H * 0.35}, ${panelX + 40} ${H * 0.65}, ${panelX - 40} ${H}" fill="none" stroke="#FFF6E0" stroke-width="6" stroke-opacity="0.7"/>`;
  const acx = (panelX + W) / 2 - 6; // the arrow's centre
  const ay = 400;
  const aw = 440;
  const shaft = 70;
  const headW = 190;
  const headH = 300;
  const arrow = right
    ? `<path d="M${acx - aw / 2} ${ay - shaft / 2} H${acx + aw / 2 - headW} V${ay - headH / 2} L${acx + aw / 2} ${ay} L${acx + aw / 2 - headW} ${ay + headH / 2} V${ay + shaft / 2} H${acx - aw / 2} Z" fill="#141F66"/>`
    : `<path d="M${acx + aw / 2} ${ay - shaft / 2} H${acx - aw / 2 + headW} V${ay - headH / 2} L${acx - aw / 2} ${ay} L${acx - aw / 2 + headW} ${ay + headH / 2} V${ay + shaft / 2} H${acx + aw / 2} Z" fill="#141F66"/>`;
  const body = `<rect width="${W}" height="${H}" fill="url(#night)"/><rect width="${W}" height="${H}" fill="url(#spot)"/>
${mark.svg}
${name.svg}
<text x="${tx + 4}" y="${250 + name.height + 88}" textLength="${textW - 8}" lengthAdjust="spacing" font-family="${SANS}" font-weight="700" font-size="62" fill="url(#foilH)">CAR &amp; BIKE WASH</text>
<rect x="${tx + 4}" y="${250 + name.height + 128}" width="${textW - 8}" height="2.4" fill="url(#goldLine)"/>
<text x="${tx + 4}" y="${250 + name.height + 190}" textLength="${textW - 8}" lengthAdjust="spacing" font-family="${SANS}" font-weight="600" font-size="40" fill="#E6EAFF">7 AM – 8 PM <tspan fill="#9BAEF5" font-weight="500">· CLOSED MONDAYS</tspan></text>
${ribbon(panelX, H - 90, 2.4)}
${panel}
${arrow}
<text x="${acx}" y="${ay + 290}" text-anchor="middle" font-family="${SERIF}" font-size="160" fill="#141F66">${esc(HIGHWAY.distance)}</text>
<rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="26" fill="none" stroke="#E8BF78" stroke-opacity="0.65" stroke-width="3"/>`;
  await write('highway-board-6x3ft', W, H, body, 'Sri Mana Wash highway direction board (6 ft × 3 ft)');
}
