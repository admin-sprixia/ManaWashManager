import { describe, expect, it } from 'vitest';
import { followUpMessage, planWashMessage, stampCardLine, WA_TEMPLATES, washMessageDate, washTemplateMessage, type WashMessageInput } from '../index';

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
  });

  it('has a plain bill without the Rate us button, with the same words', () => {
    const plain = washTemplateMessage('invoice', wash, 'en', { plain: true });
    const rated = washTemplateMessage('invoice', wash, 'en');
    expect(plain.name).toBe('wash_invoice_plain');
    expect(plain.hasButton).toBe(false);
    expect(rated.hasButton).toBe(true);
    expect(plain.preview).toBe(rated.preview);
    expect(washTemplateMessage('ready', wash, 'en', { plain: true }).name).toBe('wash_ready');
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

  it('after a plan wash, says what was done and what is left of the pack', () => {
    const input = {
      customerName: 'Ravi Kumar',
      vehicle: 'Hyundai Creta',
      registrationNumber: 'AP39AB1234',
      wash: 'Premium Wash',
      plan: 'Express + Premium Plan',
      left: [
        { wash: 'Express Wash', count: 3 },
        { wash: 'Premium Wash', count: 0 },
      ],
      useBy: '28 Nov 2026',
      place: 'Sri Mana Wash, Kovur',
      branchId: 'b1',
    };
    const m = planWashMessage(input, 'en');
    expect(m.name).toBe('plan_wash');
    expect(m.preview).toBe(
      'Hi Ravi, your plan wash for Hyundai Creta (AP39AB1234) is done: Premium Wash. 🚿\n\nLeft on your Express + Premium Plan: 3 Express, to use any time till 28 Nov 2026.\n\nThank you for choosing Sri Mana Wash, Kovur. See you soon!',
    );
    expect(m.buttonPayloads).toEqual(['loc|b1']);
    const done = planWashMessage({ ...input, left: [{ wash: 'Express Wash', count: 0 }] }, 'te');
    expect(done.params[4]).toBe('వాష్‌లు ఏమీ లేవు (కౌంటర్ వద్ద రీన్యూ చేసుకోండి)');
  });
});

describe('Stamp card on the bill', () => {
  const card = { serviceName: 'Basic Wash', every: 10, stamps: 4, free: 0, welcome: 2 };

  it('has a stamp version of each bill, plain and with the button, in both languages', () => {
    for (const name of ['wash_bill_stamps', 'wash_invoice_stamps', 'wash_bill_stamps_plain', 'wash_invoice_stamps_plain']) {
      const versions = WA_TEMPLATES.filter((t) => t.name === name);
      expect(versions.map((t) => t.language).sort()).toEqual(['en', 'te']);
      for (const t of versions) {
        expect(t.body).toContain('{{8}}');
        expect(t.category).toBe('UTILITY');
        expect(t.buttons.length).toBe(name.endsWith('_plain') ? 0 : 1);
      }
    }
    expect(WA_TEMPLATES.filter((t) => t.name === 'wash_invoice_stamps').every((t) => t.header === 'DOCUMENT')).toBe(true);
    // Same words as the usual bill, one line more.
    const plainBill = WA_TEMPLATES.find((t) => t.name === 'wash_bill' && t.language === 'en')!;
    const stampBill = WA_TEMPLATES.find((t) => t.name === 'wash_bill_stamps' && t.language === 'en')!;
    expect(stampBill.body.replace(/⭐ \*Stamp card:\* \{\{8\}\}\n\n/, '')).toBe(plainBill.body);
  });

  it('writes the card with dots, the welcome stamps and what’s left', () => {
    expect(stampCardLine(card, 'en')).toBe('🟢🟢🟢🟢⚪⚪⚪⚪⚪⚪ 4 of 10 (2 welcome stamps included). 6 more for a free Basic Wash!');
    expect(stampCardLine({ ...card, welcome: 0, stamps: 9 }, 'en')).toBe('🟢🟢🟢🟢🟢🟢🟢🟢🟢⚪ 9 of 10. 1 more for a free Basic Wash!');
    expect(stampCardLine(card, 'te')).toContain('10 లో 4 (2 స్వాగత స్టాంపులతో)');
  });

  it('says when a free wash is ready, with the next card when it has stamps', () => {
    expect(stampCardLine({ ...card, stamps: 0, free: 1, welcome: 0 }, 'en')).toBe('🎁 1 free Basic Wash is ready for your next visit!');
    expect(stampCardLine({ ...card, stamps: 1, free: 1, welcome: 0 }, 'en')).toBe(
      '🎁 1 free Basic Wash is ready for your next visit! Next card: 🟢⚪⚪⚪⚪⚪⚪⚪⚪⚪ 1 of 10.',
    );
    expect(stampCardLine({ ...card, stamps: 0, free: 2, welcome: 0 }, 'en')).toBe('🎁 2 free Basic Washes are ready for your next visit!');
  });

  it('writes a long card without dots', () => {
    expect(stampCardLine({ serviceName: 'Basic Wash', every: 20, stamps: 3, free: 0, welcome: 0 }, 'en')).toBe('3 of 20. 17 more for a free Basic Wash!');
  });

  it('sends the stamp version only when asked and there is a card', () => {
    const withCard = washTemplateMessage('invoice', { ...wash, stampCard: card }, 'en', { stamps: true, plain: true });
    expect(withCard.name).toBe('wash_invoice_stamps_plain');
    expect(withCard.params).toHaveLength(8);
    expect(withCard.preview).toContain('Stamp card:* 🟢🟢🟢🟢⚪');
    expect(washTemplateMessage('bill', { ...wash, stampCard: card }, 'te', { stamps: true }).name).toBe('wash_bill_stamps');
    expect(washTemplateMessage('bill', { ...wash, stampCard: null }, 'en', { stamps: true }).name).toBe('wash_bill');
    expect(washTemplateMessage('bill', { ...wash, stampCard: card }, 'en').params).toHaveLength(7);
    expect(washTemplateMessage('ready', { ...wash, stampCard: card }, 'en', { stamps: true }).name).toBe('wash_ready');
  });
});
