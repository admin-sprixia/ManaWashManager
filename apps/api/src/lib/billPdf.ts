import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { BRAND_MARK, BRAND_MARK_BOX, BRAND_SRI, RUPEE_GLYPH } from '@mana/domain';

/**
 * A wash's bill as an A4 PDF, sent on WhatsApp when it's paid and opened from the app: the logo
 * on the brand's night indigo, the bill's number and date, who and which vehicle, every service
 * with its price, any discount, the total with a PAID stamp, and the before and after photos the
 * team took. Print-friendly white page; the logo, శ్రీ and ₹ are drawn as shapes, so it needs no
 * fonts beyond the standard PDF ones.
 */

export interface BillPhoto {
  bytes: Uint8Array;
  contentType: string;
}

export interface BillInput {
  businessName: string;
  branch: { name: string; code: string; city: string | null; address: string | null; phone: string | null; hours: string | null };
  number: string;
  /** When it was paid. */
  at: Date;
  paymentMethod: string | null;
  customer: { name: string | null; phone: string };
  vehicle: { label: string; registration: string | null };
  lines: { name: string; quantity: number; unitPrice: number; amount: number; note?: string | null }[];
  /** Paise. */
  subtotal: number;
  discount: number;
  discountReason: string | null;
  total: number;
  photos: { before: BillPhoto[]; after: BillPhoto[] };
  reviewUrl: string | null;
}

const W = 595.28;
const H = 841.89;
const M = 40;

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const NIGHT = hex('#0E1650');
const NIGHT_DEEP = hex('#060A22');
const INDIGO = hex('#1B2878');
const GOLD = hex('#E8BF78');
const GOLD_LIGHT = hex('#F8E2B0');
const MIST = hex('#C4CCF0');
const INK = hex('#0F1743');
const SLATE = hex('#4A5280');
const SLATE_LIGHT = hex('#8791B5');
const LINE = hex('#E2E7FB');
const PALE = hex('#F4F6FF');
const TEAL = hex('#0E9F8E');
const WHITE = rgb(1, 1, 1);

const REPLACE: Record<string, string> = { '→': '->', '—': '-', '–': '-', '…': '...', '‘': "'", '’': "'", '“': '"', '”': '"', '×': 'x', '₹': 'Rs ' };
/** Only what the standard PDF fonts can draw (Telugu or emoji are dropped). */
function safe(value: string): string {
  let out = '';
  for (const ch of value) {
    const mapped = REPLACE[ch];
    if (mapped !== undefined) out += mapped;
    else if (ch.charCodeAt(0) <= 0xff) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

const PAYMENT: Record<string, string> = { cash: 'Cash', upi: 'UPI', other: 'Card / other' };

/** "28 Oct 2026, 6:30 pm" in India time. */
function indiaTime(at: Date): string {
  const d = new Date(at.getTime() + (5 * 60 + 30) * 60_000);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const h = d.getUTCHours();
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}, ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

const amountText = (paise: number) => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export async function buildBillPdf(input: BillInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.businessName} bill ${input.number}`);
  doc.setAuthor(input.businessName);
  doc.setCreator(input.businessName);
  const page = doc.addPage([W, H]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);

  /** Text with its top-left corner at (x, top). */
  const text = (s: string, x: number, top: number, size: number, font: PDFFont, color: RGB, opts: { align?: 'left' | 'right' | 'center'; spacing?: number } = {}) => {
    const value = safe(s);
    const spacing = opts.spacing ?? 0;
    const width = font.widthOfTextAtSize(value, size) + spacing * Math.max(0, value.length - 1);
    const left = opts.align === 'right' ? x - width : opts.align === 'center' ? x - width / 2 : x;
    if (!spacing) {
      page.drawText(value, { x: left, y: H - top - size * 0.8, size, font, color });
    } else {
      let cx = left;
      for (const ch of value) {
        page.drawText(ch, { x: cx, y: H - top - size * 0.8, size, font, color });
        cx += font.widthOfTextAtSize(ch, size) + spacing;
      }
    }
    return width;
  };
  /** A price with a drawn ₹ starting at `left`; returns its width. */
  const priceAt = (paise: number, left: number, top: number, size: number, font: PDFFont, color: RGB) => {
    const glyph = font === bold ? RUPEE_GLYPH.bold : RUPEE_GLYPH.reg;
    const scale = (size * 0.72) / 70;
    page.drawSvgPath(glyph.d, { x: left, y: H - top - size * 0.8, scale, color });
    const gw = glyph.w * scale + size * 0.12;
    const digits = amountText(paise);
    page.drawText(digits, { x: left + gw, y: H - top - size * 0.8, size, font, color });
    return gw + font.widthOfTextAtSize(digits, size);
  };
  /** A price with a drawn ₹, right edge at `right`. */
  const price = (paise: number, right: number, top: number, size: number, font: PDFFont, color: RGB) => {
    const digits = amountText(paise);
    const w = font.widthOfTextAtSize(digits, size);
    page.drawText(digits, { x: right - w, y: H - top - size * 0.8, size, font, color });
    const glyph = font === bold ? RUPEE_GLYPH.bold : RUPEE_GLYPH.reg;
    const scale = (size * 0.72) / 70;
    const gx = right - w - glyph.w * scale - size * 0.12;
    page.drawSvgPath(glyph.d, { x: gx, y: H - top - size * 0.8, scale, color });
    return w + glyph.w * scale + size * 0.12;
  };

  // ─── Header band ─────────────────────────────────────────────────────────────
  const bandH = 128;
  page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: NIGHT });
  page.drawRectangle({ x: 0, y: H - bandH, width: W, height: 6, color: NIGHT_DEEP });
  page.drawRectangle({ x: 0, y: H - bandH - 2, width: W, height: 2, color: GOLD });
  // The mark: drop, arms, centre (as on the app icon, white and gold).
  const markSize = 64;
  const ms = markSize / BRAND_MARK_BOX;
  const markTop = 30;
  page.drawSvgPath(BRAND_MARK.drop, { x: M, y: H - markTop, scale: ms, color: hex('#4458CC') });
  page.drawSvgPath(BRAND_MARK.arms, { x: M, y: H - markTop, scale: ms, color: WHITE, opacity: 0.92 });
  page.drawSvgPath(BRAND_MARK.centre, { x: M, y: H - markTop, scale: ms, color: hex('#E0303A') });
  // శ్రీ in gold, then MANA WASH.
  const [vx, vy, vw, vh] = BRAND_SRI.viewBox.split(' ').map(Number) as [number, number, number, number];
  const sriH = 34;
  const ss = sriH / vh;
  const nameLeft = M + markSize + 10;
  // A path point (px, py) lands at (x + px·s, y − py·s): put the glyph's ink box top-left at (nameLeft, 26).
  const sriTop = 26;
  page.drawSvgPath(BRAND_SRI.d, { x: nameLeft - vx * ss, y: H - sriTop + vy * ss, scale: ss, color: GOLD_LIGHT });
  text('MANA WASH', nameLeft + vw * ss + 8, 34, 25, serif, WHITE, { spacing: 2.4 });
  text(`CAR & BIKE WASH${input.branch.city ? ` · ${input.branch.city.toUpperCase()}` : ''}`, nameLeft + 2, 78, 8.5, bold, MIST, { spacing: 1.6 });
  // Bill title and number on the right.
  text('BILL', W - M, 30, 26, serif, GOLD_LIGHT, { align: 'right', spacing: 3 });
  text(`No. ${input.number}`, W - M, 64, 9.5, bold, WHITE, { align: 'right' });
  text(indiaTime(input.at), W - M, 80, 9, regular, MIST, { align: 'right' });

  // ─── Who, what, where ────────────────────────────────────────────────────────
  let top = bandH + 26;
  const col = (label: string, lines: string[], x: number) => {
    text(label.toUpperCase(), x, top, 7.5, bold, SLATE_LIGHT, { spacing: 1.2 });
    lines.forEach((l, i) => text(l, x, top + 13 + i * 14, i === 0 ? 11 : 9.5, i === 0 ? bold : regular, i === 0 ? INK : SLATE));
  };
  const customerName = safe(input.customer.name ?? '') || 'Customer';
  const phone = input.customer.phone.replace(/^(\d{5})(\d{5})$/, '$1 $2');
  col('Billed to', [customerName, `+91 ${phone}`], M);
  col('Vehicle', [input.vehicle.label, ...(input.vehicle.registration ? [input.vehicle.registration] : [])], M + 185);
  col('Paid', [PAYMENT[input.paymentMethod ?? ''] ?? 'Paid', indiaTime(input.at)], M + 370);
  top += 62;

  // ─── Items ──────────────────────────────────────────────────────────────────
  const tableW = W - M * 2;
  const qtyX = M + tableW * 0.62;
  const rateR = M + tableW * 0.8;
  const amtR = W - M;
  page.drawRectangle({ x: M, y: H - top - 24, width: tableW, height: 24, color: PALE });
  text('SERVICE', M + 12, top + 8, 8, bold, SLATE, { spacing: 1 });
  text('QTY', qtyX, top + 8, 8, bold, SLATE, { align: 'center', spacing: 1 });
  text('RATE', rateR, top + 8, 8, bold, SLATE, { align: 'right', spacing: 1 });
  text('AMOUNT', amtR - 12, top + 8, 8, bold, SLATE, { align: 'right', spacing: 1 });
  top += 24;
  for (const line of input.lines) {
    const rowH = line.note ? 34 : 26;
    text(line.name, M + 12, top + 8, 10.5, regular, INK);
    if (line.note) text(line.note, M + 12, top + 22, 8, regular, TEAL);
    text(String(line.quantity), qtyX, top + 8, 10.5, regular, INK, { align: 'center' });
    price(line.unitPrice, rateR, top + 8, 10.5, regular, SLATE);
    price(line.amount, amtR - 12, top + 8, 10.5, regular, INK);
    top += rowH;
    page.drawLine({ start: { x: M, y: H - top }, end: { x: W - M, y: H - top }, thickness: 0.6, color: LINE });
  }

  // ─── Totals and the PAID stamp ───────────────────────────────────────────────
  top += 10;
  const labelR = M + tableW * 0.8;
  const totalRow = (label: string, paise: number, opts: { strong?: boolean; minus?: boolean; note?: string | null } = {}) => {
    text(label, labelR, top, opts.strong ? 11 : 9.5, opts.strong ? bold : regular, opts.strong ? INK : SLATE, { align: 'right' });
    const w = price(paise, amtR - 12, top, opts.strong ? 13 : 9.5, opts.strong ? bold : regular, opts.strong ? INK : SLATE);
    if (opts.minus) text('-', amtR - 12 - w - 4, top, 9.5, regular, SLATE, { align: 'right' });
    top += opts.strong ? 22 : 16;
    if (opts.note) {
      text(opts.note, labelR, top - 4, 7.5, regular, SLATE_LIGHT, { align: 'right' });
      top += 8;
    }
  };
  const totalsTop = top;
  if (input.discount > 0) {
    totalRow('Subtotal', input.subtotal);
    totalRow('Discount', input.discount, { minus: true, note: input.discountReason ? safe(input.discountReason).slice(0, 70) : null });
  }
  page.drawRectangle({ x: labelR - 120, y: H - top - 30, width: W - M - (labelR - 120), height: 30, color: PALE });
  top += 8;
  totalRow('Total paid', input.total, { strong: true });
  // A rounded PAID stamp on the left, beside the totals.
  const stampTop = totalsTop + 2;
  page.drawRectangle({ x: M, y: H - stampTop - 34, width: 92, height: 34, borderColor: TEAL, borderWidth: 2, color: WHITE, opacity: 1 });
  text('PAID', M + 46, stampTop + 9, 17, bold, TEAL, { align: 'center', spacing: 3 });
  if (input.discount > 0) {
    const saved = text('You saved ', M + 104, stampTop + 12, 9.5, bold, TEAL);
    priceAt(input.discount, M + 104 + saved + 2, stampTop + 12, 9.5, bold, TEAL);
  }
  top = Math.max(top, stampTop + 44) + 16;

  // ─── Before & after ───────────────────────────────────────────────────────────
  const before = await embedAll(doc, input.photos.before.slice(0, 2));
  const after = await embedAll(doc, input.photos.after.slice(0, 2));
  const footerTop = H - 96;
  if (before.length || after.length) {
    text('BEFORE & AFTER', M, top, 8, bold, SLATE_LIGHT, { spacing: 1.2 });
    top += 16;
    const gap = 12;
    const cellW = (tableW - gap) / 2;
    const rows = Math.max(before.length, after.length, 1);
    const cellH = Math.min(150, (footerTop - top - 14 - (rows - 1) * gap - 16 * rows) / rows);
    const column = (images: PDFImage[], x: number, label: string) => {
      text(label, x, top, 9, bold, INK);
      images.forEach((img, i) => {
        const cellTop = top + 14 + i * (cellH + gap);
        drawFitted(page, img, x, cellTop, cellW, cellH);
      });
      if (!images.length) {
        page.drawRectangle({ x, y: H - top - 14 - cellH, width: cellW, height: cellH, color: PALE });
        text('No photo', x + cellW / 2, top + 14 + cellH / 2 - 5, 9, regular, SLATE_LIGHT, { align: 'center' });
      }
    };
    column(before, M, 'Before');
    column(after, M + cellW + gap, 'After');
  }

  // ─── Footer ──────────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width: W, height: 96, color: PALE });
  page.drawRectangle({ x: 0, y: 96, width: W, height: 1.5, color: GOLD });
  text(`Thank you for choosing ${input.businessName}!`, M, H - 96 + 18, 13, serif, INDIGO);
  const place = [input.branch.address, input.branch.city].filter(Boolean).join(', ');
  if (place) text(place, M, H - 96 + 40, 8.5, regular, SLATE);
  text(
    [input.branch.phone ? `Phone / WhatsApp: ${input.branch.phone.replace(/^(\d{5})(\d{5})$/, '$1 $2')}` : null, input.branch.hours].filter(Boolean).join('   ·   '),
    M,
    H - 96 + 54,
    8.5,
    regular,
    SLATE,
  );
  if (input.reviewUrl) text(`Loved the shine? Rate us on Google: ${input.reviewUrl}`, M, H - 96 + 70, 8.5, bold, TEAL);
  text('This is a computer-generated bill.', W - M, H - 96 + 70, 7.5, regular, SLATE_LIGHT, { align: 'right' });

  return doc.save();
}

async function embedAll(doc: PDFDocument, photos: BillPhoto[]): Promise<PDFImage[]> {
  const out: PDFImage[] = [];
  for (const p of photos) {
    try {
      if (p.contentType === 'image/png') out.push(await doc.embedPng(p.bytes));
      else if (p.contentType === 'image/jpeg' || p.contentType === 'image/jpg') out.push(await doc.embedJpg(p.bytes));
      // WebP isn't something a PDF can hold; it's left out.
    } catch {
      // A damaged photo is left out rather than losing the bill.
    }
  }
  return out;
}

/** The whole photo inside the cell on a night-indigo mat (a PDF page can't crop it neatly). */
function drawFitted(page: PDFPage, img: PDFImage, x: number, top: number, w: number, h: number) {
  const fit = Math.min(w / img.width, h / img.height);
  const fw = img.width * fit;
  const fh = img.height * fit;
  page.drawRectangle({ x, y: H - top - h, width: w, height: h, color: hex('#0C1442') });
  page.drawImage(img, { x: x + (w - fw) / 2, y: H - top - h + (h - fh) / 2, width: fw, height: fh });
}
