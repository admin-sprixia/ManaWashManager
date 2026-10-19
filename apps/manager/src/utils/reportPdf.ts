import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { Image } from 'react-native';
import { APP_VERSION } from '../config/app';
import { SHOP } from '../config/shop';
import { formatRupees } from './format';

export interface ReportExportJob {
  id: string;
  createdAt: string;
  completedAt?: string | null;
  status: string;
  total: number;
  discount: number;
  discountReason: string | null;
  paymentMethod: string | null;
  /** A wash plan sold at the counter: money in, not a car washed. */
  planSale?: boolean;
  customerName: string | null;
  customerPhone: string;
  registrationNumber: string;
  vehicleType: string;
  services: string[];
  createdBy?: string | null;
  paidBy?: string | null;
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
    planIncome?: number;
    planPayments?: number;
    doorstepWashes?: number;
    doorstepRevenue?: number;
    communityWashes?: number;
    shopPlansSold?: number;
    shopPlanRevenue?: number;
    net: number;
  };
  previous?: {
    from: string;
    to: string;
    carsWashed: number;
    revenue: number;
    expenses: number;
    planIncome?: number;
    planPayments?: number;
    net: number;
    cash: number;
    upi: number;
    other: number;
    discounts: number;
    voided: number;
  } | null;
  shop?: {
    name: string | null;
    city: string | null;
    code: string | null;
    address: string | null;
    phone: string | null;
    businessName: string | null;
    owners: { name: string; phone: string }[];
  } | null;
  gst?: {
    rateBp: number;
    gstin: string | null;
    legalName: string | null;
    taxable: number;
    cgst: number;
    sgst: number;
  } | null;
  expensesByCategory?: { category: string; label: string; amount: number; count: number }[];
  staff?: {
    name: string;
    role: string;
    washesDone: number;
    communityWashes: number;
    servicesSold: number;
    commission: number;
    jobsCollected: number;
    collected: number;
    cash: number;
    upi: number;
  }[];
  stock?: { name: string; unit: string; balance: number; lowAt: number | null; low: boolean }[];
  rewards?: ReportRewardsExtra | null;
  jobs: ReportExportJob[];
}

export interface ReportRewardsExtra {
  freeWashes: number;
  freeValue: number;
  giftsGiven: number;
  giftsOwedNow: number;
  gifts: { name: string; label: string; unit: string; quantity: number }[];
}

export interface ReportShopMeta {
  name: string;
  city?: string | null;
  code?: string | null;
  generatedBy?: { name: string; phone?: string | null; role?: string | null } | null;
  rewards?: ReportRewardsExtra | null;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 36;
const TOP_CONTINUED = 44;

const INK = rgb(0.07, 0.09, 0.2);
const MUTED = rgb(0.42, 0.46, 0.55);
const FAINT = rgb(0.62, 0.66, 0.74);
const LINE = rgb(0.9, 0.92, 0.95);
const SURFACE = rgb(0.97, 0.975, 0.985);
const WHITE = rgb(1, 1, 1);
const NIGHT = rgb(0.06, 0.09, 0.28);
const INDIGO = rgb(0.27, 0.35, 0.8);
const INDIGO_DEEP = rgb(0.11, 0.16, 0.47);
const TEAL = rgb(0.05, 0.55, 0.5);
const TEAL_DEEP = rgb(0.04, 0.4, 0.37);
const WATER = rgb(0.05, 0.62, 0.88);
const AMBER = rgb(0.78, 0.45, 0.05);
const DANGER = rgb(0.72, 0.14, 0.18);
const SKY = rgb(0.35, 0.75, 0.92);

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
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function prettyDay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T12:00:00+05:30`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function roleLabel(role?: string | null): string {
  if (role === 'owner') return 'Owner';
  if (role === 'manager') return 'Manager';
  if (role === 'staff') return 'Staff';
  return role?.trim() || '';
}

function formatPhone(p: string): string {
  const d = p.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : p;
}

function deltaPct(cur: number, prev: number): string {
  if (prev === 0 && cur === 0) return '0%';
  if (prev === 0) return 'new';
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return '0%';
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

function hourLabel(h: number): string {
  const fmt = (n: number) => `${String(n).padStart(2, '0')}:00`;
  return `${fmt(h)}-${fmt((h + 1) % 24)}`;
}

async function loadLogoBytes(): Promise<Uint8Array | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-argument
    const asset = Image.resolveAssetSource(require('../assets/mana-mark-dark.png'));
    if (!asset?.uri) return null;
    const res = await fetch(asset.uri);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** "2026-10-18" for an instant, in India time. */
function istDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Washes in the report, on the day they were paid (India time), as Reports and the cash drawer
 * count them: unpaid washes, voids and plan sales are left out, so the totals match the summary.
 */
function buildInsights(jobs: ReportExportJob[], from: string, to: string) {
  const live = jobs.filter((j) => {
    if (j.status !== 'paid' || j.planSale || !j.completedAt) return false;
    const day = istDay(j.completedAt);
    return day >= from && day <= to;
  });
  const serviceCount = new Map<string, number>();
  const vehicleCount = new Map<string, number>();
  const dayCount = new Map<string, { key: string; label: string; n: number; revenue: number }>();
  const hourCount = new Map<number, { n: number; revenue: number }>();
  const customerCount = new Map<string, { name: string; phone: string; n: number; revenue: number }>();
  const collectorCount = new Map<string, { n: number; revenue: number }>();

  for (const j of live) {
    for (const s of j.services) serviceCount.set(s, (serviceCount.get(s) ?? 0) + 1);
    if (j.vehicleType) vehicleCount.set(j.vehicleType, (vehicleCount.get(j.vehicleType) ?? 0) + 1);

    const dayKey = istDay(j.completedAt!);
    const day = dayCount.get(dayKey) ?? { key: dayKey, label: prettyDay(dayKey), n: 0, revenue: 0 };
    day.n += 1;
    day.revenue += j.total;
    dayCount.set(dayKey, day);

    const hour = Number(
      new Date(j.createdAt).toLocaleString('en-GB', {
        hour: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata',
      }),
    );
    if (Number.isFinite(hour)) {
      const h = hourCount.get(hour) ?? { n: 0, revenue: 0 };
      h.n += 1;
      h.revenue += j.total;
      hourCount.set(hour, h);
    }

    const custKey = j.customerPhone || j.customerName || j.id;
    const cust = customerCount.get(custKey) ?? {
      name: j.customerName?.trim() || j.customerPhone,
      phone: j.customerPhone,
      n: 0,
      revenue: 0,
    };
    cust.n += 1;
    cust.revenue += j.total;
    customerCount.set(custKey, cust);

    const who = j.paidBy?.trim() || j.createdBy?.trim();
    if (who) {
      const row = collectorCount.get(who) ?? { n: 0, revenue: 0 };
      row.n += 1;
      row.revenue += j.total;
      collectorCount.set(who, row);
    }
  }

  const topN = <T extends { n: number }>(map: Map<string, T>, take: number) =>
    [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.n - a.n)
      .slice(0, take);

  return {
    liveCount: live.length,
    topServices: topN(
      new Map([...serviceCount].map(([k, n]) => [k, { n }])),
      5,
    ),
    topVehicles: topN(
      new Map([...vehicleCount].map(([k, n]) => [k, { n }])),
      4,
    ),
    busiestDay: [...dayCount.values()].sort((a, b) => b.n - a.n || b.revenue - a.revenue)[0] ?? null,
    topCollectors: [...collectorCount.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5),
    days: [...dayCount.values()].sort((a, b) => a.key.localeCompare(b.key)),
    peakHours: [...hourCount.entries()]
      .map(([hour, v]) => ({ hour, ...v }))
      .sort((a, b) => b.n - a.n || b.revenue - a.revenue)
      .slice(0, 6),
    topCustomers: [...customerCount.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8),
  };
}

/** "AP39AB1234" → "AP 39 AB 1234", as painted on the plate. */
function plate(reg: string): string {
  if (reg.startsWith('WALK-IN')) return 'Walk-in';
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(reg);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : reg;
}

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Color = ReturnType<typeof rgb>;

/**
 * Branded A4 business report. Every block takes its own height from the top down (its stripe
 * and text inside it), so nothing can be drawn over anything else; small sections move to the
 * next page whole instead of splitting.
 */
export async function buildReportPdf(
  data: ReportExportPayload,
  shopMeta?: ReportShopMeta,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const apiShop = data.shop;
  const shopName = (shopMeta?.name ?? apiShop?.name ?? SHOP.name)?.trim() || 'Mana Wash';
  const shopCity = (shopMeta?.city ?? apiShop?.city)?.trim() || null;
  const shopCode = (shopMeta?.code ?? apiShop?.code)?.trim() || null;
  const generatedBy = shopMeta?.generatedBy ?? null;
  const rewards = data.rewards ?? shopMeta?.rewards ?? null;
  const insights = buildInsights(data.jobs, data.from, data.to);
  const gst = data.gst ?? null;
  const previous = data.previous ?? null;
  const expensesByCategory = data.expensesByCategory ?? [];
  const staff = data.staff ?? [];
  const stock = data.stock ?? [];
  const { stats } = data;
  const planSales = stats.shopPlanRevenue ?? 0;
  // Whole rupees: an average in paise reads like noise.
  const avg = stats.carsWashed > 0 ? Math.round((stats.revenue - planSales) / stats.carsWashed / 100) * 100 : 0;

  let logo: PDFImage | null = null;
  const logoBytes = await loadLogoBytes();
  if (logoBytes) {
    try {
      logo = await doc.embedPng(logoBytes);
    } catch {
      logo = null;
    }
  }

  const BOTTOM = FOOTER_H + 24;
  const pages: PDFPage[] = [];
  let page = doc.addPage([PAGE_W, PAGE_H]);
  pages.push(page);
  /** The top of the next block. */
  let y = PAGE_H - MARGIN;

  const width = (t: string, size: number, font: PDFFont = regular) => font.widthOfTextAtSize(pdfSafe(t), size);

  /** Shortens to fit `maxWidth`, ending in "...". */
  const fit = (t: string, size: number, font: PDFFont, maxWidth: number) => {
    let s = pdfSafe(t);
    if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
    while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > maxWidth) s = s.slice(0, -1);
    return `${s.trimEnd()}...`;
  };

  /** Breaks text into lines that fit `maxWidth`. */
  const wrap = (t: string, size: number, font: PDFFont, maxWidth: number): string[] => {
    const words = pdfSafe(t).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else {
        if (line) lines.push(line);
        line = font.widthOfTextAtSize(w, size) <= maxWidth ? w : fit(w, size, font, maxWidth);
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  /** Text with its baseline at `baseline`. */
  const text = (
    t: string,
    x: number,
    baseline: number,
    o: { size?: number; font?: PDFFont; color?: Color; maxWidth?: number; align?: 'left' | 'right' } = {},
  ) => {
    const size = o.size ?? 9.5;
    const font = o.font ?? regular;
    const s = o.maxWidth ? fit(t, size, font, o.maxWidth) : pdfSafe(t);
    const w = font.widthOfTextAtSize(s, size);
    page.drawText(s, { x: o.align === 'right' ? x - w : x, y: baseline, size, font, color: o.color ?? INK });
  };

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: PAGE_H - TOP_CONTINUED, width: PAGE_W, height: TOP_CONTINUED, color: NIGHT });
    // Starts inside the band and runs off the top edge, so none of it reaches the page below.
    if (logo) page.drawImage(logo, { x: PAGE_W - 230, y: PAGE_H - TOP_CONTINUED + 2, width: 90, height: 90, opacity: 0.09 });
    text(shopName, MARGIN, PAGE_H - 27, { size: 9.5, font: bold, color: WHITE, maxWidth: CONTENT_W * 0.6 });
    text(`${data.label}  ·  continued`, PAGE_W - MARGIN, PAGE_H - 27, { size: 8, color: rgb(0.72, 0.78, 0.92), align: 'right' });
    y = PAGE_H - TOP_CONTINUED - 26;
  };

  /** Starts a new page unless `need` points fit above the footer. */
  const ensure = (need: number) => {
    if (y - need < BOTTOM) newPage();
  };

  const space = (n: number) => {
    y -= n;
  };

  const ROW_H = 20;
  const SECTION_H = 30;

  /** A section title; `keep` is the height that must follow on the same page (its first rows). */
  const section = (title: string, keep = ROW_H * 2) => {
    ensure(SECTION_H + keep);
    space(8);
    text(title.toUpperCase(), MARGIN, y - 9, { size: 8.5, font: bold, color: INDIGO_DEEP });
    page.drawRectangle({ x: MARGIN, y: y - 15, width: 26, height: 2, color: INDIGO });
    space(SECTION_H - 8);
  };

  /** A small grey heading inside a section, kept with the row after it. */
  const subhead = (t: string, color: Color = MUTED) => {
    ensure(22 + ROW_H);
    space(8);
    text(t, MARGIN, y - 10, { size: 8, font: bold, color });
    space(16);
  };

  /** A note line (wraps). */
  const note = (t: string, o: { size?: number; color?: Color; font?: PDFFont } = {}) => {
    const size = o.size ?? 8;
    const lines = wrap(t, size, o.font ?? regular, CONTENT_W);
    const lh = size + 4;
    ensure(lines.length * lh + 4);
    for (const l of lines) {
      text(l, MARGIN, y - size - 1, { size, color: o.color ?? FAINT, font: o.font });
      space(lh);
    }
    space(4);
  };

  const stripe = (i: number, h: number, x = MARGIN, w = CONTENT_W) => {
    if (i % 2 === 0) page.drawRectangle({ x, y: y - h, width: w, height: h, color: SURFACE });
  };

  /** Label on the left, value on the right, in its own 20pt band. */
  const row = (label: string, value: string, i: number, o: { valueColor?: Color; labelColor?: Color } = {}) => {
    ensure(ROW_H);
    stripe(i, ROW_H);
    const valueW = Math.min(width(value, 9.5, bold), CONTENT_W * 0.55);
    text(label, MARGIN + 8, y - 13.5, { size: 9, color: o.labelColor ?? MUTED, maxWidth: CONTENT_W - valueW - 32 });
    text(value, PAGE_W - MARGIN - 8, y - 13.5, { size: 9.5, font: bold, color: o.valueColor ?? INK, align: 'right', maxWidth: CONTENT_W * 0.55 });
    space(ROW_H);
  };

  /** Two label/value columns side by side. */
  const twoCol = (left: [string, string][], right: [string, string][]) => {
    const n = Math.max(left.length, right.length);
    const gutter = 20;
    const colW = (CONTENT_W - gutter) / 2;
    ensure(Math.min(n, 3) * ROW_H);
    for (let i = 0; i < n; i++) {
      ensure(ROW_H);
      ([left[i], right[i]] as const).forEach((cell, c) => {
        if (!cell) return;
        const x = MARGIN + c * (colW + gutter);
        stripe(i, ROW_H, x, colW);
        const vw = Math.min(width(cell[1], 9.5, bold), colW * 0.6);
        text(cell[0], x + 8, y - 13.5, { size: 9, color: MUTED, maxWidth: colW - vw - 24 });
        text(cell[1], x + colW - 8, y - 13.5, { size: 9.5, font: bold, align: 'right', maxWidth: colW * 0.6 });
      });
      space(ROW_H);
    }
  };

  interface Column {
    title: string;
    /** Left edge, from the margin. */
    x: number;
    w: number;
    align?: 'left' | 'right';
  }
  /** A table's header band. */
  const tableHead = (cols: Column[]) => {
    ensure(22 + ROW_H);
    page.drawRectangle({ x: MARGIN, y: y - 20, width: CONTENT_W, height: 20, color: rgb(0.93, 0.94, 0.98) });
    for (const c of cols) {
      const x = c.align === 'right' ? MARGIN + c.x + c.w : MARGIN + c.x;
      text(c.title.toUpperCase(), x, y - 13, { size: 7, font: bold, color: INDIGO_DEEP, align: c.align, maxWidth: c.w });
    }
    space(20);
  };

  // ── Cover ──────────────────────────────────────────────────────────────────
  const headerH = 124;
  page.drawRectangle({ x: 0, y: PAGE_H - headerH, width: PAGE_W, height: headerH, color: NIGHT });
  page.drawRectangle({ x: 0, y: PAGE_H - headerH, width: PAGE_W, height: 3, color: SKY });
  if (logo) {
    // A large, faint mark behind the header; the page edge trims what runs past the top.
    const wm = 190;
    page.drawImage(logo, { x: PAGE_W - wm + 30, y: PAGE_H - headerH + 8, width: wm, height: wm, opacity: 0.08 });
  }
  const mark = 52;
  if (logo) page.drawImage(logo, { x: MARGIN, y: PAGE_H - 34 - mark, width: mark, height: mark });
  const tx = logo ? MARGIN + mark + 16 : MARGIN;
  const headW = PAGE_W - MARGIN - tx - 150;
  text('MANA WASH', tx, PAGE_H - 36, { size: 8, font: bold, color: rgb(0.68, 0.74, 0.92) });
  text(shopName, tx, PAGE_H - 58, { size: 19, font: bold, color: WHITE, maxWidth: headW });
  const metaBits = [apiShop?.businessName?.trim(), shopCity, shopCode ? `Branch ${shopCode}` : null].filter(Boolean).join('  ·  ');
  if (metaBits) text(metaBits, tx, PAGE_H - 76, { size: 9.5, color: rgb(0.78, 0.82, 0.94), maxWidth: headW });
  text('BUSINESS REPORT', PAGE_W - MARGIN, PAGE_H - 36, { size: 8, font: bold, color: rgb(0.55, 0.88, 0.82), align: 'right' });
  text(data.label, PAGE_W - MARGIN, PAGE_H - 56, { size: 13, font: bold, color: WHITE, align: 'right', maxWidth: 150 });
  text(data.from === data.to ? prettyDay(data.from) : `${prettyDay(data.from)} - ${prettyDay(data.to)}`, PAGE_W - MARGIN, PAGE_H - 72, {
    size: 8.5,
    color: rgb(0.78, 0.82, 0.94),
    align: 'right',
  });
  text(`Generated ${formatWhen(data.generatedAt)}`, tx, PAGE_H - headerH + 18, { size: 8, color: rgb(0.62, 0.68, 0.86) });
  if (generatedBy?.name) {
    const by = [generatedBy.name.trim(), roleLabel(generatedBy.role)].filter(Boolean).join(', ');
    text(`by ${by}`, PAGE_W - MARGIN, PAGE_H - headerH + 18, { size: 8, color: rgb(0.62, 0.68, 0.86), align: 'right', maxWidth: 220 });
  }
  y = PAGE_H - headerH - 18;

  // Shop details: wrapped, never cut.
  const contactParts: string[] = [];
  if (apiShop?.address?.trim()) contactParts.push(apiShop.address.trim());
  if (apiShop?.phone?.trim()) contactParts.push(`Phone +91 ${formatPhone(apiShop.phone)}`);
  if (gst?.legalName?.trim()) contactParts.push(gst.legalName.trim());
  if (gst?.gstin?.trim()) contactParts.push(`GSTIN ${gst.gstin.trim()}`);
  if (apiShop?.owners?.length) {
    contactParts.push(`Owner${apiShop.owners.length > 1 ? 's' : ''}: ${apiShop.owners.map((o) => o.name).join(', ')}`);
  }
  if (contactParts.length) {
    note(contactParts.join('   ·   '), { size: 8, color: MUTED });
    space(6);
  }

  // Headline figures: four tiles.
  const kpis: { label: string; value: string; accent: Color }[] = [
    { label: 'Revenue', value: money(stats.revenue), accent: INDIGO },
    { label: 'Expenses', value: money(stats.expenses), accent: AMBER },
    { label: 'Net', value: money(stats.net), accent: stats.net < 0 ? DANGER : TEAL },
    { label: 'Washes', value: String(stats.carsWashed + (stats.communityWashes ?? 0)), accent: WATER },
  ];
  const kpiGap = 10;
  const kpiW = (CONTENT_W - kpiGap * 3) / 4;
  const kpiH = 58;
  ensure(kpiH + 10);
  kpis.forEach((k, i) => {
    const x = MARGIN + i * (kpiW + kpiGap);
    page.drawRectangle({ x, y: y - kpiH, width: kpiW, height: kpiH, color: WHITE, borderColor: LINE, borderWidth: 0.8 });
    page.drawRectangle({ x, y: y - 3, width: kpiW, height: 3, color: k.accent });
    text(k.label.toUpperCase(), x + 11, y - 19, { size: 7, font: bold, color: FAINT });
    let size = 15;
    while (size > 9 && width(k.value, size, bold) > kpiW - 22) size -= 0.5;
    text(k.value, x + 11, y - 42, { size, font: bold });
  });
  space(kpiH + 8);

  // ── Summary ────────────────────────────────────────────────────────────────
  section('Summary');
  const totalCustomers = stats.newCustomers + stats.repeatCustomers;
  const repeatPct = totalCustomers > 0 ? Math.round((stats.repeatCustomers / totalCustomers) * 100) : 0;
  const summaryLeft: [string, string][] = [
    ['Wash revenue', money(stats.revenue - planSales)],
    ...(planSales ? ([[`Plans sold at the shop (${stats.shopPlansSold ?? 0})`, money(planSales)]] as [string, string][]) : []),
    ...(stats.planIncome ? ([[`Community plans (${stats.planPayments ?? 0})`, money(stats.planIncome)]] as [string, string][]) : []),
    ['Expenses', money(stats.expenses)],
    ['Net', money(stats.net)],
    ['Discounts', money(stats.discounts)],
  ];
  const summaryRight: [string, string][] = [
    ...((stats.doorstepWashes ?? 0) > 0 || (stats.communityWashes ?? 0) > 0
      ? ([
          ['Washed at the shop', String(stats.carsWashed - (stats.doorstepWashes ?? 0))],
          ['At customers’ homes', `${stats.doorstepWashes ?? 0} · ${money(stats.doorstepRevenue ?? 0)}`],
          ['At communities', String(stats.communityWashes ?? 0)],
        ] as [string, string][])
      : []),
    ['Avg per vehicle', stats.carsWashed > 0 ? money(avg) : '-'],
    ['In the shop now', String(stats.pendingNow)],
    ['New customers', String(stats.newCustomers)],
    ['Repeat customers', totalCustomers > 0 ? `${stats.repeatCustomers} (${repeatPct}%)` : String(stats.repeatCustomers)],
    ['Voided', String(stats.voided)],
  ];
  twoCol(summaryLeft, summaryRight);
  space(6);

  // ── Compared with the period before ────────────────────────────────────────
  if (previous) {
    section('Compared with the period before', 16 + ROW_H * 4);
    note(`${prettyDay(previous.from)} - ${prettyDay(previous.to)}, the same number of days just before this report.`);
    const cmp: [string, number, number, boolean, boolean][] = [
      ['Revenue', stats.revenue, previous.revenue, true, true],
      ['Expenses', stats.expenses, previous.expenses, true, false],
      ['Net', stats.net, previous.net, true, true],
      ['Washes', stats.carsWashed, previous.carsWashed, false, true],
    ];
    cmp.forEach(([label, cur, prev, isMoney, upIsGood], i) => {
      const delta = deltaPct(cur, prev);
      const up = delta.startsWith('+');
      const down = delta.startsWith('-');
      const good = (up && upIsGood) || (down && !upIsGood);
      const bad = (down && upIsGood) || (up && !upIsGood);
      row(
        `${label}   ${delta}`,
        isMoney ? `${money(cur)}  (was ${money(prev)})` : `${cur}  (was ${prev})`,
        i,
        { valueColor: good ? TEAL_DEEP : bad ? DANGER : INK },
      );
    });
    space(6);
  }

  // ── How it was paid ────────────────────────────────────────────────────────
  const pays: [string, number, Color][] = [
    ['Cash', stats.cash, TEAL],
    ['UPI', stats.upi, WATER],
    ['Other', stats.other, MUTED],
  ];
  const shownPays = pays.filter(([label, amount]) => !(label === 'Other' && amount === 0));
  section('How it was paid', shownPays.length * 30);
  for (const [label, amount, color] of shownPays) {
    ensure(30);
    const pct = stats.revenue > 0 ? Math.round((amount / stats.revenue) * 100) : 0;
    text(label, MARGIN, y - 11, { size: 9.5, font: bold, color });
    text(`${money(amount)}   ${pct}%`, PAGE_W - MARGIN, y - 11, { size: 9.5, font: bold, align: 'right' });
    page.drawRectangle({ x: MARGIN, y: y - 22, width: CONTENT_W, height: 5, color: SURFACE });
    const fill = stats.revenue > 0 ? (amount / stats.revenue) * CONTENT_W : 0;
    if (fill > 0) page.drawRectangle({ x: MARGIN, y: y - 22, width: Math.max(3, fill), height: 5, color });
    space(30);
  }
  space(4);

  // ── GST ────────────────────────────────────────────────────────────────────
  if (gst && gst.rateBp > 0) {
    const rate = (gst.rateBp / 100).toFixed(gst.rateBp % 100 === 0 ? 0 : 1);
    const gstRows: [string, string][] = [
      ['Rate', `${rate}%`],
      ...(gst.legalName ? ([['Legal name', gst.legalName]] as [string, string][]) : []),
      ...(gst.gstin ? ([['GSTIN', gst.gstin]] as [string, string][]) : []),
      ['Taxable value', money(gst.taxable)],
      ['CGST', money(gst.cgst)],
      ['SGST', money(gst.sgst)],
      ['Total (incl. GST)', money(stats.revenue + (stats.planIncome ?? 0))],
    ];
    section('GST', gstRows.length * ROW_H);
    gstRows.forEach(([l, v], i) => row(l, v, i));
    space(6);
  }

  // ── Expenses by category ───────────────────────────────────────────────────
  if (expensesByCategory.length) {
    section('Expenses by category', Math.min(expensesByCategory.length, 6) * ROW_H);
    expensesByCategory.forEach((e, i) => row(`${e.label}  (${plural(e.count, 'bill')})`, money(e.amount), i));
    space(6);
  }

  // ── Insights ───────────────────────────────────────────────────────────────
  if (insights.liveCount > 0) {
    section('Insights', ROW_H * 3);
    if (insights.busiestDay) {
      row('Busiest day', `${insights.busiestDay.label}  ·  ${plural(insights.busiestDay.n, 'wash', 'washes')}  ·  ${money(insights.busiestDay.revenue)}`, 0);
    }
    if (insights.topServices.length) {
      subhead('Most sold services');
      insights.topServices.forEach((x, i) => row(x.name, plural(x.n, 'time'), i));
    }
    if (insights.topVehicles.length) {
      subhead('Vehicle mix');
      insights.topVehicles.forEach((x, i) => row(x.name, `${x.n}  (${Math.round((x.n / insights.liveCount) * 100)}%)`, i));
    }
    if (insights.topCollectors.length) {
      subhead('Collected by');
      insights.topCollectors.forEach((x, i) => row(x.name, `${plural(x.n, 'wash', 'washes')}  ·  ${money(x.revenue)}`, i));
    }
    space(6);
  }

  // ── Day by day ─────────────────────────────────────────────────────────────
  if (insights.days.length > 1) {
    section('Day by day', ROW_H * 3);
    insights.days.forEach((d, i) => row(d.label, `${plural(d.n, 'wash', 'washes')}  ·  ${money(d.revenue)}`, i));
    space(6);
  }

  // ── Busiest hours ──────────────────────────────────────────────────────────
  if (insights.peakHours.length) {
    section('Busiest hours', insights.peakHours.length * ROW_H);
    insights.peakHours.forEach((h, i) => row(hourLabel(h.hour), `${plural(h.n, 'visit')}  ·  ${money(h.revenue)}`, i));
    space(6);
  }

  // ── Top customers ──────────────────────────────────────────────────────────
  if (insights.topCustomers.length) {
    section('Top customers', ROW_H * 3);
    insights.topCustomers.forEach((c, i) =>
      row(`${c.name}${c.phone && c.phone !== c.name ? `  ·  +91 ${formatPhone(c.phone)}` : ''}`, `${plural(c.n, 'visit')}  ·  ${money(c.revenue)}`, i),
    );
    space(6);
  }

  // ── Staff ──────────────────────────────────────────────────────────────────
  if (staff.length) {
    const cols: Column[] = [
      { title: 'Name', x: 8, w: 170 },
      { title: 'Washes', x: 190, w: 60, align: 'right' },
      { title: 'Services sold', x: 258, w: 70, align: 'right' },
      { title: 'Commission', x: 336, w: 70, align: 'right' },
      { title: 'Collected', x: 414, w: CONTENT_W - 422, align: 'right' },
    ];
    section('Staff and commission', 22 + ROW_H * 2);
    tableHead(cols);
    staff.forEach((m, i) => {
      if (y - ROW_H < BOTTOM) {
        newPage();
        tableHead(cols);
      }
      stripe(i + 1, ROW_H);
      const base = y - 13.5;
      text(m.name, MARGIN + cols[0]!.x, base, { size: 9, font: bold, maxWidth: cols[0]!.w });
      const cells = [
        String(m.washesDone + m.communityWashes),
        String(m.servicesSold),
        m.commission > 0 ? money(m.commission) : '-',
        money(m.collected),
      ];
      cells.forEach((v, c) => {
        const col = cols[c + 1]!;
        text(v, MARGIN + col.x + col.w, base, {
          size: 9,
          font: c === 3 ? bold : regular,
          color: c === 3 ? TEAL_DEEP : MUTED,
          align: 'right',
          maxWidth: col.w,
        });
      });
      space(ROW_H);
    });
    space(6);
  }

  // ── Stock ──────────────────────────────────────────────────────────────────
  if (stock.length || data.stock) {
    section('Stock', ROW_H * 2);
    if (!stock.length) {
      note('No stock items yet.', { size: 9, color: MUTED });
    } else {
      const low = stock.filter((x) => x.low);
      const ok = stock.filter((x) => !x.low);
      if (low.length) {
        subhead('Running low, buy soon', DANGER);
        low.forEach((x, i) =>
          row(x.name, `${x.balance} ${x.unit}${x.lowAt != null ? `  (low at ${x.lowAt})` : ''}`, i, { valueColor: DANGER }),
        );
      } else {
        note('Everything is above its low mark.', { size: 9, color: MUTED });
      }
      const showOk = ok.slice(0, 12);
      if (showOk.length) {
        subhead(ok.length > showOk.length ? `In stock (${showOk.length} of ${ok.length})` : 'In stock');
        showOk.forEach((x, i) => row(x.name, `${x.balance} ${x.unit}`, i));
      }
    }
    space(6);
  }

  // ── Rewards ────────────────────────────────────────────────────────────────
  if (rewards && (rewards.freeWashes > 0 || rewards.giftsGiven > 0 || rewards.giftsOwedNow > 0 || rewards.freeValue > 0)) {
    section('Rewards', ROW_H * 4 + 30);
    row('Free washes used', String(rewards.freeWashes), 0);
    row('Value given free', money(rewards.freeValue), 1);
    row('Gifts handed over', String(rewards.giftsGiven), 2);
    row('Gifts owed now', String(rewards.giftsOwedNow), 3, { valueColor: rewards.giftsOwedNow > 0 ? AMBER : INK });
    space(6);
    if (rewards.gifts.length) {
      note(
        `Handed over: ${rewards.gifts.map((g) => (g.unit === 'pcs' ? `${g.name} x ${g.quantity}` : `${g.name} ${g.label}`)).join(', ')}`,
        { size: 8, color: MUTED },
      );
    }
    note('Free washes are already counted inside Discounts.');
    space(4);
  }

  // ── Every wash ─────────────────────────────────────────────────────────────
  const LEDGER_H = 32;
  const ledgerCols: Column[] = [
    { title: 'When', x: 8, w: 66 },
    { title: 'Customer and services', x: 82, w: 196 },
    { title: 'Vehicle', x: 288, w: 104 },
    { title: 'Amount', x: 398, w: CONTENT_W - 406, align: 'right' },
  ];
  section(`Every wash  (${data.jobs.length})`, 22 + LEDGER_H * 2);
  if (data.jobs.length === 0) {
    note('No washes in this period.', { size: 9.5, color: MUTED });
  } else {
    tableHead(ledgerCols);
    data.jobs.forEach((job, i) => {
      if (y - LEDGER_H < BOTTOM) {
        newPage();
        tableHead(ledgerCols);
      }
      const voided = /void|cancel/i.test(job.status);
      stripe(i + 1, LEDGER_H);
      const top = y - 13;
      const sub = y - 25;
      const [c0, c1, c2, c3] = ledgerCols as [Column, Column, Column, Column];
      text(shortDay(job.createdAt), MARGIN + c0.x, top, { size: 8.5, font: bold, color: INK });
      text(shortTime(job.createdAt), MARGIN + c0.x, sub, { size: 7.5, color: FAINT });

      text(job.customerName?.trim() || job.customerPhone, MARGIN + c1.x, top, {
        size: 9,
        font: bold,
        color: voided ? DANGER : INK,
        maxWidth: c1.w,
      });
      const servicesLine = job.planSale ? 'Wash plan sold at the shop' : job.services.join(', ') || '-';
      text(job.discount > 0 ? `${servicesLine}  ·  ${money(job.discount)} off` : servicesLine, MARGIN + c1.x, sub, {
        size: 7.5,
        color: MUTED,
        maxWidth: c1.w,
      });

      text(plate(job.registrationNumber), MARGIN + c2.x, top, { size: 8.5, font: bold, color: INK, maxWidth: c2.w });
      text(job.vehicleType || '-', MARGIN + c2.x, sub, { size: 7.5, color: MUTED, maxWidth: c2.w });

      const right = MARGIN + c3.x + c3.w;
      text(money(job.total), right, top, { size: 9.5, font: bold, color: voided ? DANGER : INK, align: 'right' });
      const status = voided
        ? 'Void'
        : job.status === 'paid'
          ? [job.paymentMethod ? (job.paymentMethod === 'upi' ? 'UPI' : job.paymentMethod[0]!.toUpperCase() + job.paymentMethod.slice(1)) : 'Paid', job.paidBy ? job.paidBy.split(/\s+/)[0] : null]
              .filter(Boolean)
              .join(' · ')
          : 'Not paid yet';
      text(status, right, sub, {
        size: 7.5,
        color: voided ? DANGER : job.status === 'paid' ? TEAL_DEEP : AMBER,
        align: 'right',
        maxWidth: c3.w,
      });
      space(LEDGER_H);
    });
  }

  // Closing
  ensure(44);
  space(18);
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.6, color: LINE });
  space(8);
  note('Amounts are in Indian Rupees (Rs), times in India time. This report is confidential: it is for the branch owner and Mana Wash HQ only.');

  // Footers: night band like the header, confidential on every page.
  const totalPages = pages.length;
  const footText = rgb(0.72, 0.77, 0.92);
  pages.forEach((p, i) => {
    p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: FOOTER_H, color: NIGHT });
    p.drawRectangle({ x: 0, y: FOOTER_H, width: PAGE_W, height: 2, color: SKY });
    if (logo) p.drawImage(logo, { x: MARGIN, y: 9, width: 18, height: 18, opacity: 0.85 });
    const lx = logo ? MARGIN + 26 : MARGIN;
    p.drawText('CONFIDENTIAL', { x: lx, y: 20, size: 7, font: bold, color: rgb(0.99, 0.8, 0.45) });
    const scope = fit(`For ${shopName} only. Not to be shared outside the business.`, 7, regular, CONTENT_W - 160);
    p.drawText(scope, { x: lx, y: 10, size: 7, font: regular, color: footText });
    const right = `Page ${i + 1} of ${totalPages}`;
    p.drawText(right, { x: PAGE_W - MARGIN - bold.widthOfTextAtSize(right, 7.5), y: 20, size: 7.5, font: bold, color: WHITE });
    const ver = `Mana Wash Manager v${APP_VERSION}`;
    p.drawText(ver, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(ver, 6.5), y: 10, size: 6.5, font: regular, color: footText });
  });

  return doc.save();
}

const fileSafe = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

export function reportFilename(data: ReportExportPayload, shopName?: string): string {
  const shop = fileSafe(shopName ?? SHOP.name) || 'Shop';
  return `${shop}-Report-${fileSafe(data.label) || data.from}-${data.to}.pdf`;
}
