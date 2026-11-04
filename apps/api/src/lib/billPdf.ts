import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { RUPEE_GLYPH } from '@mana/domain';
import billLogo from '../assets/bill-logo.json';

/**
 * A wash's bill as an A4 PDF, sent on WhatsApp when it's paid and opened from the app. A white,
 * print-friendly invoice: the full-colour logo and the bill's number and date at the top, who,
 * which vehicle and how it was paid, the services in a table, the total in an indigo band, the
 * before and after photos as small thumbnails when the team took any, and the branch's details
 * at the foot. ₹ is drawn as a shape, so the standard PDF fonts are enough.
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
const NIGHT = hex('#0C1442');
const INDIGO = hex('#1B2878');
const GOLD = hex('#C9A15A');
const MIST = hex('#C4CCF0');
const INK = hex('#0F1743');
const SLATE = hex('#4A5280');
const SLATE_LIGHT = hex('#8791B5');
const LINE = hex('#E2E7FB');
const PALE = hex('#F4F6FF');
const TEAL = hex('#0E9F8E');
const TEAL_PALE = hex('#E6F7F4');
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
  const serifItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);

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
  /** A price with a drawn ₹, right edge at `right`; returns its width. */
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
  const rule = (top: number, color: RGB = LINE, thickness = 0.7, x0 = M, x1 = W - M) =>
    page.drawLine({ start: { x: x0, y: H - top }, end: { x: x1, y: H - top }, thickness, color });
  const box = (x: number, top: number, w: number, h: number, color: RGB) => page.drawRectangle({ x, y: H - top - h, width: w, height: h, color });

  // ─── Header: the logo, and the bill's number and date ──────────────────────
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: NIGHT });
  const logo = await doc.embedPng(base64Bytes(billLogo.png));
  const logoH = 40;
  const logoW = (billLogo.width / billLogo.height) * logoH;
  page.drawImage(logo, { x: M, y: H - 34 - logoH, width: logoW, height: logoH });
  text(`CAR & BIKE WASH${input.branch.city ? `  ·  ${input.branch.city.toUpperCase()}` : ''}`, M + 2, 34 + logoH + 8, 7.5, bold, SLATE_LIGHT, { spacing: 1.6 });
  text('BILL', W - M, 32, 22, serif, INDIGO, { align: 'right', spacing: 4 });
  text(`No. ${input.number}`, W - M, 60, 9, bold, INK, { align: 'right' });
  text(indiaTime(input.at), W - M, 73, 8.5, regular, SLATE, { align: 'right' });
  rule(104, GOLD, 1.2);

  // ─── Billed to · Vehicle · Payment ────────────────────────────────────────────
  let top = 122;
  const tableW = W - M * 2;
  const colW = tableW / 3;
  const customerName = safe(input.customer.name ?? '') || 'Customer';
  const phone = input.customer.phone.replace(/^(\d{5})(\d{5})$/, '$1 $2');
  const label = (s: string, x: number) => text(s.toUpperCase(), x, top, 7, bold, SLATE_LIGHT, { spacing: 1.3 });
  label('Billed to', M);
  text(customerName, M, top + 13, 11.5, bold, INK);
  text(`+91 ${phone}`, M, top + 29, 9, regular, SLATE);
  label('Vehicle', M + colW);
  text(input.vehicle.registration ? spacedPlate(input.vehicle.registration) : input.vehicle.label, M + colW, top + 13, 11.5, bold, INK);
  if (input.vehicle.registration) text(input.vehicle.label, M + colW, top + 29, 9, regular, SLATE);
  label('Payment', M + colW * 2);
  text(PAYMENT[input.paymentMethod ?? ''] ?? 'Paid', M + colW * 2, top + 13, 11.5, bold, INK);
  // A small PAID pill beside the method.
  const methodW = bold.widthOfTextAtSize(safe(PAYMENT[input.paymentMethod ?? ''] ?? 'Paid'), 11.5);
  const pillX = M + colW * 2 + methodW + 8;
  page.drawRectangle({ x: pillX, y: H - top - 12 - 14, width: 38, height: 14, color: TEAL_PALE, borderColor: TEAL, borderWidth: 0.8 });
  text('PAID', pillX + 19, top + 15.5, 7.5, bold, TEAL, { align: 'center', spacing: 1.2 });
  text(indiaTime(input.at), M + colW * 2, top + 29, 9, regular, SLATE);
  top += 56;

  // ─── Services ──────────────────────────────────────────────────────────────
  const numX = M + 12;
  const nameX = M + 34;
  const qtyX = M + tableW * 0.62;
  const rateR = M + tableW * 0.81;
  const amtR = W - M - 12;
  box(M, top, tableW, 24, NIGHT);
  text('#', numX, top + 8.5, 7.5, bold, MIST, { spacing: 1 });
  text('SERVICE', nameX, top + 8.5, 7.5, bold, WHITE, { spacing: 1.2 });
  text('QTY', qtyX, top + 8.5, 7.5, bold, WHITE, { align: 'center', spacing: 1.2 });
  text('RATE', rateR, top + 8.5, 7.5, bold, WHITE, { align: 'right', spacing: 1.2 });
  text('AMOUNT', amtR, top + 8.5, 7.5, bold, WHITE, { align: 'right', spacing: 1.2 });
  top += 24;
  input.lines.forEach((line, i) => {
    const rowH = line.note ? 36 : 28;
    if (i % 2 === 1) box(M, top, tableW, rowH, PALE);
    text(String(i + 1), numX, top + 9, 9.5, regular, SLATE_LIGHT);
    text(line.name, nameX, top + 9, 10.5, bold, INK);
    if (line.note) text(line.note, nameX, top + 23, 8, regular, TEAL);
    text(String(line.quantity), qtyX, top + 9, 10, regular, INK, { align: 'center' });
    if (line.amount === 0) {
      text('Free', amtR, top + 9, 10, bold, TEAL, { align: 'right' });
    } else {
      price(line.unitPrice, rateR, top + 9, 10, regular, SLATE);
      price(line.amount, amtR, top + 9, 10, bold, INK);
    }
    top += rowH;
  });
  rule(top, LINE, 0.8);

  // ─── Totals ────────────────────────────────────────────────────────────────
  top += 12;
  const totalsX = M + tableW * 0.52;
  const totalsW = W - M - totalsX;
  const sub = (name: string, paise: number, minus = false, note: string | null = null) => {
    text(name, totalsX + 12, top, 9.5, regular, SLATE);
    const w = price(paise, amtR, top, 9.5, regular, minus ? TEAL : INK);
    if (minus) text('-', amtR - w - 3, top, 9.5, regular, TEAL, { align: 'right' });
    top += 16;
    if (note) {
      text(note, totalsX + 12, top - 3, 7.5, regular, SLATE_LIGHT);
      top += 10;
    }
  };
  sub('Subtotal', input.subtotal);
  if (input.discount > 0) sub('Discount', input.discount, true, input.discountReason ? safe(input.discountReason).slice(0, 48) : null);
  top += 4;
  box(totalsX, top, totalsW, 34, INDIGO);
  text('TOTAL PAID', totalsX + 12, top + 12.5, 8.5, bold, MIST, { spacing: 1.4 });
  price(input.total, amtR, top + 9, 16, bold, WHITE);
  top += 34;
  if (input.discount > 0) {
    text('You saved', totalsX + 12, top + 8, 8.5, bold, TEAL);
    price(input.discount, amtR, top + 8, 8.5, bold, TEAL);
    top += 18;
  }
  top += 22;

  // ─── Before & after (only when the team took photos) ─────────────────────────
  const before = await embedAll(doc, input.photos.before.slice(0, 2));
  const after = await embedAll(doc, input.photos.after.slice(0, 2));
  const shots = [...before.map((img) => ({ img, kind: 'Before' })), ...after.map((img) => ({ img, kind: 'After' }))];
  const footerTop = H - 118;
  if (shots.length) {
    text('BEFORE & AFTER', M, top, 7.5, bold, SLATE_LIGHT, { spacing: 1.3 });
    top += 16;
    const gap = 10;
    const cellW = (tableW - gap * 3) / 4;
    const cellH = Math.min(cellW * 0.75, footerTop - top - 30);
    if (cellH > 40) {
      shots.forEach(({ img, kind }, i) => {
        const x = M + i * (cellW + gap);
        drawFitted(page, img, x, top, cellW, cellH);
        text(kind, x, top + cellH + 5, 8, bold, kind === 'After' ? TEAL : SLATE);
      });
    }
  }

  // ─── Footer ──────────────────────────────────────────────────────────────────
  rule(footerTop, GOLD, 1.2);
  text(`Thank you for choosing ${input.businessName}!`, M, footerTop + 16, 14, serifItalic, INDIGO);
  const city = input.branch.city;
  const place = [input.branch.address, city && !input.branch.address?.toLowerCase().includes(city.toLowerCase()) ? city : null].filter(Boolean).join(', ');
  if (place) text(place, M, footerTop + 38, 8.5, regular, SLATE);
  const contact = [
    input.branch.phone ? `Phone / WhatsApp ${input.branch.phone.replace(/^(\d{5})(\d{5})$/, '$1 $2')}` : null,
    input.branch.hours,
  ].filter(Boolean).join('   ·   ');
  if (contact) text(contact, M, footerTop + 52, 8.5, regular, SLATE);
  if (input.reviewUrl) text(`Loved the shine? Rate us on Google: ${input.reviewUrl}`, M, footerTop + 68, 8.5, bold, TEAL);
  page.drawRectangle({ x: 0, y: 0, width: W, height: 22, color: NIGHT });
  text('This is a computer-generated bill and needs no signature.', W / 2, H - 15, 7, regular, MIST, { align: 'center' });

  return doc.save();
}

/** "AP40AW3456" → "AP 40 AW 3456"; anything else as it is. */
function spacedPlate(reg: string): string {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(reg.replace(/\s+/g, '').toUpperCase());
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : reg;
}

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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

/** The whole photo inside the cell on a soft mat with a hairline frame (a PDF page can't crop it neatly). */
function drawFitted(page: PDFPage, img: PDFImage, x: number, top: number, w: number, h: number) {
  const fit = Math.min(w / img.width, h / img.height);
  const fw = img.width * fit;
  const fh = img.height * fit;
  page.drawRectangle({ x, y: H - top - h, width: w, height: h, color: PALE, borderColor: LINE, borderWidth: 0.8 });
  page.drawImage(img, { x: x + (w - fw) / 2, y: H - top - h + (h - fh) / 2, width: fw, height: fh });
}
