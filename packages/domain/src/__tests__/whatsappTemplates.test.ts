import { describe, expect, it } from 'vitest';
import { followUpMessage, WA_TEMPLATES, washMessageDate, washTemplateMessage, type WashMessageInput } from '../index';

const wash: WashMessageInput = {
  customerName: 'Ravi Kumar',
  vehicle: 'Maruti Suzuki Swift',
  registrationNumber: 'AP39AB1234',
  place: 'Sri Mana Wash, Kovur',
  services: [
    { name: 'Basic Wash', quantity: 1 },
    { name: 'Tyre Polish', quantity: 2 },
  ],
  total: 69900,
  discount: 5000,
  paymentMethod: 'upi',
  at: new Date('2026-10-28T13:00:00Z'),
  buttonPayload: 'rate|b1',
};

describe('WhatsApp wash templates', () => {
  it('has every template in English and Telugu, with an example per blank', () => {
    for (const name of ['wash_ready', 'wash_bill', 'wash_invoice', 'wash_reminder', 'comeback_offer', 'referral_reward', 'plan_ending']) {
      expect(WA_TEMPLATES.filter((t) => t.name === name).map((t) => t.language).sort()).toEqual(['en', 'te']);
    }
    for (const t of WA_TEMPLATES) {
      const blanks = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(blanks).toEqual(blanks.map((_, i) => i + 1));
      expect(t.example).toHaveLength(blanks.length);
      // Meta refuses a template that starts or ends with a blank.
      expect(t.body.trim().startsWith('{{')).toBe(false);
      expect(t.body.trim().endsWith('}}')).toBe(false);
      // …and a blank followed only by punctuation counts as ending with it.
      expect(t.body.trim()).not.toMatch(/\}\}[\s.!?,]*$/);
      for (const b of t.buttons) {
        expect([...b].length).toBeLessThanOrEqual(25);
        // Meta refuses buttons with emojis, line breaks or formatting.
        expect(b).toMatch(/^[\p{L}\p{M}\p{N} ]+$/u);
      }
    }
  });

  it('fills in Ready for pickup', () => {
    const m = washTemplateMessage('ready', wash, 'en');
    expect(m.name).toBe('wash_ready');
    expect(m.params).toEqual(['Ravi', 'Maruti Suzuki Swift (AP39AB1234)', 'Sri Mana Wash, Kovur', '₹699']);
    expect(m.preview).toContain('Hi Ravi, your Maruti Suzuki Swift (AP39AB1234) is washed and ready for pickup at Sri Mana Wash, Kovur.');
    expect(washTemplateMessage('ready', { ...wash, total: 0 }, 'en').params[3]).toBe('Nothing');
    expect(washTemplateMessage('ready', { ...wash, registrationNumber: 'WALK-IN-1730100000' }, 'en').params[1]).toBe('Maruti Suzuki Swift');
  });

  it('fills in the bill', () => {
    const m = washTemplateMessage('bill', wash, 'en');
    expect(m.params).toEqual([
      'Ravi',
      'Sri Mana Wash, Kovur',
      'Maruti Suzuki Swift (AP39AB1234)',
      'Basic Wash, Tyre Polish × 2',
      '₹699 (you saved ₹50)',
      'UPI',
      '28 Oct 2026, 6:30 pm',
    ]);
    expect(m.buttonPayload).toBe('rate|b1');
  });

  it('speaks Telugu, and never sends an empty or multi-line blank', () => {
    const m = washTemplateMessage('bill', { ...wash, customerName: null, paymentMethod: 'cash', discount: 0 }, 'te');
    expect(m.language).toBe('te');
    expect(m.params[0]).toBe('మిత్రమా');
    expect(m.params[4]).toBe('₹699');
    expect(m.params[5]).toBe('నగదు');
    const odd = washTemplateMessage('bill', { ...wash, customerName: '  ', services: [], vehicle: 'Swift\nZXI' }, 'en');
    for (const p of odd.params) {
      expect(p.length).toBeGreaterThan(0);
      expect(p).not.toMatch(/[\n\t]| {2}/);
    }
    expect(odd.params[0]).toBe('there');
  });

  it('the invoice is the bill with the PDF attached: same words, a document on top', () => {
    const bill = washTemplateMessage('bill', wash, 'en');
    const invoice = washTemplateMessage('invoice', wash, 'en');
    expect(invoice.name).toBe('wash_invoice');
    expect(invoice.params).toEqual(bill.params);
    expect(invoice.preview).toContain('Your bill is attached');
    expect(WA_TEMPLATES.filter((t) => t.name === 'wash_invoice').every((t) => t.header === 'DOCUMENT')).toBe(true);
  });

  it('fills in the follow-ups, with Stop offers on every offer', () => {
    const base = { customerName: 'Ravi Kumar', place: 'Sri Mana Wash, Kovur', branchId: 'b1' };
    const r = followUpMessage({ ...base, kind: 'reminder', vehicle: 'Maruti Suzuki Swift', registrationNumber: 'AP39AB1234', days: 12 }, 'en');
    expect(r.preview).toContain("Hi Ravi, it's been 12 days since your Maruti Suzuki Swift (AP39AB1234) was washed at Sri Mana Wash, Kovur.");
    expect(r.buttonPayloads).toEqual(['svc|b1', 'STOP']);
    const c = followUpMessage({ ...base, kind: 'comeback', vehicle: 'Swift', registrationNumber: 'WALK-IN-1', percent: 8, code: 'MANA-1234-ABCDEF', validTill: '19 Nov 2026' }, 'en');
    expect(c.params).toEqual(['Ravi', 'Swift', 'Sri Mana Wash, Kovur', '8', 'MANA-1234-ABCDEF', '19 Nov 2026']);
    const f = followUpMessage({ ...base, kind: 'referral', friend: null, percent: 10, code: 'X', validTill: '1 Dec 2026' }, 'te');
    expect(f.params[1]).toBe('మీ స్నేహితుడు');
    const p = followUpMessage({ ...base, kind: 'plan_ending', plan: 'Basic Plan', vehicle: 'Swift', registrationNumber: 'AP39AB1234', endsOn: '8 Nov 2026', washesLeft: 2, hours: '7 am – 8 pm' }, 'en');
    expect(p.buttonPayloads).toEqual(['loc|b1']);
    // Every offer has See prices and Stop offers; the plan-ending notice has Get Directions.
    expect(WA_TEMPLATES.filter((t) => t.category === 'MARKETING' && t.name !== 'plan_ending').every((t) => t.buttons.length === 2)).toBe(true);
  });

  it('writes dates in India time', () => {
    expect(washMessageDate(new Date('2026-10-28T02:05:00Z'))).toBe('28 Oct 2026, 7:35 am');
  });
});
