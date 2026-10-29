import { createPlatformDb, createShopDb, jobRepo, settingsRepo } from '@mana/db';
import { hoursSummary, parseOffDays } from '@mana/domain';
import type { Env } from '../types';
import { buildBillPdf, type BillInput, type BillPhoto } from './billPdf';

/**
 * A paid wash's bill, ready to draw: its services and totals, the branch, and the before and after
 * photos from the photos bucket. Used for the PDF on WhatsApp and the one owners open in the app.
 */

/** "KVR-01-261105-7F3A": the branch, the day (India time) and the wash. */
export function billNumber(shopCode: string, at: Date, jobId: string): string {
  const d = new Date(at.getTime() + (5 * 60 + 30) * 60_000);
  const day = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const tail = jobId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();
  return `${shopCode}-${day}-${tail}`;
}

/** A PDF can only hold so much; the newest photos of each kind, kept small. */
const PHOTOS_PER_KIND = 2;
const PHOTO_MAX_BYTES = 3_000_000;

async function photos(env: Env, shopId: string, jobId: string, kind: 'before' | 'after'): Promise<BillPhoto[]> {
  const rows = await createShopDb(env.DB, shopId).jobPhoto.findMany({
    where: { jobId, kind, deletedAt: null, contentType: { in: ['image/jpeg', 'image/png'] }, sizeBytes: { lte: PHOTO_MAX_BYTES } },
    orderBy: { createdAt: 'asc' },
    take: PHOTOS_PER_KIND,
    select: { r2Key: true, contentType: true },
  });
  const out: BillPhoto[] = [];
  for (const r of rows) {
    const object = await env.PHOTOS.get(r.r2Key);
    if (object) out.push({ bytes: await readAll(object.body as ReadableStream<Uint8Array>), contentType: r.contentType });
  }
  return out;
}

/** All of a stream's bytes. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The bill of a paid wash, or null when it isn't paid (or isn't there). */
export async function loadBill(env: Env, shopId: string, jobId: string): Promise<BillInput | null> {
  const db = createShopDb(env.DB, shopId);
  const job = await jobRepo.findBoardRow(db, jobId);
  if (!job || job.status !== 'paid') return null;
  const pdb = createPlatformDb(env.DB);
  const [shop, settings, before, after] = await Promise.all([
    pdb.shop.findUnique({
      where: { id: shopId },
      select: { name: true, code: true, city: true, address: true, contactPhone: true, opensAt: true, closesAt: true, weeklyOff: true, weeklyOffDays: true, businessId: true },
    }),
    settingsRepo.listPublic(db),
    photos(env, shopId, jobId, 'before'),
    photos(env, shopId, jobId, 'after'),
  ]);
  if (!shop) return null;
  const business = shop.businessId ? await pdb.business.findUnique({ where: { id: shop.businessId }, select: { name: true } }) : null;
  const paidAt = job.completedAt ? new Date(job.completedAt) : new Date();
  const free = new Set(job.freeServiceIds);
  const model = [job.vehicle.make, job.vehicle.model].filter(Boolean).join(' ');
  const walkIn = job.vehicle.registrationNumber.startsWith('WALK-IN');
  return {
    businessName: business?.name ?? shop.name,
    branch: {
      name: shop.name,
      code: shop.code,
      city: shop.city,
      address: shop.address,
      phone: shop.contactPhone,
      hours: hoursSummary({
        opensAt: shop.opensAt,
        closesAt: shop.closesAt,
        weeklyOff: shop.weeklyOff,
        weeklyOffDays: shop.weeklyOffDays ? parseOffDays(shop.weeklyOffDays) : shop.weeklyOff != null ? [shop.weeklyOff] : [],
      }),
    },
    number: billNumber(shop.code, paidAt, job.id),
    at: paidAt,
    paymentMethod: job.paymentMethod,
    customer: { name: job.customer.name, phone: job.customer.phone },
    vehicle: { label: model || job.vehicle.vehicleType.name, registration: walkIn ? null : job.vehicle.registrationNumber },
    lines: job.jobServices.map((l) => ({
      name: l.service.name,
      quantity: l.quantity,
      unitPrice: l.priceAtTime,
      amount: l.priceAtTime * l.quantity,
      note: free.has(l.serviceId) && l.priceAtTime === 0 ? 'Free: loyalty reward' : job.planServiceId === l.serviceId ? 'Covered by your wash plan' : null,
    })),
    subtotal: job.subtotal,
    discount: job.discount,
    discountReason: job.discountReason,
    total: job.total,
    photos: { before, after },
    reviewUrl: settings.google_review_url ?? null,
  };
}

/** The bill as a PDF, with its file name, or null when the wash isn't paid. */
export async function billPdf(env: Env, shopId: string, jobId: string): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const bill = await loadBill(env, shopId, jobId);
  if (!bill) return null;
  return { bytes: await buildBillPdf(bill), fileName: `${bill.businessName.replace(/[^A-Za-z0-9]+/g, '-')}-Bill-${bill.number}.pdf` };
}
