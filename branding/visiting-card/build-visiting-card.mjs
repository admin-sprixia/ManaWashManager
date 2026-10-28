// Builds the Sri Mana Wash visiting card (front and back) as print-ready SVGs and PDFs, plus PNG previews.
//   PYTHON=/path/to/python-with-fonttools node branding/visiting-card/build-visiting-card.mjs
//
// Same look as the shop name board (branding/flex/actual-name-board): night indigo with a soft glow,
// the glass mark with its red centre drop, శ్రీ in gold, Didot Bold and Avenir Next outlined to paths,
// a thin gold border and the fine-line water ribbon.
// Card: 3.6 × 2.1 in (91.44 × 53.34 mm) with 3 mm bleed on every side, 1 unit = 0.1 mm, so each
// file is 974.4 × 593.4 units and the trim line sits 30 units in. Keep everything that matters inside SAFE.
// Front: the mark, శ్రీ MANA WASH and the tagline. Back: the mark, then the proprietor, both numbers
// and the address, with what we do along the bottom; in night indigo, and a pearl (ivory) alternative. Check the details before printing.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.PYTHON || 'python3';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const OWNER = 'Hrushikesh Vetagiri';
const PHONES = { primary: '91547 52999', secondary: '77802 76797' };
// The shop's address, as it is set on the card (three lines).
const ADDRESS = ['Door No 1-0, Near Highway', 'Sai Baba Temple, Kovur,', 'SPSR Nellore District – 524137'];
const TAGLINE = 'Where every ride shines.';
const SERVICES = ['Car & bike wash', 'Doorstep wash', 'Monthly plans', 'Anti-rust coating'];

const BLEED = 30;
const TRIM_W = 914.4; // 3.6 in
const TRIM_H = 533.4; // 2.1 in
const W = TRIM_W + BLEED * 2;
const H = TRIM_H + BLEED * 2;
const SAFE = BLEED + 44; // text and the mark stay inside this inset (4.4 mm from the cut)

const C = {
  night0: '#1B2878',
  night1: '#0C1442',
  night2: '#060A22',
  glow: '#5468D4',
  aqua: '#5EEAD4',
  white: '#FFFFFF',
  pale: '#E6EAFF',
  soft: '#9BAEF5',
  goldLight: '#F8E2B0',
  gold: '#E8BF78',
  goldDeep: '#CF9C52',
};

const n = (v) => String(Math.round(v * 100) / 100);

// ---------- lettering ----------
const SUP = '/System/Library/Fonts/Supplemental';
const DIDOT = `${SUP}/Didot.ttc`;
const AVENIR = '/System/Library/Fonts/Avenir Next.ttc';
const TELUGU = `${SUP}/Telugu Sangam MN.ttc`;
const DIDOT_B = { font: DIDOT, index: 2 };
const DIDOT_I = { font: DIDOT, index: 1 };
const AV_BOLD = { font: AVENIR, index: 0 };
const AV_DEMI = { font: AVENIR, index: 2 };
const AV_MED = { font: AVENIR, index: 5 };

const TEXT = [
  { id: 'sri', font: TELUGU, index: 1, text: 'శ్రీ', size: 100 },
  { id: 'name', ...DIDOT_B, text: 'MANA WASH', size: 70, tracking: 0.12 },
  { id: 'tagline', ...DIDOT_I, text: TAGLINE, size: 38 },
  // the back
  { id: 'owner', ...AV_DEMI, text: OWNER, size: 46, tracking: 0.01 },
  { id: 'ownerLabel', ...AV_BOLD, text: 'PROPRIETOR', size: 17, tracking: 0.42 },
  { id: 'primary', ...AV_MED, text: PHONES.primary, size: 33, tracking: 0.04 },
  { id: 'primaryLabel', ...AV_BOLD, text: 'PRIMARY', size: 14, tracking: 0.3 },
  { id: 'secondary', ...AV_MED, text: PHONES.secondary, size: 33, tracking: 0.04 },
  { id: 'secondaryLabel', ...AV_BOLD, text: 'SECONDARY', size: 14, tracking: 0.3 },
  ...ADDRESS.map((line, i) => ({ id: `addr${i}`, ...AV_MED, text: line, size: 22, tracking: 0.01 })),
  ...SERVICES.map((s, i) => ({ id: `svc${i}`, ...AV_DEMI, text: s, size: 20, tracking: 0.03 })),
];
const T = JSON.parse(execFileSync(PYTHON, [join(HERE, '../card/outline-text.py')], { input: JSON.stringify(TEXT) }).toString());

/** Outlined text. anchor: 'start', 'middle' or 'end'. Baseline at y. */
const text = (id, x, y, fill, anchor = 'start') => {
  const left = anchor === 'middle' ? x - T[id].width / 2 : anchor === 'end' ? x - T[id].width : x;
  return `<path d="${T[id].d}" transform="translate(${n(left)} ${n(y)})" fill="${fill}"/>`;
};

/** శ్రీ scaled to `height` of ink, its ink starting at (x, top). Returns [svg, width]. */
const sri = (x, top, height) => {
  const k = height / (T.sri.bottom - T.sri.top);
  return [`<path d="${T.sri.d}" transform="translate(${n(x)} ${n(top - T.sri.top * k)}) scale(${n(k)})" fill="url(#goldBright)"/>`, T.sri.width * k];
};

// ---------- background ----------
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** A soft radial light, stretched to the card's shape. */
function glow(id, cx, cy, r, color, opacity) {
  const fx = n(cx / W);
  return `<radialGradient id="${id}" cx="${fx}" cy="${cy}" r="${r}" gradientTransform="translate(${fx} ${cy}) scale(1 ${n(W / H)}) translate(-${fx} -${cy})">
  <stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
</radialGradient>`;
}

const defs = (glowX) => `
<linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
  <stop offset="0" stop-color="${C.night0}"/><stop offset="0.6" stop-color="${C.night1}"/><stop offset="1" stop-color="${C.night2}"/>
</linearGradient>
${glow('glowA', glowX, 0.42, 0.55, C.glow, 0.5)}
${glow('glowAqua', W / 2, 1, 0.7, C.aqua, 0.08)}
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.1"/><stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0"/>
</linearGradient>
<linearGradient id="rib" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${C.glow}" stop-opacity="0.1"/><stop offset="0.25" stop-color="${C.soft}" stop-opacity="0.8"/>
  <stop offset="0.5" stop-color="${C.pale}" stop-opacity="0.55"/><stop offset="0.75" stop-color="${C.soft}" stop-opacity="0.8"/>
  <stop offset="1" stop-color="${C.glow}" stop-opacity="0.15"/>
</linearGradient>
<linearGradient id="pearl" x1="0" y1="0" x2="0.3" y2="1">
  <stop offset="0" stop-color="#FDFCF8"/><stop offset="1" stop-color="#EFEDE6"/>
</linearGradient>
<linearGradient id="ribPearl" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#9BAEF5" stop-opacity="0"/><stop offset="0.3" stop-color="#7F92DE" stop-opacity="0.8"/>
  <stop offset="0.7" stop-color="#7F92DE" stop-opacity="0.8"/><stop offset="1" stop-color="#9BAEF5" stop-opacity="0"/>
</linearGradient>
<linearGradient id="goldDeepV" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#C99A4E"/><stop offset="1" stop-color="#A97A30"/>
</linearGradient>
<linearGradient id="goldBright" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFF1CF"/><stop offset="0.5" stop-color="${C.goldLight}"/><stop offset="1" stop-color="${C.gold}"/>
</linearGradient>
<linearGradient id="goldH" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${C.goldDeep}"/><stop offset="0.5" stop-color="${C.goldLight}"/><stop offset="1" stop-color="${C.goldDeep}"/>
</linearGradient>`;

/** The fine-line water ribbon along the bottom. */
function ribbon({ y0, amp, width, lines = 22, waves = 1.6, phase = 0, stroke = 'rib', opacity = 0.5 }) {
  const paths = [];
  for (let i = 0; i < lines; i++) {
    const t = i / (lines - 1) - 0.5;
    let d = '';
    for (let x = -10; x <= W + 10; x += 10) {
      const u = x / W;
      const centre = y0 + amp * Math.sin(u * Math.PI * waves + phase);
      const spread = width * (0.25 + 0.75 * Math.abs(Math.cos(u * Math.PI * waves * 0.72 + phase * 0.6)));
      const y = centre + t * spread + 3 * Math.sin(u * Math.PI * waves * 2 + t * 2);
      d += `${x === -10 ? 'M' : 'L'}${n(x)} ${n(y)}`;
    }
    const edge = 1 - Math.abs(t) * 1.4;
    paths.push(`<path d="${d}" stroke-opacity="${n(0.3 + 0.6 * edge)}"/>`);
  }
  return `<g fill="none" stroke="url(#${stroke})" stroke-width="0.8" stroke-linecap="round" opacity="${opacity}">${paths.join('')}</g>`;
}

const sparkle = (x, y, s, fill = C.goldLight, opacity = 1) =>
  `<path d="M${n(x)} ${n(y - s)}C${n(x + s * 0.12)} ${n(y - s * 0.12)} ${n(x + s * 0.12)} ${n(y - s * 0.12)} ${n(x + s)} ${n(y)}C${n(x + s * 0.12)} ${n(y + s * 0.12)} ${n(x + s * 0.12)} ${n(y + s * 0.12)} ${n(x)} ${n(y + s)}C${n(x - s * 0.12)} ${n(y + s * 0.12)} ${n(x - s * 0.12)} ${n(y + s * 0.12)} ${n(x - s)} ${n(y)}C${n(x - s * 0.12)} ${n(y - s * 0.12)} ${n(x - s * 0.12)} ${n(y - s * 0.12)} ${n(x)} ${n(y - s)}Z" fill="${fill}" fill-opacity="${opacity}"/>`;

const diamond = (x, y, s, fill = C.gold) => `<path d="M${n(x)} ${n(y - s)}l${n(s * 0.75)} ${n(s)}l${n(-s * 0.75)} ${n(s)}l${n(-s * 0.75)} ${n(-s)}Z" fill="${fill}"/>`;

/** The pearl ground for the light back: ivory, a faint indigo ribbon and the gold border. */
function pearlBackdrop() {
  const inset = BLEED + 18;
  return `
<rect width="${W}" height="${H}" fill="url(#pearl)"/>
${ribbon({ y0: H - BLEED - 52, amp: 10, width: 26, phase: 2.1, stroke: 'ribPearl', opacity: 0.35 })}
<rect x="${inset}" y="${inset}" width="${W - inset * 2}" height="${H - inset * 2}" rx="14" fill="none" stroke="url(#goldDeepV)" stroke-opacity="0.7" stroke-width="1.6"/>`;
}

/** The night sky, glow, stars, ribbon and the gold border inside the trim. */
function backdrop(seed) {
  const rand = seeded(seed);
  const stars = Array.from({ length: 22 }, () => [BLEED + rand() * TRIM_W, BLEED + 20 + rand() * (TRIM_H - 40), 0.8 + rand() * 1.2, 0.25 + rand() * 0.5]);
  const inset = BLEED + 18;
  return `
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#glowA)"/>
<rect width="${W}" height="${H}" fill="url(#glowAqua)"/>
<rect width="${W}" height="${H}" fill="url(#sheen)"/>
<g fill="#FFFFFF">${stars.map(([x, y, r, o]) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill-opacity="${n(o)}"/>`).join('')}</g>
${ribbon({ y0: H - BLEED - 52, amp: 10, width: 26, phase: seed * 0.3 })}
<rect x="${inset}" y="${inset}" width="${W - inset * 2}" height="${H - inset * 2}" rx="14" fill="none" stroke="url(#goldH)" stroke-opacity="0.6" stroke-width="1.6"/>`;
}

// ---------- the mark, with the centre drop in red ----------
const markFile = readFileSync(join(HERE, '../concepts/indigo-styles/mark-indigo-white-line.svg'), 'utf8');
const markInner = markFile
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<title>.*?<\/title>/, '')
  .replace(/(<linearGradient id="mk-line"[^>]*>)[\s\S]*?(<\/linearGradient>)/, '$1<stop offset="0" stop-color="#F0483C"/><stop offset="1" stop-color="#B8141F"/>$2')
  // a soft white light behind the red drop (instead of a dark-red blur), so it reads clearly
  .replace(/fill="#FFFFFF" fill-opacity="0.55" filter="url\(#mk-b2\)"/, 'fill="#FFFFFF" fill-opacity="0.7" filter="url(#mk-b2)"')
  // fill in the glass under the drop: the cut-out let the dark underside show around it
  .replace('<g mask="url(#mk-cut)">', '<g>');
const DROP_RATIO = 236 / 168; // the drop is 236 units tall (tip to base, with its edge) for 168 wide

/** The glass mark, centred on cx, its drop tip at `top`, its drop `height` tall. */
function mark(cx, top, height) {
  const w = height / DROP_RATIO;
  const k = w / 168;
  return `<svg x="${n(cx - 150 * k)}" y="${n(top - 14 * k)}" width="${n(300 * k)}" height="${n(300 * k)}" viewBox="-22 0 300 300" overflow="visible">${markInner}</svg>`;
}

// ---------- icons, drawn in a 24 × 24 box ----------
const PHONE = 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z';
const PIN = 'M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.6A2.6 2.6 0 1 1 12 6.4a2.6 2.6 0 0 1 0 5.2z';
// ---------- the two sides ----------
/** Stops the build if something would run past the safe line on the left or right. */
function fits(what, x0, x1) {
  if (x0 < SAFE - 0.5 || x1 > W - SAFE + 0.5) {
    throw new Error(`${what} runs outside the safe area: ${n(x0)}–${n(x1)} (safe ${SAFE}–${n(W - SAFE)})`);
  }
}

/** Front: the mark over శ్రీ MANA WASH, CAR & BIKE CARE between gold rules, and the tagline. */
function front() {
  const cx = W / 2;
  const dropH = 158;
  const capH = T.name.bottom - T.name.top;
  const tagCap = T.tagline.bottom - T.tagline.top;
  const gap1 = 40; // drop to the name
  const gap2 = 44; // name to the tagline
  // The block (drop, name, tagline) centred between the top safe line and the ribbon.
  const blockH = dropH + gap1 + capH + gap2 + tagCap;
  const dropTop = (SAFE + (H - SAFE - 24)) / 2 - blockH / 2;
  const nameY = dropTop + dropH + gap1 - T.name.top;
  const sriH = capH * 1.45;
  const sriW = T.sri.width * (sriH / (T.sri.bottom - T.sri.top));
  const gap = 26;
  const lineW = sriW + gap + T.name.width;
  const left = cx - lineW / 2;
  fits('front name', left, left + lineW);
  const [sriSvg] = sri(left, nameY + T.name.top + capH / 2 - sriH / 2, sriH);
  const tagY = nameY + T.name.bottom + gap2 - T.tagline.top;
  const half = T.tagline.width / 2;
  fits('tagline', cx - half - 66, cx + half + 66);
  const ruleY = tagY - tagCap * 0.32;
  return `
${backdrop(3)}
${mark(cx, dropTop, dropH)}
${sparkle(cx + 76, dropTop + 26, 8)}
${sriSvg}
${text('name', left + sriW + gap, nameY, C.white)}
<line x1="${n(cx - half - 66)}" y1="${n(ruleY)}" x2="${n(cx - half - 18)}" y2="${n(ruleY)}" stroke="${C.gold}" stroke-width="1.4"/>
<line x1="${n(cx + half + 18)}" y1="${n(ruleY)}" x2="${n(cx + half + 66)}" y2="${n(ruleY)}" stroke="${C.gold}" stroke-width="1.4"/>
${text('tagline', cx, tagY, C.goldLight, 'middle')}`;
}

// Colours for the two backs.
const THEMES = {
  night: { ground: () => backdrop(7), name: C.white, label: C.gold, number: C.white, tag: C.soft, address: C.pale, icon: 'url(#goldBright)', rule: C.gold, service: C.goldLight },
  pearl: { ground: pearlBackdrop, name: '#141B47', label: '#A97A30', number: '#1B2878', tag: '#7A86B8', address: '#3A4370', icon: 'url(#goldDeepV)', rule: '#C99A4E', service: '#1B2878' },
};

/**
 * Back. The mark alone on the left, a fine gold rule, then the proprietor, both numbers and the
 * address on one left edge, each contact line led by a small gold icon. Beneath it all, a fine gold
 * rule and what we do on one line. No boxes: just space.
 */
function back(theme) {
  const t = THEMES[theme];
  // The mark, centred in the left third.
  const ruleX = BLEED + 330;
  const markCx = (SAFE + ruleX) / 2 + 4;
  const dropH = 178;
  const midY = H / 2 - 36; // the mark and details sit a little high, leaving room for the services
  const left = `
${mark(markCx, midY - dropH / 2, dropH)}
<line x1="${ruleX}" y1="${midY - 150}" x2="${ruleX}" y2="${midY + 150}" stroke="${t.rule}" stroke-opacity="0.7" stroke-width="1.2"/>
${diamond(ruleX, midY, 5.5, t.rule)}`;

  // The details, as one block centred on the card's height.
  const x = ruleX + 52;
  const icon = 27; // icon box
  const tx = x + icon + 16;
  const ownerCap = T.owner.bottom - T.owner.top;
  const phoneCap = T.primary.bottom - T.primary.top;
  const lineH = 30;
  const steps = { label: 34, rule: 22, row1: 62, row2: 50, addr: 58 };
  const blockH = ownerCap + steps.label + steps.rule + steps.row1 + steps.row2 + steps.addr + lineH * (ADDRESS.length - 1) + 6;
  const ownerY = midY - blockH / 2 - T.owner.top;
  const labelY = ownerY + steps.label;
  const lineY = labelY + steps.rule;
  const row1 = lineY + steps.row1;
  const row2 = row1 + steps.row2;
  const addrY = row2 + steps.addr;
  const iconAt = (path, cy) => `<path d="${path}" transform="translate(${n(x)} ${n(cy - icon / 2)}) scale(${n(icon / 24)})" fill="${t.icon}"/>`;
  const details = `
${text('owner', x, ownerY, t.name)}
${text('ownerLabel', x, labelY, t.label)}
<line x1="${x}" y1="${lineY}" x2="${x + 96}" y2="${lineY}" stroke="${t.rule}" stroke-width="1.4"/>
${iconAt(PHONE, row1 - phoneCap / 2)}
${text('primary', tx, row1, t.number)}
${text('primaryLabel', tx + T.primary.width + 16, row1 - 1, t.tag)}
${iconAt(PHONE, row2 - phoneCap / 2)}
${text('secondary', tx, row2, t.number)}
${text('secondaryLabel', tx + T.secondary.width + 16, row2 - 1, t.tag)}
${iconAt(PIN, addrY - 7)}
${ADDRESS.map((_, i) => text(`addr${i}`, tx, addrY + i * lineH, t.address)).join('\n')}`;
  fits('proprietor', x, x + T.owner.width);
  fits('primary row', x, tx + T.primary.width + 16 + T.primaryLabel.width);
  fits('secondary row', x, tx + T.secondary.width + 16 + T.secondaryLabel.width);
  ADDRESS.forEach((_, i) => fits(`address line ${i + 1}`, tx, tx + T[`addr${i}`].width));
  if (ownerY + T.owner.top < SAFE || addrY + (ADDRESS.length - 1) * lineH > H - SAFE - 20) throw new Error('the details run past the top or bottom');

  // What we do: one centred line near the bottom, under a fine gold rule.
  const sep = 40;
  const widths = SERVICES.map((_, i) => T[`svc${i}`].width);
  const total = widths.reduce((a, b) => a + b, 0) + sep * (SERVICES.length - 1);
  const sy = H - SAFE - 30;
  let sx = W / 2 - total / 2;
  fits('services line', sx, sx + total);
  if (addrY + (ADDRESS.length - 1) * lineH > sy - 56) throw new Error('the address runs into the services line');
  let services = `<line x1="${n(W / 2 - total / 2)}" y1="${sy - 34}" x2="${n(W / 2 + total / 2)}" y2="${sy - 34}" stroke="${t.rule}" stroke-opacity="0.55" stroke-width="1"/>`;
  SERVICES.forEach((_, i) => {
    if (i > 0) services += diamond(sx - sep / 2, sy - 6, 4.5, t.rule);
    services += text(`svc${i}`, sx, sy, t.service);
    sx += widths[i] + sep;
  });

  return `
${t.ground()}
${left}
${details}
${services}`;
}

// ---------- files ----------
const SIDES = [
  { file: 'mana-visiting-card-front', label: 'Sri Mana Wash visiting card, front', body: front(), glowX: W / 2 },
  { file: 'mana-visiting-card-back', label: 'Sri Mana Wash visiting card, back', body: back('night'), glowX: W * 0.22 },
  { file: 'mana-visiting-card-back-pearl', label: 'Sri Mana Wash visiting card, back (pearl)', body: back('pearl'), glowX: W * 0.22 },
];

const MM_W = `${n(W / 10)}mm`;
const MM_H = `${n(H / 10)}mm`;
const PX = 5;
const previews = [];
for (const side of SIDES) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${MM_W}" height="${MM_H}" role="img" aria-label="${side.label}">
<title>${side.label} (91.44 × 53.34 mm, 3 mm bleed)</title>
<defs>${defs(side.glowX)}</defs>
${side.body}
</svg>
`;
  const svgPath = join(HERE, `${side.file}.svg`);
  writeFileSync(svgPath, svg);
  // Preview at 5 px per unit (whole pixels at this size), cropped to the trim.
  const scale = PX;
  const png = await sharp(Buffer.from(svg.replace(`width="${MM_W}" height="${MM_H}"`, `width="${W * scale}" height="${H * scale}"`)))
    .extract({ left: BLEED * scale, top: BLEED * scale, width: TRIM_W * scale, height: TRIM_H * scale })
    .png()
    .toBuffer();
  await sharp(png).toFile(join(HERE, `${side.file}.png`));
  previews.push(png);
  console.log('wrote', `${side.file}.svg and .png`);
  if (existsSync(CHROME)) {
    const htmlPath = join(HERE, `.${side.file}-print.html`);
    writeFileSync(
      htmlPath,
      `<!doctype html><meta charset="utf-8"><title>${side.label}</title><style>@page{size:${MM_W} ${MM_H};margin:0}html,body{margin:0;padding:0}img{display:block;width:${MM_W};height:${MM_H}}</style><img src="${pathToFileURL(svgPath).href}">`,
    );
    const out = join(HERE, `${side.file}.pdf`);
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files', `--print-to-pdf=${out}`, pathToFileURL(htmlPath).href], { stdio: 'ignore' });
    execFileSync('rm', ['-f', htmlPath]);
    console.log('wrote', `${side.file}.pdf`);
  }
}

// The front beside each back on one light sheet, for a quick look: night back on top, pearl beneath.
const pw = TRIM_W * PX;
const ph = TRIM_H * PX;
const pad = 120;
const [frontPng, nightPng, pearlPng] = previews;
await sharp({ create: { width: pw * 2 + pad * 3, height: ph * 2 + pad * 3, channels: 3, background: '#E9EBF2' } })
  .composite([
    { input: frontPng, left: pad, top: pad },
    { input: nightPng, left: pad * 2 + pw, top: pad },
    { input: frontPng, left: pad, top: pad * 2 + ph },
    { input: pearlPng, left: pad * 2 + pw, top: pad * 2 + ph },
  ])
  .png()
  .toFile(join(HERE, 'mana-visiting-card-preview.png'));
console.log('wrote mana-visiting-card-preview.png');
