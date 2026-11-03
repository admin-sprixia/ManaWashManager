// The shop's working signs, in the shop posters' indigo and gold (and, for the staff room, the
// training sheets' pearl):
//   lift safety      (A2)          · at the lift: staff only, stay clear of a raised car
//   what happens     (6 × 3 ft)    · the waiting-area wall: each wash's steps, so customers see what
//                                   the next wash up adds (no prices: the price board has them)
//   entry / exit     (A3, ×4)      · each with the arrow pointing left or right, to suit the yard
//   closed Mondays   (A3)          · for the shutter on Mondays
//   staff checklists (A4, ×2)     · opening the shop in the morning, closing it at night
// English only (the logo's శ్రీ aside); products by their SMW names, never a supplier's (the build
// stops if one slips in). Each as a print-ready SVG, vector PDF and PNG preview.
//   npm run signs
// 1 unit = 1 mm.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputDir } from '../../lib/output.mjs';
import { CHAT_URL, esc, frame, HOURS, inline, NUMBERS, ornament, qrTile, SANS, SERIF, silhouette, sparkle, writer } from '../../lib/poster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const write = writer(outputDir(HERE));
/** Brands we buy from and machines we use: trade secrets, never on a sign. */
const SECRET = /k(a|ä)rcher|wavex|motul|shakti|hybrid-?x|autogo|plvr/i;
const RED = '#E5484D';

/** Writes a sign, after checking it names no supplier. */
async function sign(name, W, H, body, label) {
  const leak = body.match(SECRET);
  if (leak) throw new Error(`${name} names a supplier ("${leak[0]}"); use the SMW name`);
  await write(name, W, H, body, label);
}

/** A car lifted on the lift: the car, its two posts and pads, the floor. */
function liftedCar(cx, floorY, w, lift) {
  const carBase = floorY - lift;
  const k = w / 140;
  const post = (x) =>
    `<rect x="${x - 3}" y="${floorY - lift - 6}" width="6" height="${lift + 6}" rx="1.5" fill="#F0CF8E" fill-opacity="0.85"/>` +
    `<rect x="${x - 10}" y="${carBase - 2.5}" width="20" height="5" rx="2" fill="#F0CF8E"/>`;
  return (
    silhouette('mid', cx, carBase - 0.5 * k - 2.5, w) +
    post(cx - w * 0.36) +
    post(cx + w * 0.36) +
    `<rect x="${cx - w * 0.6}" y="${floorY}" width="${w * 1.2}" height="1.4" fill="#F0CF8E" fill-opacity="0.6"/>`
  );
}

/** A filled arrow pointing right (or left), w × h, centred at (cx, cy). */
function arrow(cx, cy, w, h, right = true, fill = 'url(#foil)') {
  const shaft = h * 0.36;
  const head = w * 0.42;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const d = right
    ? `M${x0} ${cy - shaft / 2}H${x1 - head}V${cy - h / 2}L${x1} ${cy}L${x1 - head} ${cy + h / 2}V${cy + shaft / 2}H${x0}Z`
    : `M${x1} ${cy - shaft / 2}H${x0 + head}V${cy - h / 2}L${x0} ${cy}L${x0 + head} ${cy + h / 2}V${cy + shaft / 2}H${x1}Z`;
  return `<path d="${d}" fill="${fill}"/>`;
}

// ─── 1. Lift safety (A2) ─────────────────────────────────────────────────────
{
  const W = 420;
  const H = 594;
  const logo = inline('sri-mana-wash-horizontal-on-dark.svg', (W - 190) / 2, 44, 190, 'ls');
  const rules = [
    ['Please don\'t walk near or under a raised car', 'no'],
    ['Only our staff work the lift', 'staff'],
    ['Keep children with you in the waiting area', 'child'],
  ];
  const glyph = {
    no: `<circle cx="0" cy="0" r="9" fill="none" stroke="${RED}" stroke-width="2.2"/><path d="M-6.4 6.4L6.4 -6.4" stroke="${RED}" stroke-width="2.2" stroke-linecap="round"/>`,
    staff: `<circle cx="0" cy="-4.5" r="3.6" fill="none" stroke="#F0CF8E" stroke-width="1.8"/><path d="M-7.5 8.5q0-7.5 7.5-7.5t7.5 7.5" fill="none" stroke="#F0CF8E" stroke-width="1.8" stroke-linecap="round"/>`,
    child: `<circle cx="-3.5" cy="-5" r="3" fill="none" stroke="#F0CF8E" stroke-width="1.7"/><circle cx="5" cy="-2" r="2.3" fill="none" stroke="#F0CF8E" stroke-width="1.7"/><path d="M-9.5 8q0-6.5 6-6.5t6 6.5M1.5 8q0-4.6 3.5-4.6t3.5 4.6" fill="none" stroke="#F0CF8E" stroke-width="1.7" stroke-linecap="round"/>`,
  };
  let body = `${frame(W, H, 0.7)}${logo.svg}`;
  body += `<rect x="${W / 2 - 62}" y="118" width="124" height="24" rx="12" fill="${RED}"/>`;
  body += `<text x="${W / 2}" y="134.5" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="11.5" letter-spacing="4" fill="#FFFFFF">STAFF ONLY</text>`;
  body += `<text x="${W / 2}" y="200" text-anchor="middle" font-family="${SERIF}" font-size="56" fill="#FFFFFF">Lift in use</text>`;
  body += `<text x="${W / 2}" y="238" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="34" fill="url(#foil)">please stay clear</text>`;
  // The lift with a car up, and the red keep-out zone beneath it.
  body += `<rect x="${W / 2 - 92}" y="330" width="184" height="66" rx="6" fill="${RED}" fill-opacity="0.12" stroke="${RED}" stroke-width="1.4" stroke-dasharray="5 4"/>`;
  body += liftedCar(W / 2, 396, 200, 62);
  body += `<text x="${W / 2}" y="385" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="9" letter-spacing="3" fill="${RED}">KEEP OUT</text>`;
  body += ornament(W / 2, 424, 220, 0.7);
  rules.forEach(([line, g], i) => {
    const y = 458 + i * 34;
    body += `<g transform="translate(${W / 2 - 128} ${y})"><circle r="13.5" fill="#FFFFFF" fill-opacity="0.06" stroke="#E8BF78" stroke-opacity="0.55" stroke-width="0.8"/>${glyph[g]}</g>`;
    body += `<text x="${W / 2 - 104}" y="${y + 4.5}" font-family="${SANS}" font-weight="600" font-size="13" fill="#FFFFFF">${esc(line)}</text>`;
  });
  body += `<text x="${W / 2}" y="${H - 34}" text-anchor="middle" font-family="${SANS}" font-size="9.5" letter-spacing="2.4" fill="#9BAEF5">THANK YOU FOR KEEPING EVERYONE SAFE</text>`;
  await sign('lift-safety-a2', W, H, body, 'Sri Mana Wash lift safety sign (A2)');
}

// ─── 2. What happens to your car (6 × 3 ft) ──────────────────────────────────
// Three columns, Express · Basic · Premium, each building on the one before, in customer words.
{
  const W = 1830;
  const H = 915;
  const WASHES = [
    { name: 'Express', time: '25 MIN', place: 'ON THE GROUND', from: null,
      steps: ['Wheels & tyres scrubbed', 'Rinse, then thick snow foam', 'Two-bucket hand wash', 'Towel dry & door edges', 'Outside glass polished', 'Tyre shine & rubber mats'] },
    { name: 'Basic', time: '45 MIN', place: 'ON THE LIFT', from: 'Express', popular: true,
      steps: ['Underbody & arches rinsed', 'Air blow & full vacuum', 'Seats, floor, boot & cloth mats', 'Dashboard & door panel shine', 'Glass inside & out'] },
    { name: 'Premium', time: '50 MIN', place: 'ON THE LIFT', from: 'Basic',
      steps: ['Seats, steering & vents cleaned', 'Spray wax on the paint', 'Black trim shine', 'Rain repellent on the windscreen', 'Windscreen washer topped up'] },
  ];
  const logo = inline('sri-mana-wash-horizontal-on-dark.svg', 90, 66, 300, 'wh');
  let body = `${frame(W, H, 1.6)}${logo.svg}`;
  body += `<text x="${W - 90}" y="96" text-anchor="end" font-family="${SANS}" font-weight="700" font-size="22" letter-spacing="8" fill="#9BAEF5">OUR THREE WASHES</text>`;
  body += `<text x="${W / 2}" y="198" text-anchor="middle" font-family="${SERIF}" font-size="86" fill="#FFFFFF">What happens to <tspan font-style="italic" fill="url(#foil)">your car</tspan></text>`;
  body += ornament(W / 2, 232, 560, 1.3);
  const top = 268;
  const cardH = 500;
  const gap = 46;
  const cw = (W - 180 - gap * 2) / 3;
  WASHES.forEach((w, i) => {
    const x = 90 + i * (cw + gap);
    const mid = x + cw / 2;
    const hot = !!w.popular;
    body += `<rect x="${x}" y="${top}" width="${cw}" height="${cardH}" rx="26" fill="${hot ? 'url(#glow)' : 'url(#panel)'}" stroke="${hot ? 'url(#foilH)' : '#9BAEF5'}" stroke-opacity="${hot ? 1 : 0.35}" stroke-width="${hot ? 3.2 : 1.6}"/>`;
    if (hot) {
      body += `<rect x="${mid - 140}" y="${top - 20}" width="280" height="40" rx="20" fill="url(#gold)"/>`;
      body += `<text x="${mid}" y="${top + 8}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="18" letter-spacing="4" fill="#1B2878">★ MOST POPULAR</text>`;
    }
    body += `<text x="${x + 40}" y="${top + 92}" font-family="${SERIF}" font-size="64" fill="#FFFFFF">${w.name}&#160;<tspan font-style="italic" fill="url(#foil)">wash</tspan></text>`;
    body += `<text x="${x + 42}" y="${top + 134}" font-family="${SANS}" font-weight="700" font-size="20" letter-spacing="3" fill="#F0CF8E">${w.time}<tspan dx="12" fill="#9BAEF5">·</tspan><tspan dx="12" fill="#9BAEF5">${w.place}</tspan></text>`;
    body += `<rect x="${x + 40}" y="${top + 158}" width="${cw - 80}" height="1.4" fill="url(#hair)"/>`;
    let y = top + 206;
    if (w.from) {
      body += `<text x="${x + 40}" y="${y}" font-family="${SERIF}" font-style="italic" font-size="30" fill="url(#foil)">Everything in ${w.from}, plus</text>`;
      y += 52;
    }
    w.steps.forEach((step, j) => {
      body += `<circle cx="${x + 58}" cy="${y - 9}" r="17" fill="none" stroke="#E8BF78" stroke-width="1.8"/>`;
      body += `<text x="${x + 58}" y="${y - 1.5}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="20" fill="#F8E2B0">${j + 1}</text>`;
      body += `<text x="${x + 92}" y="${y}" font-family="${SANS}" font-weight="600" font-size="26" fill="#FFFFFF">${esc(step)}</text>`;
      y += 50;
    });
    if (y - 50 > top + cardH - 24) console.warn(`  what-happens: ${w.name} runs over`);
    if (i < 2) body += `<path d="M${x + cw + 10} ${top + cardH / 2 - 18}l18 18-18 18" fill="none" stroke="#E8BF78" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  // Premium Care, along the bottom.
  const sy = top + cardH + 34;
  body += `<rect x="90" y="${sy}" width="${W - 180}" height="74" rx="37" fill="url(#panel)" stroke="url(#foilH)" stroke-width="2"/>`;
  body += sparkle(140, sy + 37, 16);
  body += `<text x="176" y="${sy + 47}" font-family="${SANS}" font-size="27" fill="#E6EAFF">Add <tspan font-family="${SERIF}" font-style="italic" font-size="36" fill="url(#foil)">Premium Care</tspan> to any wash  ·  thick yellow snow foam &amp; a wash-and-wax lather for a deep, glossy shine</text>`;
  body += sparkle(W - 140, sy + 37, 12, '#F8E2B0', 0.8);
  await sign('what-happens-6x3ft', W, H, body, 'Sri Mana Wash: what happens to your car (6 ft × 3 ft)');
}

// ─── 3. Entry / exit (A3 landscape, each arrow both ways) ────────────────────
for (const [word, sub] of [
  ['ENTRY', 'Cars & bikes in'],
  ['EXIT', 'Thank you · drive safe'],
]) {
  for (const right of [true, false]) {
    const W = 420;
    const H = 297;
    const logo = inline('sri-mana-wash-horizontal-on-dark.svg', (W - 130) / 2, 30, 130, `e${word}${right}`);
    let body = `${frame(W, H, 0.6)}${logo.svg}`;
    body += `<text x="${W / 2}" y="132" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="74" letter-spacing="14" fill="#FFFFFF">${word}</text>`;
    body += arrow(W / 2, 190, 200, 64, right);
    body += `<text x="${W / 2}" y="${H - 38}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="20" fill="url(#foil)">${esc(sub)}</text>`;
    await sign(`${word.toLowerCase()}-${right ? 'right' : 'left'}-a3`, W, H, body, `Sri Mana Wash ${word.toLowerCase()} sign, arrow ${right ? 'right' : 'left'} (A3)`);
  }
}

// ─── 4. Closed on Mondays (A3) ───────────────────────────────────────────────
{
  const W = 297;
  const H = 420;
  const logo = inline('sri-mana-wash-stacked-on-dark.svg', (W - 120) / 2, 30, 120, 'cm');
  let y = 30 + logo.height + 40;
  let body = `${frame(W, H, 0.5)}${logo.svg}`;
  body += `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="8.5" letter-spacing="4" fill="#9BAEF5">WEEKLY HOLIDAY</text>`;
  body += `<text x="${W / 2}" y="${y + 36}" text-anchor="middle" font-family="${SERIF}" font-size="38" fill="#FFFFFF">Closed on</text>`;
  body += `<text x="${W / 2}" y="${y + 72}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="40" fill="url(#foil)">Mondays</text>`;
  y += 96;
  body += ornament(W / 2, y, 160, 0.5);
  body += `<text x="${W / 2}" y="${y + 24}" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="12" fill="#FFFFFF">Open Tuesday to Sunday</text>`;
  body += `<text x="${W / 2}" y="${y + 42}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="14" letter-spacing="1" fill="#F0CF8E">7 AM – 8 PM</text>`;
  y += 64;
  const qs = 60;
  body += `<rect x="30" y="${y}" width="${W - 60}" height="${qs + 20}" rx="10" fill="url(#panel)" stroke="#E8BF78" stroke-opacity="0.45" stroke-width="0.6"/>`;
  body += qrTile(CHAT_URL, 40, y + 10, qs);
  body += `<text x="${40 + qs + 14}" y="${y + 30}" font-family="${SANS}" font-weight="700" font-size="10" fill="#FFFFFF">Message us anytime</text>`;
  body += `<text x="${40 + qs + 14}" y="${y + 45}" font-family="${SANS}" font-size="8.4" fill="#C4CCF0">Scan &amp; say <tspan font-weight="700" fill="#F8E2B0">Hi</tspan> on WhatsApp:</text>`;
  body += `<text x="${40 + qs + 14}" y="${y + 57}" font-family="${SANS}" font-size="8.4" fill="#C4CCF0">prices, plans and bookings</text>`;
  body += `<text x="${W / 2}" y="${H - 34}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="10" letter-spacing="1.5" fill="#F8E2B0">${esc(NUMBERS)}</text>`;
  body += `<text x="${W / 2}" y="${H - 20}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="11" fill="#C4CCF0">See you tomorrow</text>`;
  await sign('closed-mondays-a3', W, H, body, 'Sri Mana Wash closed on Mondays sign (A3)');
}

// ─── 5. Staff checklists (A4, pearl, like the training sheets) ───────────────
const PEARL = `<defs>
<linearGradient id="pearlBg" x1="0" y1="0" x2="0.12" y2="1"><stop offset="0" stop-color="#FDFCF8"/><stop offset="1" stop-color="#EFEDE6"/></linearGradient>
<linearGradient id="goldDeepS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D2A250"/><stop offset="0.55" stop-color="#B07C2C"/><stop offset="1" stop-color="#8E5D1B"/></linearGradient>
</defs>`;
for (const sheet of [
  {
    file: 'staff-opening-checklist-a4',
    title: ['Opening', 'checklist'],
    sub: 'Every morning, before the first car',
    sections: [
      ['Shop', ['Shutter up, lights and power on', 'Water tank full, taps and hoses on', 'Bay floors swept, no hoses across the drive']],
      ['Lift', ['Lift area clear: nobody, nothing under it', 'Up and down once, empty: smooth, lock clicks', 'Lift pads clean and in place']],
      ['Pressure washers', ['Water connected, hoses straight, at the side', 'Wide fan nozzle on: never the pencil jet', 'Spray a few seconds on the floor', 'Foam lance bottles filled with SMW Foam']],
      ['Compressor & vacuum', ['Compressor on, air gun and hose: no leaks', 'Vacuum empty, filter clean, tools on the trolley']],
      ['Buckets & bottles', ['WHEELS and SHAMPOO buckets: SMW Shampoo, 1 : 9 to 1 : 10', 'RINSE bucket: plain water', 'GLASS bottle: 1 L in 20 L of water', 'Inside Cleaner (20 ml) and Leather Wash (10 ml) in 500 ml', 'Wax bottle and washer can: ready mixed']],
      ['Towels & counter', ['Boxes full: OUTSIDE · INSIDE · WAX and GLASS', 'Plush Care towels in their own box', 'App open · MANA Pay QR and the menu on the counter']],
    ],
  },
  {
    file: 'staff-closing-checklist-a4',
    title: ['Closing', 'checklist'],
    sub: 'Every night, after the last car',
    sections: [
      ['Cars & app', ['Every car handed over and marked Done', 'Things left in cars kept safe at the counter']],
      ['Lift', ['Lift fully down, nothing on or under it', 'Power to the lift off']],
      ['Machines', ['Pressure washers off, hoses coiled and hung up', 'Foam lances rinsed with clean water', 'Compressor off, tank drained', 'Vacuum emptied, filter tapped clean']],
      ['Buckets & bottles', ['Buckets emptied, rinsed, upside down to dry', 'Bottles capped, cans closed, back on the shelf', 'Note any product running low for the owner']],
      ['Towels', ['Used towels into the laundry by box: OUTSIDE · INSIDE · WAX and GLASS', 'Plush Care towels washed on their own']],
      ['Shop', ['Bay floors rinsed and squeegeed', 'Taps off, lights off, shutter down and locked']],
    ],
  },
]) {
  const W = 210;
  const H = 297;
  const L = 18;
  const R = W - 18;
  let body = `${PEARL}<rect width="${W}" height="${H}" fill="url(#pearlBg)"/>`;
  body += `<rect x="5" y="5" width="${W - 10}" height="${H - 10}" rx="5" fill="none" stroke="url(#goldDeepS)" stroke-opacity="0.8" stroke-width="0.7"/>`;
  const logo = inline('sri-mana-wash-horizontal-on-light.svg', L, 18, 50, `sc${sheet.file}`);
  body += logo.svg;
  body += `<text x="${R}" y="20" text-anchor="end" font-family="${SANS}" font-weight="700" font-size="3.2" letter-spacing="1.4" fill="#5C6AA8">STAFF</text>`;
  body += `<text x="${R}" y="34" text-anchor="end" font-family="${SERIF}" font-size="13" fill="#1B2878">${sheet.title[0]} <tspan font-style="italic" fill="url(#goldDeepS)">${sheet.title[1]}</tspan></text>`;
  body += `<rect x="${L}" y="41" width="${R - L}" height="0.35" fill="#C99A4E"/>`;
  body += `<text x="${L}" y="48.5" font-family="${SANS}" font-size="4.2" fill="#5C6AA8">${esc(sheet.sub)} · tick each one</text>`;
  let y = 60;
  for (const [head, items] of sheet.sections) {
    body += `<text x="${L}" y="${y}" font-family="${SANS}" font-weight="700" font-size="3.6" letter-spacing="1.2" fill="#8E5D1B">${esc(head.toUpperCase())}</text>`;
    y += 6.8;
    for (const item of items) {
      body += `<rect x="${L}" y="${y - 4.2}" width="4.8" height="4.8" rx="1" fill="none" stroke="#1B2878" stroke-width="0.45"/>`;
      body += `<text x="${L + 8}" y="${y}" font-family="${SANS}" font-size="4.6" fill="#141B47">${esc(item)}</text>`;
      y += 7.6;
    }
    y += 3;
  }
  if (y > H - 22) console.warn(`  ${sheet.file}: runs over (${Math.round(y)} of ${H - 22})`);
  body += `<text x="${W / 2}" y="${H - 12}" text-anchor="middle" font-family="${SANS}" font-size="3" letter-spacing="1" fill="#5C6AA8">SRI MANA WASH · DONE BY ____________ · DATE ________</text>`;
  await sign(sheet.file, W, H, body, `Sri Mana Wash staff ${sheet.title.join(' ')} (A4)`);
}
