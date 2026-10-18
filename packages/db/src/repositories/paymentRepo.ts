import { financialYear, gstBreakup, istDay, parseWashDays, unitLabel } from '@mana/domain';
import { createPlatformDb, createShopDb, type D1Database, type DbClient } from '../client';
import { newId } from '../ids';
import { isUniqueClash } from '../retryOnClash';
import { runStatements, SQL_NOW, type SqlStatement } from '../sql';
import { payableFirstWash, placeFail, shopContext } from './placeShared';

/**
 * Customer payments for plans and place washes: Razorpay only (or the local test checkout). One
 * row per attempt to pay one part; money rows are never edited, a refund adds to `refunded`.
 * Receipt numbers (MW-<branch code>/<FY>/<n>, e.g. MW-KVR-001/26-27/00001) are taken in the same batch that marks the payment
 * paid, so they never skip or repeat.
 */

export type PaymentProvider = 'razorpay' | 'test';
export type PaymentStatus = 'created' | 'paid' | 'failed' | 'expired';

const paymentSelect = {
  id: true,
  shopId: true,
  customerId: true,
  orderId: true,
  installmentId: true,
  amount: true,
  status: true,
  provider: true,
  linkId: true,
  linkUrl: true,
  providerPaymentId: true,
  method: true,
  refunded: true,
  receiptNo: true,
  createdBy: true,
  expiresAt: true,
  paidAt: true,
  createdAt: true,
} as const;

export const paymentRepo = {
  /**
   * What paying the next part of an order needs, after checking it can be paid now: the order
   * is live, the member confirmed, and a part is due. `open` is a still-valid link for that part.
   */
  async prepare(d1: D1Database, shopId: string, orderId: string, now: Date) {
    const db = createShopDb(d1, shopId);
    const order = await db.placeOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        title: true,
        status: true,
        customerId: true,
        customer: { select: { name: true, phone: true } },
        member: { select: { status: true, place: { select: { label: true } } } },
        installments: { where: { status: 'due' }, orderBy: { seq: 'asc' }, take: 1, select: { id: true, seq: true, amount: true } },
      },
    });
    if (!order) return placeFail('not_found', 'Order not found.');
    if (order.status !== 'awaiting_payment' && order.status !== 'active') {
      return placeFail('not_allowed', order.status === 'waitlist' ? 'We’ll ask for payment when your wash day is fixed.' : 'Nothing to pay on this order.');
    }
    if (order.member.status !== 'active') return placeFail('not_allowed', 'Our team will confirm your place first. Payment opens after that.');
    const installment = order.installments[0];
    if (!installment || installment.amount <= 0) return placeFail('not_allowed', 'Nothing is due right now.');
    const open = await db.customerPayment.findFirst({
      where: { installmentId: installment.id, status: 'created', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: paymentSelect,
    });
    const { shop, rules } = await shopContext(createPlatformDb(d1), shopId);
    return { order, installment, open, shop, rules };
  },

  async create(
    d1: D1Database,
    row: {
      id: string;
      shopId: string;
      customerId: string;
      orderId: string;
      installmentId: string;
      amount: number;
      provider: PaymentProvider;
      linkId: string | null;
      linkUrl: string | null;
      gstRateBp: number;
      createdBy: 'customer' | 'staff';
      expiresAt: Date;
    },
  ) {
    await runStatements(d1, [
      {
        sql: `INSERT INTO customer_payments (id, shop_id, customer_id, order_id, installment_id, amount, provider, link_id, link_url,
                gst_rate_bp, created_by, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          row.id,
          row.shopId,
          row.customerId,
          row.orderId,
          row.installmentId,
          row.amount,
          row.provider,
          row.linkId,
          row.linkUrl,
          row.gstRateBp,
          row.createdBy,
          row.expiresAt.toISOString(),
        ],
      },
    ]);
  },

  /** Any payment by id (platform client: webhooks and the pay pages). */
  async find(pdb: DbClient, id: string) {
    return pdb.customerPayment.findUnique({ where: { id }, select: paymentSelect });
  },

  async findByLink(pdb: DbClient, linkId: string) {
    return pdb.customerPayment.findUnique({ where: { linkId }, select: paymentSelect });
  },

  /**
   * Marks a payment paid: the receipt number, the part, and the order (active from its first
   * payment) in one batch. If the first wash's payment deadline already passed, the first wash
   * moves to the next wash day. Idempotent: a second call changes nothing.
   */
  async markPaid(
    d1: D1Database,
    paymentId: string,
    data: { providerPaymentId: string | null; method: string | null; now: Date },
  ): Promise<{
    result: 'paid' | 'already' | 'duplicate' | 'missing';
    shopId: string | null;
    orderId: string | null;
    orderStatus: string | null;
  }> {
    const pdb = createPlatformDb(d1);
    const payment = await pdb.customerPayment.findUnique({ where: { id: paymentId }, select: paymentSelect });
    if (!payment) return { result: 'missing', shopId: null, orderId: null, orderStatus: null };
    const { shopId } = payment;
    const db = createShopDb(d1, shopId);
    const order = await db.placeOrder.findUnique({
      where: { id: payment.orderId },
      select: { status: true, firstWashOn: true, perWeek: true, member: { select: { place: { select: { washDays: true } } } } },
    });
    if (payment.status === 'paid') return { result: 'already', shopId, orderId: payment.orderId, orderStatus: order?.status ?? null };
    const { shop, rules } = await shopContext(pdb, shopId);
    const fy = financialYear(istDay(data.now));
    const prefix = `MW-${shop.code}/${fy}/`;
    const firstWashOn = order ? payableFirstWash(order, parseWashDays(order.member.place.washDays), rules, data.now) : null;
    const iso = data.now.toISOString();
    const unpaid = `EXISTS (SELECT 1 FROM customer_payments WHERE id = ? AND status != 'paid')`;
    const statements: SqlStatement[] = [
      { sql: 'INSERT OR IGNORE INTO receipt_series (shop_id, financial_year, last_number) VALUES (?, ?, 0)', params: [shopId, fy] },
      {
        sql: `UPDATE receipt_series SET last_number = last_number + 1 WHERE shop_id = ? AND financial_year = ? AND ${unpaid}`,
        params: [shopId, fy, paymentId],
      },
      {
        sql: `UPDATE customer_payments SET status = 'paid', paid_at = ?, provider_payment_id = ?, method = ?,
                receipt_no = ? || printf('%05d', (SELECT last_number FROM receipt_series WHERE shop_id = ? AND financial_year = ?))
              WHERE id = ? AND status != 'paid'`,
        params: [iso, data.providerPaymentId, data.method, prefix, shopId, fy, paymentId],
      },
      {
        sql: `UPDATE order_installments SET status = 'paid', payment_id = ?, paid_at = ? WHERE shop_id = ? AND id = ? AND status = 'due'`,
        params: [paymentId, iso, shopId, payment.installmentId],
      },
      {
        sql: `UPDATE place_orders SET status = 'active', first_wash_on = ?, updated_at = ${SQL_NOW}
              WHERE shop_id = ? AND id = ? AND status = 'awaiting_payment'`,
        params: [firstWashOn, shopId, payment.orderId],
      },
    ];
    if (firstWashOn && order?.firstWashOn && firstWashOn !== order.firstWashOn && order.status === 'awaiting_payment') {
      const shift = Math.round((Date.parse(firstWashOn) - Date.parse(order.firstWashOn)) / 86_400_000);
      statements.push({
        sql: `UPDATE order_installments SET due_on = date(due_on, ?) WHERE shop_id = ? AND order_id = ? AND status = 'due'`,
        params: [`+${shift} days`, shopId, payment.orderId],
      });
    }
    try {
      await runStatements(d1, statements);
    } catch (e) {
      if (!isUniqueClash(e)) throw e;
      // The part was already paid through another link: this money goes back (the caller refunds it).
      await runStatements(d1, [
        {
          sql: `UPDATE customer_payments SET status = 'failed', provider_payment_id = ?, method = ? WHERE id = ? AND status != 'paid'`,
          params: [data.providerPaymentId, data.method, paymentId],
        },
      ]);
      return { result: 'duplicate', shopId, orderId: payment.orderId, orderStatus: order?.status ?? null };
    }
    const after = await db.placeOrder.findUnique({ where: { id: payment.orderId }, select: { status: true } });
    return { result: 'paid', shopId, orderId: payment.orderId, orderStatus: after?.status ?? null };
  },

  /** An attempt that failed or ran out of time (a new one can be made). */
  async close(d1: D1Database, paymentId: string, status: 'failed' | 'expired') {
    await runStatements(d1, [
      { sql: `UPDATE customer_payments SET status = ? WHERE id = ? AND status = 'created'`, params: [status, paymentId] },
    ]);
  },

  /** Links still open (or just expired) to check with Razorpay, oldest first. */
  async openLinks(pdb: DbClient, limit: number) {
    return pdb.customerPayment.findMany({
      where: { status: 'created' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: paymentSelect,
    });
  },

  async forOrder(db: DbClient, orderId: string) {
    return db.customerPayment.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' }, select: paymentSelect });
  },

  /** A paid payment as a receipt with GST (inclusive prices, split into CGST and SGST). */
  async receipt(d1: D1Database, shopId: string, paymentId: string) {
    const db = createShopDb(d1, shopId);
    const p = await db.customerPayment.findUnique({
      where: { id: paymentId },
      select: {
        ...paymentSelect,
        gstRateBp: true,
        customer: { select: { name: true, phone: true } },
        installment: { select: { seq: true } },
        order: {
          select: {
            id: true,
            title: true,
            kind: true,
            total: true,
            payMode: true,
            memberVehicle: { select: { vehicleType: { select: { name: true } }, vehicle: { select: { registrationNumber: true } } } },
            member: { select: { unitText: true, unit: { select: { block: true, number: true } }, place: { select: { label: true, name: true } } } },
            _count: { select: { installments: true } },
          },
        },
        refunds: { orderBy: { createdAt: 'asc' }, select: { amount: true, status: true, createdAt: true } },
      },
    });
    if (!p || p.status !== 'paid' || !p.receiptNo) return null;
    const pdb = createPlatformDb(d1);
    const [{ shop, rules }, branch] = await Promise.all([
      shopContext(pdb, shopId),
      pdb.shop.findUnique({ where: { id: shopId }, select: { address: true, contactPhone: true } }),
    ]);
    const unit = p.order.member.unit ? unitLabel(p.order.member.unit.block, p.order.member.unit.number) : p.order.member.unitText;
    return {
      id: p.id,
      receiptNo: p.receiptNo,
      paidAt: p.paidAt!.toISOString(),
      amount: p.amount,
      method: p.method,
      gst: gstBreakup(p.amount, p.gstRateBp),
      seller: {
        legalName: rules.legalName ?? shop.name,
        gstin: rules.gstin,
        branch: shop.name,
        city: shop.city,
        address: branch?.address ?? null,
        phone: branch?.contactPhone ?? null,
      },
      customer: { name: p.customer.name, phone: p.customer.phone },
      item: {
        title: p.order.title,
        kind: p.order.kind,
        part: p.order.payMode === 'parts' ? { seq: p.installment.seq, of: p.order._count.installments } : null,
        orderTotal: p.order.total,
        vehicle: p.order.memberVehicle.vehicle?.registrationNumber ?? p.order.memberVehicle.vehicleType.name,
        place: [unit, p.order.member.place.name ?? p.order.member.place.label].filter(Boolean).join(', '),
      },
      refunded: p.refunded,
      refunds: p.refunds.map((r) => ({ amount: r.amount, status: r.status, at: r.createdAt.toISOString() })),
    };
  },

  // ---------- Refunds ----------

  /** Paid payments of an order with money left to refund, newest first. */
  async refundable(db: DbClient, orderId: string) {
    const rows = await db.customerPayment.findMany({
      where: { orderId, status: 'paid' },
      orderBy: { paidAt: 'desc' },
      select: paymentSelect,
    });
    return rows.filter((p) => p.amount > p.refunded);
  },

  /** Records a refund (pending until the provider confirms) and counts it against the payment. */
  async addRefund(d1: D1Database, row: { shopId: string; paymentId: string; orderId: string; amount: number; reason: string | null }) {
    const id = newId();
    await runStatements(d1, [
      {
        sql: `INSERT INTO customer_refunds (id, shop_id, payment_id, order_id, amount, reason)
              SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM customer_payments WHERE id = ? AND amount - refunded >= ?)`,
        params: [id, row.shopId, row.paymentId, row.orderId, row.amount, row.reason, row.paymentId, row.amount],
      },
      {
        sql: `UPDATE customer_payments SET refunded = refunded + ? WHERE id = ? AND EXISTS (SELECT 1 FROM customer_refunds WHERE id = ?)`,
        params: [row.amount, row.paymentId, id],
      },
    ]);
    const created = await createShopDb(d1, row.shopId).customerRefund.findUnique({ where: { id }, select: { id: true } });
    return created ? id : null;
  },

  async settleRefund(d1: D1Database, id: string, data: { status: 'processed' | 'failed'; providerRefundId: string | null }) {
    await runStatements(d1, [
      {
        sql: `UPDATE customer_refunds SET status = ?, provider_refund_id = ?, processed_at = ${SQL_NOW} WHERE id = ? AND status = 'pending'`,
        params: [data.status, data.providerRefundId, id],
      },
    ]);
  },

  /** Refunds still waiting on the provider (a call failed); the nightly job retries them. */
  async pendingRefunds(pdb: DbClient, limit: number) {
    return pdb.customerRefund.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, shopId: true, amount: true, payment: { select: { id: true, provider: true, providerPaymentId: true } } },
    });
  },

  /** Order money, for the team: what was paid, refunded and is still due. */
  async orderMoney(db: DbClient, orderId: string) {
    const payments = await db.customerPayment.findMany({ where: { orderId, status: 'paid' }, select: { amount: true, refunded: true } });
    return {
      paid: payments.reduce((n, p) => n + p.amount, 0),
      refunded: payments.reduce((n, p) => n + p.refunded, 0),
    };
  },

  /** Every refund row of one branch's order (the team's view). */
  async refundsFor(db: DbClient, orderId: string) {
    return db.customerRefund.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, amount: true, status: true, reason: true, createdAt: true, processedAt: true },
    });
  },
};

export type PaymentRow = NonNullable<Awaited<ReturnType<typeof paymentRepo.find>>>;
