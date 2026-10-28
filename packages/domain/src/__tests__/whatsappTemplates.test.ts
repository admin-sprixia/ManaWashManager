import { describe, expect, it } from 'vitest';
import { WA_TEMPLATES, washMessageDate, washTemplateMessage, type WashMessageInput } from '../index';

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
    for (const name of ['wash_ready', 'wash_bill']) {
      expect(WA_TEMPLATES.filter((t) => t.name === name).map((t) => t.language).sort()).toEqual(['en', 'te']);
    }
    for (const t of WA_TEMPLATES) {
      const blanks = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(blanks).toEqual(blanks.map((_, i) => i + 1));
      expect(t.example).toHaveLength(blanks.length);
      // Meta refuses a template that starts or ends with a blank.
      expect(t.body.trim().startsWith('{{')).toBe(false);
      expect(t.body.trim().endsWith('}}')).toBe(false);
      for (const b of t.buttons) expect([...b].length).toBeLessThanOrEqual(25);
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

  it('writes dates in India time', () => {
    expect(washMessageDate(new Date('2026-10-28T02:05:00Z'))).toBe('28 Oct 2026, 7:35 am');
  });
});
