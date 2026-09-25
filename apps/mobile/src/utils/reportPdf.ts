import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatRupees } from './format';

export interface ReportExportJob {
  id: string;
  createdAt: string;
  status: string;
  total: number;
  discount: number;
  discountReason: string | null;
  paymentMethod: string | null;
  customerName: string | null;
  customerPhone: string;
  registrationNumber: string;
  vehicleType: string;
  services: string[];
}

export interface ReportExportPayload {
  generatedAt: string;
  range: string;
  label: string;
  from: string;
  to: string;
  stats: {
    carsWashed: number;
    revenue: number;
    cash: number;
    upi: number;
    other: number;
    voided: number;
    newCustomers: number;
    repeatCustomers: number;
    pendingNow: number;
    discounts: number;
    expenses: number;
    net: number;
  };
  jobs: ReportExportJob[];
}

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 40;
const INK = rgb(0.05, 0.29, 0.43);
const MUTED = rgb(0.29, 0.33, 0.41);
const LINE = rgb(0.86, 0.92, 0.98);
const TEAL = rgb(0.05, 0.58, 0.53);
const WATER = rgb(0.05, 0.65, 0.91);

const PDF_REPLACEMENTS: Record<string, string> = {
  '→': '->',
  '₹': 'Rs ',
  '—': '-',
  '–': '-',
  '…': '...',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
};

/** Standard PDF fonts only encode WinAnsi (Latin-1); map or drop everything else. */
function pdfSafe(value: string): string {
  let out = '';
  for (const ch of value) {
    const mapped = PDF_REPLACEMENTS[ch];
    if (mapped !== undefined) out += mapped;
    else if (ch.charCodeAt(0) <= 0xff) out += ch;
    else out += '?';
  }
  return out;
}

function money(paise: number): string {
  return formatRupees(paise);
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function drawLine(page: PDFPage, y: number) {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.8,
    color: LINE,
  });
}

/**
 * Builds a clean A4 MANA wash report PDF (summary + payment split + job ledger).
 * Returns raw PDF bytes ready to write / share.
 */
export async function buildReportPdf(data: ReportExportPayload): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const ensureSpace = (need: number) => {
    if (y - need >= MARGIN) return;
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    page.drawText('MANA Wash Manager — continued', {
      x: MARGIN,
      y,
      size: 9,
      font: regular,
      color: MUTED,
    });
    y -= 18;
    drawLine(page, y);
    y -= 14;
  };

  const text = (value: string, opts: { x?: number; size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> }) => {
    page.drawText(pdfSafe(value), {
      x: opts.x ?? MARGIN,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? regular,
      color: opts.color ?? INK,
    });
  };

  // Header
  text('MANA WASH MANAGER', { size: 11, font: bold, color: WATER });
  y -= 16;
  text('Business Report', { size: 20, font: bold });
  y -= 16;
  text(data.label, { size: 11, color: MUTED });
  y -= 12;
  text(`Period: ${data.from}  →  ${data.to}  (IST)`, { size: 9, color: MUTED });
  y -= 12;
  text(`Generated: ${formatWhen(data.generatedAt)}`, { size: 9, color: MUTED });
  y -= 16;
  drawLine(page, y);
  y -= 22;

  // Summary block
  text('SUMMARY', { size: 10, font: bold, color: MUTED });
  y -= 16;

  const { stats } = data;
  const avg = stats.carsWashed > 0 ? Math.round(stats.revenue / stats.carsWashed) : 0;
  const summaryRows: [string, string][] = [
    ['Revenue', money(stats.revenue)],
    ['Expenses', money(stats.expenses)],
    ['Net (revenue - expenses)', money(stats.net)],
    ['Discounts given', money(stats.discounts)],
    ['Cars washed', String(stats.carsWashed)],
    ['Average per car', stats.carsWashed > 0 ? money(avg) : '—'],
    ['In the shop now', String(stats.pendingNow)],
    ['New customers', String(stats.newCustomers)],
    ['Repeat customers', String(stats.repeatCustomers)],
    ['Voided jobs', String(stats.voided)],
  ];

  for (const [label, value] of summaryRows) {
    ensureSpace(16);
    text(label, { size: 10, color: MUTED });
    const w = bold.widthOfTextAtSize(pdfSafe(value), 10);
    text(value, { x: PAGE_W - MARGIN - w, size: 10, font: bold });
    y -= 15;
  }

  y -= 6;
  drawLine(page, y);
  y -= 20;

  // Payment split
  text('PAYMENT SPLIT', { size: 10, font: bold, color: MUTED });
  y -= 16;
  const payments: [string, number, ReturnType<typeof rgb>][] = [
    ['Cash', stats.cash, TEAL],
    ['UPI', stats.upi, WATER],
    ['Other', stats.other, MUTED],
  ];
  for (const [label, amount, color] of payments) {
    if (label === 'Other' && amount === 0) continue;
    ensureSpace(28);
    text(label, { size: 10, font: bold, color });
    const amountStr = money(amount);
    const pct = stats.revenue > 0 ? Math.round((amount / stats.revenue) * 100) : 0;
    const right = `${amountStr}  (${pct}%)`;
    const w = regular.widthOfTextAtSize(pdfSafe(right), 10);
    text(right, { x: PAGE_W - MARGIN - w, size: 10 });
    y -= 12;
    const barW = PAGE_W - MARGIN * 2;
    const fillW = stats.revenue > 0 ? (amount / stats.revenue) * barW : 0;
    page.drawRectangle({
      x: MARGIN,
      y: y - 2,
      width: barW,
      height: 5,
      color: rgb(0.94, 0.96, 0.98),
    });
    if (fillW > 0) {
      page.drawRectangle({
        x: MARGIN,
        y: y - 2,
        width: Math.max(2, fillW),
        height: 5,
        color,
      });
    }
    y -= 18;
  }

  y -= 4;
  drawLine(page, y);
  y -= 20;

  // Job ledger
  text('JOB LEDGER', { size: 10, font: bold, color: MUTED });
  y -= 14;
  text(`${data.jobs.length} job${data.jobs.length === 1 ? '' : 's'} in this period`, {
    size: 9,
    color: MUTED,
  });
  y -= 16;

  if (data.jobs.length === 0) {
    text('No jobs in this period.', { size: 10, color: MUTED });
  } else {
    for (const job of data.jobs) {
      ensureSpace(52);
      const when = formatWhen(job.createdAt);
      const name = job.customerName?.trim() || job.customerPhone;
      const reg = job.registrationNumber.startsWith('WALK-IN')
        ? 'Walk-in'
        : job.registrationNumber;
      const status = job.status.toUpperCase();

      text(when, { size: 8, color: MUTED });
      const statusW = bold.widthOfTextAtSize(pdfSafe(status), 8);
      text(status, { x: PAGE_W - MARGIN - statusW, size: 8, font: bold, color: MUTED });
      y -= 12;

      text(`${name}  ·  ${job.customerPhone}`, { size: 10, font: bold });
      y -= 12;
      text(`${reg}  ·  ${job.vehicleType}`, { size: 9, color: MUTED });
      y -= 11;
      const services = job.services.join(', ') || '—';
      text(services.length > 90 ? `${services.slice(0, 87)}…` : services, { size: 8, color: MUTED });
      y -= 11;
      const totalStr = money(job.total);
      const pay = job.paymentMethod ? job.paymentMethod.toUpperCase() : 'UNPAID';
      text(`${totalStr}  ·  ${pay}`, { size: 10, font: bold });
      if (job.discount > 0) {
        y -= 11;
        text(
          `Discount ${money(job.discount)}${job.discountReason ? ` — ${job.discountReason}` : ''}`,
          { size: 8, color: rgb(0.71, 0.32, 0.04) },
        );
      }
      y -= 10;
      drawLine(page, y);
      y -= 12;
    }
  }

  // Footer on last page
  ensureSpace(30);
  y = Math.min(y, MARGIN + 24);
  text('MANA Car Wash — confidential business report', {
    size: 8,
    color: MUTED,
    x: MARGIN,
  });

  return doc.save();
}

export function reportFilename(data: ReportExportPayload): string {
  const safe = data.label.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `MANA-Report-${safe || data.from}-${data.to}.pdf`;
}
