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
const RULE = rgb(0.82, 0.85, 0.91);
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

/**
 * Branded A4 business report — calm spacing, clear hierarchy, English only.
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
  const avg = stats.carsWashed > 0 ? Math.round((stats.revenue - planSales) / stats.carsWashed) : 0;

  let logo: PDFImage | null = null;
  const logoBytes = await loadLogoBytes();
  if (logoBytes) {
    try {
      logo = await doc.embedPng(logoBytes);
    } catch {
      logo = null;
    }
  }

  const pages: PDFPage[] = [];
  let page = doc.addPage([PAGE_W, PAGE_H]);
  pages.push(page);
  let y = PAGE_H - MARGIN;

  const drawText = (
    value: string,
    opts: {
      x?: number;
      y?: number;
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      maxWidth?: number;
    } = {},
  ) => {
    let s = pdfSafe(value);
    const font = opts.font ?? regular;
    const size = opts.size ?? 9.5;
    if (opts.maxWidth) {
      while (s.length > 3 && font.widthOfTextAtSize(s, size) > opts.maxWidth) {
        s = `${s.slice(0, -4)}...`;
      }
    }
    page.drawText(s, {
      x: opts.x ?? MARGIN,
      y: opts.y ?? y,
      size,
      font,
      color: opts.color ?? INK,
    });
  };

  const drawRight = (
    value: string,
    opts: {
      y?: number;
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      right?: number;
    } = {},
  ) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 9.5;
    const s = pdfSafe(value);
    page.drawText(s, {
      x: (opts.right ?? PAGE_W - MARGIN) - font.widthOfTextAtSize(s, size),
      y: opts.y ?? y,
      size,
      font,
      color: opts.color ?? INK,
    });
  };

  const newPage = (continued = true) => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    if (continued) {
      page.drawRectangle({ x: 0, y: PAGE_H - TOP_CONTINUED, width: PAGE_W, height: TOP_CONTINUED, color: NIGHT });
      drawText(shopName, { x: MARGIN, y: PAGE_H - 27, size: 9, font: bold, color: WHITE });
      drawRight('Business report · continued', {
        y: PAGE_H - 26,
        size: 8,
        color: rgb(0.72, 0.78, 0.92),
      });
      y = PAGE_H - TOP_CONTINUED - 28;
    } else {
      y = PAGE_H - MARGIN;
    }
  };

  const ensure = (need: number) => {
    if (y - need >= MARGIN + FOOTER_H + 10) return;
    newPage(true);
  };

  const gap = (n: number) => {
    y -= n;
  };

  const hairline = () => {
    ensure(10);
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.6,
      color: LINE,
    });
    gap(14);
  };

  const section = (title: string) => {
    ensure(36);
    gap(6);
    drawText(title.toUpperCase(), {
      size: 8,
      font: bold,
      color: INDIGO_DEEP,
    });
    gap(4);
    page.drawRectangle({ x: MARGIN, y: y - 1, width: 28, height: 2, color: INDIGO });
    gap(16);
  };

  /** Label / value row with calm alternating wash. */
  const row = (label: string, value: string, i: number, opts?: { valueColor?: ReturnType<typeof rgb> }) => {
    ensure(18);
    const h = 17;
    if (i % 2 === 0) {
      page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: h, color: SURFACE });
    }
    drawText(label, { size: 9, color: MUTED, maxWidth: CONTENT_W * 0.62 });
    drawRight(value, { size: 9.5, font: bold, color: opts?.valueColor ?? INK });
    gap(17);
  };

  const twoCol = (left: [string, string][], right: [string, string][]) => {
    const n = Math.max(left.length, right.length);
    const colW = (CONTENT_W - 16) / 2;
    for (let i = 0; i < n; i++) {
      ensure(18);
      const h = 17;
      if (i % 2 === 0) {
        page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: h, color: SURFACE });
      }
      const L = left[i];
      const R = right[i];
      if (L) {
        drawText(L[0], { size: 9, color: MUTED, maxWidth: colW * 0.58 });
        const vw = bold.widthOfTextAtSize(pdfSafe(L[1]), 9.5);
        page.drawText(pdfSafe(L[1]), {
          x: MARGIN + colW - vw,
          y,
          size: 9.5,
          font: bold,
          color: INK,
        });
      }
      if (R) {
        drawText(R[0], { x: MARGIN + colW + 16, size: 9, color: MUTED, maxWidth: colW * 0.58 });
        drawRight(R[1], { size: 9.5, font: bold });
      }
      gap(17);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // COVER
  // ═══════════════════════════════════════════════════════════════════════
  const headerH = 118;
  page.drawRectangle({ x: 0, y: PAGE_H - headerH, width: PAGE_W, height: headerH, color: NIGHT });
  page.drawRectangle({ x: 0, y: PAGE_H - headerH, width: PAGE_W, height: 3, color: SKY });

  const mark = 48;
  if (logo) {
    page.drawImage(logo, {
      x: MARGIN,
      y: PAGE_H - 28 - mark,
      width: mark,
      height: mark,
    });
  }

  const tx = MARGIN + mark + 14;
  drawText('MANA WASH', {
    x: tx,
    y: PAGE_H - 28,
    size: 8,
    font: bold,
    color: rgb(0.68, 0.74, 0.92),
  });
  drawText(shopName, { x: tx, y: PAGE_H - 48, size: 18, font: bold, color: WHITE, maxWidth: CONTENT_W - mark - 20 });

  const metaBits = [apiShop?.businessName?.trim(), shopCity, shopCode ? `Branch ${shopCode}` : null]
    .filter(Boolean)
    .join('  ·  ');
  if (metaBits) {
    drawText(metaBits, {
      x: tx,
      y: PAGE_H - 66,
      size: 9.5,
      color: rgb(0.78, 0.82, 0.94),
      maxWidth: CONTENT_W - mark - 20,
    });
  }
  drawText('Business report', {
    x: tx,
    y: PAGE_H - 86,
    size: 11,
    font: bold,
    color: rgb(0.55, 0.88, 0.82),
  });
  drawText(`v${APP_VERSION}`, {
    x: tx,
    y: PAGE_H - 102,
    size: 8,
    color: rgb(0.55, 0.6, 0.78),
  });

  y = PAGE_H - headerH - 22;

  // Contact strip (one calm block)
  const contactParts: string[] = [];
  if (apiShop?.address?.trim()) contactParts.push(apiShop.address.trim());
  if (apiShop?.phone?.trim()) contactParts.push(`+91 ${formatPhone(apiShop.phone)}`);
  if (gst?.legalName?.trim()) contactParts.push(gst.legalName.trim());
  if (gst?.gstin?.trim()) contactParts.push(`GSTIN ${gst.gstin.trim()}`);
  if (apiShop?.owners?.length) {
    contactParts.push(
      `Owner${apiShop.owners.length > 1 ? 's' : ''}: ${apiShop.owners.map((o) => o.name).join(', ')}`,
    );
  }
  if (contactParts.length) {
    ensure(28);
    drawText(contactParts.join('   ·   '), {
      size: 8,
      color: MUTED,
      maxWidth: CONTENT_W,
    });
    gap(18);
  }

  // Period card
  ensure(54);
  const periodH = generatedBy?.name ? 50 : 38;
  page.drawRectangle({
    x: MARGIN,
    y: y - periodH + 12,
    width: CONTENT_W,
    height: periodH,
    color: WHITE,
    borderColor: LINE,
    borderWidth: 0.8,
  });
  page.drawRectangle({
    x: MARGIN,
    y: y - periodH + 12,
    width: 3,
    height: periodH,
    color: INDIGO,
  });
  drawText(data.label, { x: MARGIN + 14, size: 11, font: bold });
  drawRight(`${prettyDay(data.from)}  ->  ${prettyDay(data.to)}  IST`, {
    size: 8.5,
    color: MUTED,
    right: PAGE_W - MARGIN - 12,
  });
  gap(15);
  drawText(`Generated ${formatWhen(data.generatedAt)}`, {
    x: MARGIN + 14,
    size: 8,
    color: FAINT,
  });
  if (generatedBy?.name) {
    gap(12);
    const by = [
      generatedBy.name.trim(),
      roleLabel(generatedBy.role),
      generatedBy.phone ? `+91 ${formatPhone(generatedBy.phone)}` : null,
    ]
      .filter(Boolean)
      .join('  ·  ');
    drawText(`Generated by  ${by}`, {
      x: MARGIN + 14,
      size: 8.5,
      font: bold,
      color: INDIGO_DEEP,
      maxWidth: CONTENT_W - 28,
    });
  }
  gap(periodH - (generatedBy?.name ? 27 : 15) + 20);

  // KPI strip — four equal tiles
  const kpis: { label: string; value: string; accent: ReturnType<typeof rgb> }[] = [
    { label: 'Revenue', value: money(stats.revenue), accent: INDIGO },
    { label: 'Expenses', value: money(stats.expenses), accent: AMBER },
    { label: 'Net', value: money(stats.net), accent: stats.net < 0 ? DANGER : TEAL },
    { label: 'Washes', value: String(stats.carsWashed + (stats.communityWashes ?? 0)), accent: WATER },
  ];
  const kpiGap = 10;
  const kpiW = (CONTENT_W - kpiGap * 3) / 4;
  ensure(62);
  kpis.forEach((k, i) => {
    const x = MARGIN + i * (kpiW + kpiGap);
    page.drawRectangle({
      x,
      y: y - 46,
      width: kpiW,
      height: 54,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.8,
    });
    page.drawRectangle({ x, y: y - 46 + 51, width: kpiW, height: 2.5, color: k.accent });
    page.drawText(pdfSafe(k.label.toUpperCase()), {
      x: x + 10,
      y: y - 10,
      size: 7,
      font: bold,
      color: FAINT,
    });
    const size = bold.widthOfTextAtSize(pdfSafe(k.value), 13) > kpiW - 18 ? 10 : 13;
    page.drawText(pdfSafe(k.value), {
      x: x + 10,
      y: y - 30,
      size,
      font: bold,
      color: INK,
    });
  });
  gap(68);

  // ── Summary ──────────────────────────────────────────────────────────
  section('Summary');
  const totalCustomers = stats.newCustomers + stats.repeatCustomers;
  const repeatPct = totalCustomers > 0 ? Math.round((stats.repeatCustomers / totalCustomers) * 100) : 0;
  const summaryLeft: [string, string][] = [
    ['Wash revenue', money(stats.revenue - planSales)],
    ...(planSales
      ? ([[`Plans sold at the shop (${stats.shopPlansSold ?? 0})`, money(planSales)]] as [string, string][])
      : []),
    ...(stats.planIncome
      ? ([[`Community plans (${stats.planPayments ?? 0})`, money(stats.planIncome)]] as [string, string][])
      : []),
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
    ['In shop now', String(stats.pendingNow)],
    ['New customers', String(stats.newCustomers)],
    [
      'Repeat customers',
      totalCustomers > 0 ? `${stats.repeatCustomers} (${repeatPct}%)` : String(stats.repeatCustomers),
    ],
    ['Cancelled', String(stats.voided)],
  ];
  twoCol(summaryLeft, summaryRight);
  gap(8);

  // ── vs previous ──────────────────────────────────────────────────────
  if (previous) {
    section('Compared with previous period');
    drawText('Equal-length window ending when this period began', { size: 8, color: FAINT });
    gap(12);
    const cmp: [string, number, number, boolean][] = [
      ['Revenue', stats.revenue, previous.revenue, true],
      ['Expenses', stats.expenses, previous.expenses, true],
      ['Net', stats.net, previous.net, true],
      ['Washes', stats.carsWashed, previous.carsWashed, false],
    ];
    cmp.forEach(([label, cur, prev, isMoney], i) => {
      const delta = deltaPct(cur, prev);
      const up = delta.startsWith('+');
      const down = delta.startsWith('-');
      row(
        `${label}  (${delta})`,
        isMoney ? `${money(cur)}   vs   ${money(prev)}` : `${cur}   vs   ${prev}`,
        i,
        { valueColor: up ? TEAL_DEEP : down ? DANGER : INK },
      );
    });
    gap(8);
  }

  // ── Payments ─────────────────────────────────────────────────────────
  section('Payment split');
  const pays: [string, number, ReturnType<typeof rgb>][] = [
    ['Cash', stats.cash, TEAL],
    ['UPI', stats.upi, WATER],
    ['Other', stats.other, MUTED],
  ];
  for (const [label, amount, color] of pays) {
    if (label === 'Other' && amount === 0) continue;
    ensure(28);
    drawText(label, { size: 9.5, font: bold, color });
    const pct = stats.revenue > 0 ? Math.round((amount / stats.revenue) * 100) : 0;
    drawRight(`${money(amount)}   ${pct}%`, { size: 9.5, font: bold });
    gap(10);
    page.drawRectangle({ x: MARGIN, y: y - 1, width: CONTENT_W, height: 5, color: SURFACE });
    const fill = stats.revenue > 0 ? (amount / stats.revenue) * CONTENT_W : 0;
    if (fill > 0) {
      page.drawRectangle({
        x: MARGIN,
        y: y - 1,
        width: Math.max(2.5, fill),
        height: 5,
        color,
      });
    }
    gap(16);
  }
  gap(4);

  // ── GST ──────────────────────────────────────────────────────────────
  if (gst && gst.rateBp > 0) {
    section('GST');
    const rate = (gst.rateBp / 100).toFixed(gst.rateBp % 100 === 0 ? 0 : 1);
    const gstRows: [string, string][] = [
      ['Rate', `${rate}%`],
      ...(gst.legalName ? ([[`Legal name`, gst.legalName]] as [string, string][]) : []),
      ...(gst.gstin ? ([[`GSTIN`, gst.gstin]] as [string, string][]) : []),
      ['Taxable value', money(gst.taxable)],
      ['CGST', money(gst.cgst)],
      ['SGST', money(gst.sgst)],
      ['Total (incl. GST)', money(stats.revenue + (stats.planIncome ?? 0))],
    ];
    gstRows.forEach(([l, v], i) => row(l, v, i));
    gap(8);
  }

  // ── Expenses by category ─────────────────────────────────────────────
  if (expensesByCategory.length) {
    section('Expenses by category');
    expensesByCategory.forEach((e, i) => {
      row(`${e.label}  ·  ${e.count}`, money(e.amount), i);
    });
    gap(8);
  }

  // ── Insights ─────────────────────────────────────────────────────────
  if (insights.liveCount > 0) {
    section('Insights');
    if (insights.busiestDay) {
      row(
        'Busiest day',
        `${insights.busiestDay.label}  ·  ${insights.busiestDay.n} wash${
          insights.busiestDay.n === 1 ? '' : 'es'
        }  ·  ${money(insights.busiestDay.revenue)}`,
        0,
      );
    }
    if (insights.topServices.length) {
      gap(6);
      drawText('Top services', { size: 8, font: bold, color: FAINT });
      gap(10);
      insights.topServices.forEach((s, i) => {
        row(s.name, `${s.n}`, i);
      });
    }
    if (insights.topVehicles.length) {
      gap(6);
      drawText('Vehicle mix', { size: 8, font: bold, color: FAINT });
      gap(10);
      insights.topVehicles.forEach((s, i) => {
        const pct = Math.round((s.n / insights.liveCount) * 100);
        row(s.name, `${s.n}  (${pct}%)`, i);
      });
    }
    if (insights.topCollectors.length) {
      gap(6);
      drawText('Collections by team', { size: 8, font: bold, color: FAINT });
      gap(10);
      insights.topCollectors.forEach((s, i) => {
        row(s.name, `${money(s.revenue)}  ·  ${s.n}`, i);
      });
    }
    gap(8);
  }

  // ── Day by day ───────────────────────────────────────────────────────
  if (insights.days.length > 1) {
    section('Day by day');
    insights.days.forEach((d, i) => {
      row(d.label, `${d.n} wash${d.n === 1 ? '' : 'es'}  ·  ${money(d.revenue)}`, i);
    });
    gap(8);
  }

  // ── Peak hours ───────────────────────────────────────────────────────
  if (insights.peakHours.length) {
    section('Peak hours');
    insights.peakHours.forEach((h, i) => {
      row(hourLabel(h.hour), `${h.n} visits  ·  ${money(h.revenue)}`, i);
    });
    gap(8);
  }

  // ── Top customers ────────────────────────────────────────────────────
  if (insights.topCustomers.length) {
    section('Top customers');
    insights.topCustomers.forEach((c, i) => {
      row(
        `${c.name}${c.phone ? `  ·  ${c.phone}` : ''}`,
        `${money(c.revenue)}  ·  ${c.n}`,
        i,
      );
    });
    gap(8);
  }

  // ── Staff ────────────────────────────────────────────────────────────
  if (staff.length) {
    section('Staff & commission');
    // Compact header
    ensure(16);
    drawText('Name', { size: 7.5, font: bold, color: FAINT });
    drawText('Washes', { x: MARGIN + 168, size: 7.5, font: bold, color: FAINT });
    drawText('Commission', { x: MARGIN + 230, size: 7.5, font: bold, color: FAINT });
    drawText('Collected', { x: MARGIN + 320, size: 7.5, font: bold, color: FAINT });
    gap(8);
    hairline();
    for (let i = 0; i < staff.length; i++) {
      const s = staff[i]!;
      ensure(18);
      if (i % 2 === 0) {
        page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: 17, color: SURFACE });
      }
      drawText(`${s.name}`, {
        size: 9,
        font: bold,
        maxWidth: 150,
      });
      drawText(String(s.washesDone + s.communityWashes), { x: MARGIN + 168, size: 9, color: MUTED });
      drawText(s.commission > 0 ? money(s.commission) : '-', { x: MARGIN + 230, size: 9, color: MUTED });
      drawRight(money(s.collected), { size: 9, font: bold, color: TEAL_DEEP });
      gap(17);
    }
    gap(8);
  }

  // ── Inventory ────────────────────────────────────────────────────────
  if (stock.length || data.stock) {
    section('Inventory');
    if (!stock.length) {
      drawText('No stock items yet.', { size: 9, color: MUTED });
      gap(14);
    } else {
      const low = stock.filter((s) => s.low);
      const ok = stock.filter((s) => !s.low);
      if (low.length) {
        drawText('Needs attention', { size: 8, font: bold, color: DANGER });
        gap(10);
        low.forEach((s, i) => {
          row(
            s.name,
            `${s.balance} ${s.unit}${s.lowAt != null ? `  (low at ${s.lowAt})` : ''}`,
            i,
            { valueColor: DANGER },
          );
        });
        gap(6);
      } else {
        drawText('All items above low mark.', { size: 9, color: MUTED });
        gap(12);
      }
      const showOk = ok.slice(0, 10);
      if (showOk.length) {
        drawText(ok.length > 10 ? `On hand (showing ${showOk.length} of ${ok.length})` : 'On hand', {
          size: 8,
          font: bold,
          color: FAINT,
        });
        gap(10);
        showOk.forEach((s, i) => row(s.name, `${s.balance} ${s.unit}`, i));
      }
      gap(8);
    }
  }

  // ── Rewards ──────────────────────────────────────────────────────────
  if (
    rewards &&
    (rewards.freeWashes > 0 || rewards.giftsGiven > 0 || rewards.giftsOwedNow > 0 || rewards.freeValue > 0)
  ) {
    section('Rewards');
    row('Free washes used', String(rewards.freeWashes), 0);
    row('Value given free', money(rewards.freeValue), 1);
    row('Gifts handed over', String(rewards.giftsGiven), 2);
    row('Gifts owed now', String(rewards.giftsOwedNow), 3);
    if (rewards.gifts.length) {
      gap(4);
      drawText(
        rewards.gifts
          .map((g) => (g.unit === 'pcs' ? `${g.name} x ${g.quantity}` : `${g.name} ${g.label}`))
          .join('   ·   '),
        { size: 8, color: MUTED, maxWidth: CONTENT_W },
      );
      gap(12);
    }
    drawText('Free washes are already counted inside Discounts.', { size: 8, color: FAINT });
    gap(14);
  }

  // ── Job ledger (compact table) ───────────────────────────────────────
  section('Job ledger');
  drawText(`${data.jobs.length} job${data.jobs.length === 1 ? '' : 's'} in this period`, {
    size: 8.5,
    color: MUTED,
  });
  gap(14);

  if (data.jobs.length === 0) {
    ensure(24);
    drawText('No jobs in this period.', { size: 9.5, color: MUTED });
    gap(20);
  } else {
    // Column headers
    ensure(16);
    drawText('When', { size: 7.5, font: bold, color: FAINT });
    drawText('Customer', { x: MARGIN + 108, size: 7.5, font: bold, color: FAINT });
    drawText('Vehicle', { x: MARGIN + 268, size: 7.5, font: bold, color: FAINT });
    drawRight('Amount', { size: 7.5, font: bold, color: FAINT });
    gap(8);
    hairline();

    for (const job of data.jobs) {
      const voided = /void|cancel/i.test(job.status);
      const when = formatWhen(job.createdAt);
      const name = job.customerName?.trim() || job.customerPhone;
      const reg = job.registrationNumber.startsWith('WALK-IN') ? 'Walk-in' : job.registrationNumber;
      const pay = job.paymentMethod ? job.paymentMethod.toUpperCase() : 'UNPAID';
      const line2 =
        [
          job.services.join(', ') || null,
          job.createdBy ? `Opened ${job.createdBy}` : null,
          job.paidBy ? `Paid ${job.paidBy}` : null,
          job.discount > 0 ? `Disc ${money(job.discount)}` : null,
        ]
          .filter(Boolean)
          .join('  ·  ') || null;

      const block = line2 ? 28 : 16;
      ensure(block + 6);

      drawText(when, {
        size: 7.5,
        color: FAINT,
        maxWidth: 100,
      });
      drawText(name, {
        x: MARGIN + 108,
        size: 9,
        font: bold,
        color: voided ? DANGER : INK,
        maxWidth: 150,
      });
      drawText(reg, {
        x: MARGIN + 268,
        size: 8,
        color: MUTED,
        maxWidth: 110,
      });
      drawRight(`${money(job.total)}  ${pay}`, {
        size: 8.5,
        font: bold,
        color: voided ? DANGER : INK,
      });
      gap(11);
      if (line2) {
        drawText(line2, {
          x: MARGIN + 108,
          size: 7.5,
          color: FAINT,
          maxWidth: CONTENT_W - 120,
        });
        gap(12);
      } else {
        gap(5);
      }
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_W - MARGIN, y },
        thickness: 0.4,
        color: LINE,
      });
      gap(8);
    }
  }

  // Closing
  ensure(40);
  gap(6);
  hairline();
  drawText('Figures are in Indian Rupees (IST). Confidential to this shop.', {
    size: 8,
    color: FAINT,
  });
  gap(12);
  drawText('Mana Wash Manager', { size: 8.5, font: bold, color: INDIGO_DEEP });

  // Footers
  const totalPages = pages.length;
  const byLine = generatedBy?.name
    ? `Generated by ${generatedBy.name}${roleLabel(generatedBy.role) ? ` (${roleLabel(generatedBy.role)})` : ''}`
    : null;
  pages.forEach((p, i) => {
    p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: FOOTER_H, color: SURFACE });
    p.drawLine({
      start: { x: MARGIN, y: FOOTER_H },
      end: { x: PAGE_W - MARGIN, y: FOOTER_H },
      thickness: 0.5,
      color: RULE,
    });
    const left = byLine ? `${shopName}  ·  ${byLine}` : `${shopName}  ·  confidential`;
    p.drawText(pdfSafe(left), {
      x: MARGIN,
      y: 14,
      size: 7,
      font: regular,
      color: FAINT,
    });
    const right = `Page ${i + 1} of ${totalPages}`;
    p.drawText(pdfSafe(right), {
      x: PAGE_W - MARGIN - regular.widthOfTextAtSize(right, 7),
      y: 14,
      size: 7,
      font: regular,
      color: FAINT,
    });
  });

  return doc.save();
}

const fileSafe = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

export function reportFilename(data: ReportExportPayload, shopName?: string): string {
  const shop = fileSafe(shopName ?? SHOP.name) || 'Shop';
  return `${shop}-Report-${fileSafe(data.label) || data.from}-${data.to}.pdf`;
}
