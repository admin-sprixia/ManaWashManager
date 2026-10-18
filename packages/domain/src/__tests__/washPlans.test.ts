import { describe, expect, it } from 'vitest';
import {
  formatInr,
  beforeCutoff,
  cancelRefund,
  DEFAULT_WASH_PLAN_RULES as RULES,
  financialYear,
  firstWashDay,
  fixedPlanPrice,
  formatReceiptNumber,
  gstBreakup,
  installmentPlan,
  isUpgradeWash,
  upgradeWashes,
  nextDue,
  orderPhase,
  paidTotal,
  parseWashPlanRules,
  payDeadline,
  renewalDue,
  serializeWashPlanRules,
  washesPerWeek,
  washPlanPrice,
  type InstallmentState,
} from '../washPlans';

describe('rules', () => {
  it('falls back to defaults for anything missing or out of range', () => {
    expect(parseWashPlanRules({})).toEqual(RULES);
    const r = parseWashPlanRules({ partsFirstPct: '200', graceDays: '5', payDeadlineTime: '25:00', refundRule: 'pro_rata', gstin: ' 37abcde1234f1z5 ' });
    expect(r.partsFirstPct).toBe(20);
    expect(r.graceDays).toBe(5);
    expect(r.payDeadlineTime).toBe('20:00');
    expect(r.refundRule).toBe('pro_rata');
    expect(r.gstin).toBe('37ABCDE1234F1Z5');
  });

  it('round-trips through storage', () => {
    const stored = Object.fromEntries(
      serializeWashPlanRules({ partsCount: 6, priceMode: 'hub', gstin: null }).map(([k, v]) => [k.replace('places.', ''), v]),
    );
    expect(parseWashPlanRules(stored)).toMatchObject({ partsCount: 6, priceMode: 'hub', gstin: null });
  });
});

describe('prices', () => {
  it('multiplies the per-wash price and takes off the plan discount, in whole rupees', () => {
    expect(washPlanPrice(58000, 4, 0)).toBe(232000);
    expect(washPlanPrice(58000, 48, 1000)).toBe(2505600);
    expect(washPlanPrice(33333, 12, 500)).toBe(380000);
  });

  it('moves a fixed plan price by the zone, in whole rupees', () => {
    expect(fixedPlanPrice(109900, 0)).toBe(109900);
    expect(fixedPlanPrice(109900, -1000)).toBe(98900);
  });

  it('knows which washes are the upgraded one', () => {
    const shine = { every: 4 };
    expect([1, 2, 3, 4, 5, 8].map((n) => isUpgradeWash(n, shine))).toEqual([false, false, false, true, false, true]);
    expect(isUpgradeWash(4, null)).toBe(false);
    expect(upgradeWashes(13, shine)).toBe(3);
    expect(upgradeWashes(52, shine)).toBe(13);
    expect(upgradeWashes(4, null)).toBe(0);
  });

  it('works out washes per week from the plan', () => {
    expect(washesPerWeek(4, 1)).toBe(1);
    expect(washesPerWeek(12, 3)).toBe(1);
    expect(washesPerWeek(48, 12)).toBe(1);
    expect(washesPerWeek(8, 1)).toBe(2);
    expect(washesPerWeek(1, 1)).toBe(1);
  });
});

describe('paying before the first wash', () => {
  const ist = (s: string) => new Date(`${s}+05:30`);

  it('is due by 8 pm the evening before', () => {
    expect(payDeadline('2026-10-13', RULES).toISOString()).toBe('2026-10-12T14:30:00.000Z');
  });

  it('picks the first wash day the customer still has time to pay for', () => {
    expect(firstWashDay({ washDays: [2], perWeek: 1, now: ist('2026-10-06T10:00:00'), rules: RULES })).toBe('2026-10-13');
    expect(firstWashDay({ washDays: [2], perWeek: 1, now: ist('2026-10-12T21:00:00'), rules: RULES })).toBe('2026-10-20');
    expect(firstWashDay({ washDays: [3], perWeek: 1, now: ist('2026-10-06T10:00:00'), rules: RULES })).toBe('2026-10-07');
    expect(firstWashDay({ washDays: [3], perWeek: 1, now: ist('2026-10-06T20:30:00'), rules: RULES })).toBe('2026-10-14');
  });

  it('starts after another plan when asked', () => {
    expect(firstWashDay({ washDays: [2], perWeek: 1, now: ist('2026-10-06T10:00:00'), rules: RULES, after: '2026-11-03' })).toBe(
      '2026-11-10',
    );
  });

  it('has no first wash at a place without wash days', () => {
    expect(firstWashDay({ washDays: [], perWeek: 1, now: new Date(), rules: RULES })).toBeNull();
  });
});

describe('pay in parts', () => {
  it('pays everything before the first wash in full', () => {
    expect(installmentPlan({ total: 232000, mode: 'full', firstDueOn: '2026-10-12', months: 1, rules: RULES })).toEqual([
      { seq: 1, amount: 232000, dueOn: '2026-10-12' },
    ]);
  });

  it('takes 20% first and spreads four equal parts over the plan', () => {
    const plan = installmentPlan({ total: 2160000, mode: 'parts', firstDueOn: '2026-10-12', months: 12, rules: RULES });
    expect(plan.map((p) => p.amount)).toEqual([432000, 432000, 432000, 432000, 432000]);
    expect(plan[0]!.dueOn).toBe('2026-10-12');
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.dueOn > plan[i - 1]!.dueOn).toBe(true);
    expect(plan[4]!.dueOn < '2027-10-12').toBe(true);
  });

  it('always adds up to the plan price', () => {
    const plan = installmentPlan({ total: 1000050, mode: 'parts', firstDueOn: '2026-10-12', months: 3, rules: RULES });
    expect(plan.reduce((s, p) => s + p.amount, 0)).toBe(1000050);
  });
});

describe('where an order stands', () => {
  const parts = (statuses: InstallmentState['status'][]): InstallmentState[] =>
    statuses.map((status, i) => ({ seq: i + 1, amount: 1000, dueOn: ['2026-10-12', '2026-12-01', '2027-02-01'][i]!, status }));
  const phase = (installments: InstallmentState[], today: string, pauses = [] as { fromOn: string; toOn: string }[]) =>
    orderPhase({ status: 'active', installments, pauses, today, graceDays: 3 });

  it('keeps washing while parts are paid ahead', () => {
    expect(phase(parts(['paid', 'due', 'due']), '2026-11-20')).toBe('active');
  });

  it('shows a part due, then pauses after the grace days', () => {
    expect(phase(parts(['paid', 'due', 'due']), '2026-12-01')).toBe('payment_due');
    expect(phase(parts(['paid', 'due', 'due']), '2026-12-04')).toBe('payment_due');
    expect(phase(parts(['paid', 'due', 'due']), '2026-12-05')).toBe('paused_unpaid');
  });

  it('knows a holiday pause', () => {
    expect(phase(parts(['paid', 'paid', 'paid']), '2026-11-02', [{ fromOn: '2026-11-01', toOn: '2026-11-10' }])).toBe('on_pause');
  });

  it('passes other statuses through', () => {
    expect(orderPhase({ status: 'awaiting_payment', installments: [], pauses: [], today: '2026-10-06', graceDays: 3 })).toBe(
      'awaiting_payment',
    );
  });

  it('finds the next part and what is paid', () => {
    const list = parts(['paid', 'due', 'due']);
    expect(nextDue(list)?.seq).toBe(2);
    expect(paidTotal(list)).toBe(1000);
  });

  it('offers renewal a week before the last wash', () => {
    expect(renewalDue('2026-10-13', '2026-10-06', RULES)).toBe(true);
    expect(renewalDue('2026-10-14', '2026-10-06', RULES)).toBe(false);
    expect(renewalDue(null, '2026-10-06', RULES)).toBe(false);
  });
});

describe('skips', () => {
  it('are allowed until 8 pm the evening before', () => {
    expect(beforeCutoff('2026-10-13', new Date('2026-10-12T14:29:00Z'), RULES)).toBe(true);
    expect(beforeCutoff('2026-10-13', new Date('2026-10-12T14:30:00Z'), RULES)).toBe(false);
  });
});

describe('cancelling', () => {
  it('refunds everything before the first wash', () => {
    expect(cancelRefund({ paid: 232000, total: 232000, washesTotal: 4, washesUsed: 0, singlePrice: 58000, rule: 'single_price' })).toEqual({
      charged: 0,
      refund: 232000,
    });
  });

  it('charges washes given at the one-time price', () => {
    expect(
      cancelRefund({ paid: 2505600, total: 2505600, washesTotal: 48, washesUsed: 10, singlePrice: 58000, rule: 'single_price' }),
    ).toEqual({ charged: 580000, refund: 1925600 });
  });

  it('never charges more than was paid', () => {
    expect(cancelRefund({ paid: 432000, total: 2160000, washesTotal: 48, washesUsed: 10, singlePrice: 58000, rule: 'single_price' })).toEqual({
      charged: 432000,
      refund: 0,
    });
  });

  it('can charge the plan’s own share instead', () => {
    expect(cancelRefund({ paid: 2400000, total: 2400000, washesTotal: 48, washesUsed: 12, singlePrice: 58000, rule: 'pro_rata' })).toEqual({
      charged: 600000,
      refund: 1800000,
    });
  });
});

describe('receipts', () => {
  it('splits GST included in the price into CGST and SGST', () => {
    expect(gstBreakup(118000, 1800)).toEqual({ taxable: 100000, cgst: 9000, sgst: 9000, rateBp: 1800 });
    const odd = gstBreakup(58001, 1800);
    expect(odd.taxable + odd.cgst + odd.sgst).toBe(58001);
    expect(gstBreakup(50000, 0)).toEqual({ taxable: 50000, cgst: 0, sgst: 0, rateBp: 0 });
  });

  it('numbers receipts by financial year', () => {
    expect(financialYear('2026-10-06')).toBe('26-27');
    expect(financialYear('2027-03-31')).toBe('26-27');
    expect(financialYear('2027-04-01')).toBe('27-28');
    expect(financialYear('2099-06-01')).toBe('99-00');
    expect(formatReceiptNumber('MW-KVR-01', '26-27', 42)).toBe('MW-KVR-01/26-27/00042');
  });
});

describe('rupees', () => {
  it('groups digits the Indian way', () => {
    expect(formatInr(2_160_000)).toBe('₹21,600');
    expect(formatInr(12_500_050)).toBe('₹1,25,000.50');
    expect(formatInr(9_900)).toBe('₹99');
    expect(formatInr(-50)).toBe('-₹0.50');
  });
});
