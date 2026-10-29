import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import qrcode from 'qrcode-generator';
import ReactNativeBlobUtil from 'react-native-blob-util';
import Share from 'react-native-share';
import { BRAND_MARK, BRAND_SRI } from '@mana/ui';
import type { Lane } from '../components/board/lanes';
import { CUSTOMER_APP_LINK } from '../config/app';
import { formatRupees } from './format';
import { bytesToBase64 } from './shareReportPdf';
import { visitChargeLine, type LaneMenu, type MenuItem, type MenuVehicleType } from './branchMenu';
import { RUPEE_GLYPH, type DoorstepVisitRules } from '@mana/domain';

/**
 * The branch menu as a printable A4 PDF, on the logo's night indigo: stars, a faint mark behind
 * the page, the glass mark with శ్రీ in sandalwood gold over MANA WASH, then the menu. For one
 * vehicle it's a list with one price a line; for all vehicles, a table per kind of vehicle with a
 * column for each size. Plans sit first, in a gold-framed card. It ends with a card that sends
 * customers to the app for their model's exact price (link and QR code). Every mark, the QR code
 * and the ₹ sign are drawn as shapes, so it prints the same anywhere with no fonts.
 */

export interface MenuPdfInput {
  lane: Lane;
  menu: LaneMenu;
  branch: { name: string; code?: string | null; city?: string | null };
  /** "Maruti Suzuki Swift · Hatchback", or null for every vehicle. */
  vehicleLabel: string | null;
  /** One vehicle type picked: the list layout with its price. */
  vehicleTypeId: string | null;
  visit: DoorstepVisitRules | null;
}

const W = 595.28;
const H = 841.89;
const M = 42;
const CONTENT_W = W - M * 2;
const FOOTER_H = 44;

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
// The app icon's night tile, top to bottom.
const NIGHT = ['#1B2878', '#0C1442', '#060A22'] as const;
const GOLD = hex('#E8BF78');
const GOLD_LIGHT = hex('#F8E2B0');
const LAVENDER = hex('#B9C6FF');
const MIST = hex('#8F9CD6');
const WHITE = rgb(1, 1, 1);
const GLASS = hex('#4458CC');
const GLASS_DEEP = hex('#0A1034');

const LANE_TITLE: Record<Lane, string> = { hub: 'Hub menu', community: 'Community menu', doorstep: 'Doorstep menu' };
const LANE_LINE: Record<Lane, string> = {
  hub: 'At our wash hub',
  community: 'Wash days at your community',
  doorstep: 'At your doorstep',
};

const RUPEE = RUPEE_GLYPH;

const PDF_REPLACEMENTS: Record<string, string> = {
  '→': '->',
  '—': '-',
  '–': '-',
  '…': '...',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '·': '·',
};

/** Only what the standard PDF fonts can draw. */
function pdfSafe(value: string): string {
  let out = '';
  for (const ch of value) {
    const mapped = PDF_REPLACEMENTS[ch];
    if (mapped !== undefined) out += mapped;
    else if (ch.charCodeAt(0) <= 0xff) out += ch;
  }
  return out;
}

/** "1,259" for 125900 paise: the number part of a price. */
function amount(paise: number): string {
  return formatRupees(paise).replace(/[^\d.,]/g, '');
}

/** A small seeded random, so the stars sit in the same places on every copy. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function lerp(a: string, b: string, t: number): RGB {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => (((ca >> shift) & 255) * (1 - t) + ((cb >> shift) & 255) * t) / 255;
  return rgb(ch(16), ch(8), ch(0));
}

function roundedRect(w: number, h: number, r: number): string {
  return `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`;
}

export async function buildMenuPdf(input: MenuPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Sri Mana Wash ${input.branch.name} - ${LANE_TITLE[input.lane]}`);
  doc.setAuthor('Sri Mana Wash');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  // ── Drawing helpers ─────────────────────────────────────────────────────────
  const text = (
    value: string,
    x: number,
    at: number,
    o: { size?: number; font?: PDFFont; color?: RGB; align?: 'left' | 'right' | 'center'; maxWidth?: number; opacity?: number } = {},
  ) => {
    const font = o.font ?? regular;
    const size = o.size ?? 10;
    let s = pdfSafe(value);
    if (o.maxWidth && font.widthOfTextAtSize(s, size) > o.maxWidth) {
      while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > o.maxWidth) s = s.slice(0, -1);
      s = `${s.trimEnd()}...`;
    }
    const w = font.widthOfTextAtSize(s, size);
    const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    page.drawText(s, { x: left, y: at, size, font, color: o.color ?? WHITE, opacity: o.opacity });
    return w;
  };

  /** Letters drawn one by one with extra space between them (headings, MANA WASH). */
  const spaced = (value: string, cx: number, at: number, size: number, font: PDFFont, color: RGB, gap: number) => {
    const s = pdfSafe(value);
    const widths = [...s].map((ch) => font.widthOfTextAtSize(ch, size));
    const total = widths.reduce((a, b) => a + b, 0) + gap * (s.length - 1);
    let x = cx - total / 2;
    [...s].forEach((ch, i) => {
      page.drawText(ch, { x, y: at, size, font, color });
      x += widths[i]! + gap;
    });
    return total;
  };

  /** Text wrapped to a width; returns the lines drawn. */
  const wrap = (value: string, width: number, size: number, font: PDFFont): string[] => {
    const words = pdfSafe(value).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  /** A price with a drawn ₹: right edge at `right`, baseline at `at`. Returns its width. */
  const price = (paise: number, right: number, at: number, size: number, isBold = true, color: RGB = WHITE) => {
    const glyph = isBold ? RUPEE.bold : RUPEE.reg;
    const font = isBold ? bold : regular;
    const num = amount(paise);
    const k = size / 100;
    const gw = glyph.w * k;
    const nw = font.widthOfTextAtSize(num, size);
    const total = gw + size * 0.08 + nw;
    const left = right - total;
    page.drawSvgPath(glyph.d, { x: left, y: at, scale: k, color });
    page.drawText(num, { x: left + gw + size * 0.08, y: at, size, font, color });
    return total;
  };

  const mark = (cx: number, top: number, size: number, opacity = 1) => {
    const k = size / 256;
    const x = cx - size / 2;
    if (opacity === 1) page.drawSvgPath(BRAND_MARK.drop, { x, y: top - 6 * k, scale: k, color: GLASS_DEEP });
    page.drawSvgPath(BRAND_MARK.drop, { x, y: top, scale: k, color: opacity === 1 ? GLASS : WHITE, opacity });
    if (opacity === 1) {
      // A soft gloss on the glass, upper left.
      page.drawEllipse({ x: x + 100 * k, y: top - 118 * k, xScale: 20 * k, yScale: 30 * k, color: WHITE, opacity: 0.14 });
    }
    page.drawSvgPath(BRAND_MARK.arms, { x, y: top, scale: k, color: WHITE, opacity: opacity === 1 ? 1 : opacity * 1.4 });
    page.drawSvgPath(BRAND_MARK.centre, { x, y: top, scale: k, color: WHITE, opacity: opacity === 1 ? 1 : opacity * 1.8 });
  };

  const sri = (cx: number, top: number, height: number) => {
    const [minX, minY, vw, vh] = BRAND_SRI.viewBox.split(' ').map(Number) as [number, number, number, number];
    const k = height / vh;
    // A path's y runs down from the origin, so its top (minY) lands at `top` when the origin is minY above it.
    page.drawSvgPath(BRAND_SRI.d, { x: cx - (vw * k) / 2 - minX * k, y: top + minY * k, scale: k, color: GOLD });
  };

  /** A gold hairline with a small diamond in the middle. */
  const ornament = (cx: number, at: number, half: number) => {
    page.drawLine({ start: { x: cx - half, y: at }, end: { x: cx - 8, y: at }, thickness: 0.6, color: GOLD, opacity: 0.7 });
    page.drawLine({ start: { x: cx + 8, y: at }, end: { x: cx + half, y: at }, thickness: 0.6, color: GOLD, opacity: 0.7 });
    page.drawSvgPath('M0 -4L4 0L0 4L-4 0Z', { x: cx, y: at, color: GOLD });
  };

  const panel = (x: number, top: number, w: number, h: number, opacity = 0.06) => {
    page.drawSvgPath(roundedRect(w, h, 12), { x, y: top, color: WHITE, opacity });
  };

  // ── Pages ───────────────────────────────────────────────────────────────────
  const background = () => {
    const bands = 140;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const color = t < 0.5 ? lerp(NIGHT[0], NIGHT[1], t / 0.5) : lerp(NIGHT[1], NIGHT[2], (t - 0.5) / 0.5);
      page.drawRectangle({ x: 0, y: H - ((i + 1) * H) / bands - 0.5, width: W, height: H / bands + 1, color });
    }
    // A soft light from the top, like the app's splash: rings that fade out, so it has no edge.
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      page.drawEllipse({ x: W / 2, y: H + 40, xScale: W * (0.2 + 0.55 * t), yScale: 90 + 230 * t, color: hex('#5468D4'), opacity: 0.025 });
    }
    const rand = seeded(pages.length * 97 + 11);
    for (let i = 0; i < 70; i++) {
      page.drawCircle({ x: rand() * W, y: rand() * H, size: 0.3 + rand() * 1.1, color: WHITE, opacity: 0.18 + rand() * 0.45 });
    }
    // The mark, large and faint, behind the lower right of the page.
    mark(W - 70, 300, 380, 0.035);
    // A hairline frame inset from the edge.
    page.drawSvgPath(roundedRect(W - 28, H - 28, 18), { x: 14, y: H - 14, borderColor: GOLD, borderWidth: 0.5, borderOpacity: 0.35 });
  };

  const newPage = (first: boolean) => {
    page = doc.addPage([W, H]);
    pages.push(page);
    background();
    if (first) return;
    // Later pages: a slim header.
    mark(M + 14, H - 34, 28);
    text('SRI MANA WASH', M + 36, H - 50, { size: 9, font: bold, color: WHITE });
    text(`${LANE_TITLE[input.lane]}${input.vehicleLabel ? ` · ${input.vehicleLabel}` : ''}`, W - M, H - 50, {
      size: 9,
      color: LAVENDER,
      align: 'right',
      maxWidth: CONTENT_W - 140,
    });
    page.drawLine({ start: { x: M, y: H - 62 }, end: { x: W - M, y: H - 62 }, thickness: 0.5, color: GOLD, opacity: 0.4 });
    y = H - 84;
  };

  const ensure = (h: number) => {
    if (y - h < FOOTER_H + 16) newPage(false);
  };

  // ── Cover header ────────────────────────────────────────────────────────────
  newPage(true);
  const cx = W / 2;
  mark(cx, H - 46, 78);
  sri(cx, H - 136, 30);
  spaced('MANA WASH', cx, H - 196, 24, bold, WHITE, 7);
  text('Your car, our care.', cx, H - 217, { size: 13, font: italic, color: GOLD_LIGHT, align: 'center' });
  ornament(cx, H - 232, 92);
  const where = [input.branch.name, input.branch.city && input.branch.city !== input.branch.name ? input.branch.city : null, input.branch.code]
    .filter(Boolean)
    .join('  ·  ')
    .toUpperCase();
  spaced(where, cx, H - 252, 8.5, bold, LAVENDER, 1.6);
  text(LANE_TITLE[input.lane], cx, H - 294, { size: 30, font: italic, color: GOLD_LIGHT, align: 'center' });
  text(input.vehicleLabel ? `For your ${input.vehicleLabel}` : `${LANE_LINE[input.lane]} · every vehicle we wash`, cx, H - 314, {
    size: 10.5,
    color: LAVENDER,
    align: 'center',
    maxWidth: CONTENT_W,
  });
  y = H - 342;

  if (input.lane === 'doorstep' && input.visit) {
    const line = `Plus one visit charge per visit: ${visitChargeLine(input.visit, (p) => `Rs ${amount(p)}`)}. Two cars at one home share it.`;
    const lines = wrap(line, CONTENT_W - 36, 9, regular);
    const h = 18 + lines.length * 12;
    panel(M, y, CONTENT_W, h, 0.07);
    page.drawSvgPath(roundedRect(CONTENT_W, h, 12), { x: M, y, borderColor: GOLD, borderWidth: 0.6, borderOpacity: 0.5 });
    lines.forEach((l, i) => text(l, M + 18, y - 15 - i * 12, { size: 9, color: GOLD_LIGHT }));
    y -= h + 18;
  }

  const sub = (item: MenuItem) =>
    [
      item.includedNames.length ? `Includes ${item.includedNames.join(', ')}` : item.service.description,
      item.service.durationMin ? `${item.service.durationMin} min` : null,
    ]
      .filter(Boolean)
      .join('  ·  ');

  // spaced() centres its text; a left-aligned version for headings.
  const spacedLeft = (value: string, x: number, at: number, size: number, font: PDFFont, color: RGB, gap: number) => {
    let left = x;
    for (const ch of pdfSafe(value)) {
      page.drawText(ch, { x: left, y: at, size, font, color });
      left += font.widthOfTextAtSize(ch, size) + gap;
    }
  };
  const heading = (title: string, count: number) => {
    ensure(64);
    y -= 4;
    page.drawSvgPath('M0 -3.5L3.5 0L0 3.5L-3.5 0Z', { x: M + 3.5, y: y + 3.5, color: GOLD });
    spacedLeft(title.toUpperCase(), M + 13, y, 9.5, bold, GOLD, 2.2);
    const noun = title === 'Plans' ? 'plan' : 'service';
    text(`${count} ${noun}${count === 1 ? '' : 's'}`, W - M, y, { size: 7.5, color: MIST, align: 'right' });
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: GOLD, opacity: 0.35 });
    y -= 18;
  };

  if (input.menu.sections.length === 0) {
    text('Nothing on this menu yet.', cx, y - 20, { size: 12, color: LAVENDER, align: 'center' });
  } else if (input.vehicleTypeId) {
    // ── One vehicle: a list, one price a line ─────────────────────────────────
    const typeId = input.vehicleTypeId;
    for (const section of input.menu.sections) {
      heading(section.group, section.items.length);
      const rows = section.items
        .filter((item) => item.prices.has(typeId))
        .map((item) => ({ item, subLines: sub(item) ? wrap(sub(item), CONTENT_W - 168, 8.5, regular).slice(0, 2) : [] }));
      const rowH = (r: (typeof rows)[number]) => 18 + r.subLines.length * 11 + 10;
      // Plans get a gold-framed card of their own (when the whole card fits on this page).
      const boxed = section.group === 'Plans' && rows.reduce((t, r) => t + rowH(r), 0) + 20 < y - FOOTER_H - 16;
      const L = boxed ? M + 16 : M;
      const R = boxed ? W - M - 16 : W - M;
      if (boxed) {
        const total = rows.reduce((t, r) => t + rowH(r), 0) + 14;
        panel(M, y + 16, CONTENT_W, total, 0.06);
        page.drawSvgPath(roundedRect(CONTENT_W, total, 12), { x: M, y: y + 16, borderColor: GOLD, borderWidth: 0.7, borderOpacity: 0.55 });
        y -= 4;
      }
      for (const { item, subLines } of rows) {
        const p = item.prices.get(typeId)!;
        const h = 18 + subLines.length * 11 + 10;
        ensure(h);
        const nameW = text(item.service.name, L, y, { size: 12.5, font: bold, maxWidth: R - L - 150 });
        if (item.service.popular) {
          const bx = L + nameW + 8;
          page.drawSvgPath(roundedRect(58, 13, 6.5), { x: bx, y: y + 10, color: GOLD });
          text('POPULAR', bx + 29, y + 0.5, { size: 6.5, font: bold, color: hex('#3A2A0C'), align: 'center' });
        }
        const pw = price(p, R, y - 1, 14);
        // Dotted leader from the name to the price.
        const from = L + nameW + (item.service.popular ? 74 : 10);
        const to = R - pw - 10;
        for (let x = from; x < to; x += 5) page.drawCircle({ x, y: y + 2, size: 0.55, color: MIST, opacity: 0.6 });
        subLines.forEach((l, i) => text(l, L, y - 14 - i * 11, { size: 8.5, color: LAVENDER }));
        const saved = item.saving?.get(typeId);
        if (saved) {
          const sw = price(saved, R, y - 15, 8.5, true, GOLD);
          text('Save', R - sw - 4, y - 15, { size: 8.5, font: bold, color: GOLD, align: 'right' });
        }
        y -= h;
      }
      y -= boxed ? 16 : 6;
    }
  } else {
    // ── Every vehicle: a table per kind (cars, bikes), a column per type ─────
    const byCategory = new Map<string, MenuVehicleType[]>();
    for (const vt of input.menu.vehicleTypes) byCategory.set(vt.category, [...(byCategory.get(vt.category) ?? []), vt]);
    const nameCol = 188;
    const maxCols = 5;
    for (const [category, types] of byCategory) {
      for (let start = 0; start < types.length; start += maxCols) {
        const cols = types.slice(start, start + maxCols);
        const ids = cols.map((c) => c.id);
        const colW = (CONTENT_W - nameCol) / cols.length;
        const sections = input.menu.sections
          .map((s) => ({ ...s, items: s.items.filter((i) => ids.some((id) => i.prices.has(id))) }))
          .filter((s) => s.items.length);
        if (!sections.length) continue;
        const title = `${category === 'bike' ? 'Two-wheelers' : 'Cars'}${types.length > maxCols ? ` (${start + 1}-${start + cols.length} of ${types.length} sizes)` : ''}`;
        const colHeader = () => {
          ensure(70);
          text(title, M, y, { size: 15, font: italic, color: GOLD_LIGHT });
          y -= 12;
          panel(M, y, CONTENT_W, 26, 0.09);
          cols.forEach((c, i) => {
            const right = M + nameCol + colW * (i + 1) - 10;
            const lines = wrap(c.name, colW - 12, 8, bold).slice(0, 2);
            lines.forEach((l, j) => text(l, right, y - (lines.length === 1 ? 16 : 11 + j * 9), { size: 8, font: bold, color: LAVENDER, align: 'right' }));
          });
          text('SERVICE', M + 12, y - 16, { size: 7.5, font: bold, color: MIST });
          y -= 38;
        };
        colHeader();
        for (const section of sections) {
          if (y - 60 < FOOTER_H + 16) {
            newPage(false);
            colHeader();
          }
          spacedLeft(section.group.toUpperCase(), M + 12, y, 8.5, bold, GOLD, 1.8);
          y -= 14;
          section.items.forEach((item, idx) => {
            const subLines = sub(item) ? wrap(sub(item), nameCol - 24, 7.5, regular).slice(0, 2) : [];
            // A plan shows what it saves under each price, so the row needs room for that line.
            const saves = item.saving && cols.some((c) => item.saving!.get(c.id));
            const h = Math.max(20 + subLines.length * 9, saves ? 32 : 0);
            if (y - h < FOOTER_H + 16) {
              newPage(false);
              colHeader();
            }
            if (idx % 2 === 0) panel(M, y + 12, CONTENT_W, h, 0.035);
            const popular = Boolean(item.service.popular);
            const nameW = text(item.service.name, M + 12, y - 2, { size: 10, font: bold, maxWidth: nameCol - 20 - (popular ? 50 : 0) });
            if (popular) {
              // The same gold tag as the one-vehicle list, right after the name.
              const bx = M + 12 + nameW + 6;
              page.drawSvgPath(roundedRect(44, 11, 5.5), { x: bx, y: y + 7.5, color: GOLD });
              text('POPULAR', bx + 22, y - 0.6, { size: 5.8, font: bold, color: hex('#3A2A0C'), align: 'center' });
            }
            subLines.forEach((l, i) => text(l, M + 12, y - 13 - i * 9, { size: 7.5, color: LAVENDER }));
            cols.forEach((c, i) => {
              const right = M + nameCol + colW * (i + 1) - 10;
              const p = item.prices.get(c.id);
              if (p == null) text('-', right, y - 2, { size: 10, color: MIST, align: 'right' });
              else price(p, right, y - 2, 10.5);
              const saved = item.saving?.get(c.id);
              if (p != null && saved) {
                const sw = price(saved, right, y - 14, 7, true, GOLD);
                text('Save', right - sw - 2.5, y - 14, { size: 7, font: bold, color: GOLD, align: 'right' });
              }
            });
            y -= h;
          });
          y -= 8;
        }
        y -= 14;
      }
    }
    // A short key under the tables.
    ensure(24);
    text('- = not offered for that size', M, y, {
      size: 7.5,
      color: MIST,
    });
    y -= 18;
  }

  // ── The exact price for your model: the app, its link and a QR code ─────────
  /** The QR code on a white tile, with the mark in its centre (high error correction keeps it readable). */
  const qrTile = (tx: number, ty: number, tile: number) => {
    const qr = qrcode(0, 'H');
    qr.addData(CUSTOMER_APP_LINK);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = tile * 0.07;
    page.drawSvgPath(roundedRect(tile, tile, tile * 0.09), { x: tx, y: ty, color: WHITE });
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
    page.drawSvgPath(d, { x: tx + quiet, y: ty - quiet, scale: (tile - quiet * 2) / n, color: hex('#0C1442') });
    const hole = tile * 0.24;
    page.drawSvgPath(roundedRect(hole, hole, hole * 0.2), { x: tx + (tile - hole) / 2, y: ty - (tile - hole) / 2, color: WHITE });
    mark(tx + tile / 2, ty - (tile - hole) / 2 - hole * 0.04, hole * 0.9);
  };
  const link = CUSTOMER_APP_LINK.replace(/^https?:\/\//, '');
  const pitch =
    'Open the Sri Mana Wash app, pick your company and model, and see your price at our hub, your community or your doorstep. Book in a tap.';
  const cardH = 150;
  if (y - cardH - 10 >= FOOTER_H + 16) {
    // Room on this page: a card along the bottom, just above the footer.
    const top = FOOTER_H + 16 + cardH;
    panel(M, top, CONTENT_W, cardH, 0.07);
    page.drawSvgPath(roundedRect(CONTENT_W, cardH, 14), { x: M, y: top, borderColor: GOLD, borderWidth: 0.8, borderOpacity: 0.6 });
    const tile = 118;
    const tx = W - M - 16 - tile;
    qrTile(tx, top - (cardH - tile) / 2, tile);
    const lx = M + 20;
    const lw = tx - lx - 18;
    text('YOUR EXACT PRICE', lx, top - 26, { size: 8, font: bold, color: GOLD });
    text('Get the exact price for your model', lx, top - 46, { size: 15, font: bold, color: WHITE, maxWidth: lw });
    wrap(pitch, lw, 9, regular)
      .slice(0, 3)
      .forEach((l, i) => text(l, lx, top - 66 - i * 12, { size: 9, color: LAVENDER }));
    const linkW = text(link, lx, top - cardH + 34, { size: 11, font: bold, color: GOLD_LIGHT });
    page.drawLine({ start: { x: lx, y: top - cardH + 31 }, end: { x: lx + linkW, y: top - cardH + 31 }, thickness: 0.6, color: GOLD_LIGHT, opacity: 0.7 });
    text('Or scan the code with your phone camera', lx, top - cardH + 18, { size: 8, font: italic, color: MIST });
  } else {
    // No room: a back cover of its own, like a poster.
    newPage(true);
    mark(cx, H - 120, 64);
    sri(cx, H - 196, 24);
    spaced('MANA WASH', cx, H - 246, 20, bold, WHITE, 6);
    text('Your car, our care.', cx, H - 266, { size: 12, font: italic, color: GOLD_LIGHT, align: 'center' });
    ornament(cx, H - 282, 80);
    text('Your exact price, in a tap', cx, H - 330, { size: 26, font: italic, color: GOLD_LIGHT, align: 'center' });
    wrap(pitch, 360, 10.5, regular).forEach((l, i) => text(l, cx, H - 356 - i * 15, { size: 10.5, color: LAVENDER, align: 'center' }));
    const tile = 200;
    const tTop = H - 420;
    // A soft gold halo behind the code.
    page.drawSvgPath(roundedRect(tile + 28, tile + 28, 24), { x: cx - tile / 2 - 14, y: tTop + 14, color: GOLD, opacity: 0.12 });
    page.drawSvgPath(roundedRect(tile + 28, tile + 28, 24), { x: cx - tile / 2 - 14, y: tTop + 14, borderColor: GOLD, borderWidth: 0.8, borderOpacity: 0.6 });
    qrTile(cx - tile / 2, tTop, tile);
    const linkY = tTop - tile - 46;
    const linkW = text(link, cx, linkY, { size: 15, font: bold, color: GOLD_LIGHT, align: 'center' });
    page.drawLine({ start: { x: cx - linkW / 2, y: linkY - 4 }, end: { x: cx + linkW / 2, y: linkY - 4 }, thickness: 0.7, color: GOLD_LIGHT, opacity: 0.7 });
    text('Scan with your phone camera, or open the link', cx, linkY - 22, { size: 9, font: italic, color: MIST, align: 'center' });
  }

  // ── Footers, now the page count is known ───────────────────────────────────
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  pages.forEach((p, i) => {
    page = p;
    page.drawLine({ start: { x: M, y: FOOTER_H }, end: { x: W - M, y: FOOTER_H }, thickness: 0.5, color: GOLD, opacity: 0.35 });
    text(`Sri Mana Wash · ${input.branch.name} · Prices in Indian rupees, as of ${today}`, M, FOOTER_H - 16, {
      size: 7.5,
      color: MIST,
      maxWidth: CONTENT_W - 60,
    });
    text(`${i + 1} / ${pages.length}`, W - M, FOOTER_H - 16, { size: 7.5, font: bold, color: LAVENDER, align: 'right' });
  });

  return doc.save();
}

function menuFilename(input: MenuPdfInput): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const parts = ['Sri-Mana-Wash', slug(input.branch.name), slug(LANE_TITLE[input.lane]), input.vehicleLabel ? slug(input.vehicleLabel) : null];
  return `${parts.filter(Boolean).join('-')}.pdf`;
}

/** Build the menu PDF, save it on the phone and open the share sheet (WhatsApp, print, save…). */
export async function shareMenuPdf(input: MenuPdfInput): Promise<void> {
  const bytes = await buildMenuPdf(input);
  const filename = menuFilename(input);
  const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${filename}`;
  await ReactNativeBlobUtil.fs.writeFile(path, bytesToBase64(bytes), 'base64');
  await Share.open({
    url: `file://${path}`,
    type: 'application/pdf',
    filename,
    title: `${LANE_TITLE[input.lane]} · Sri Mana Wash ${input.branch.name}`,
    failOnCancel: false,
  });
}
