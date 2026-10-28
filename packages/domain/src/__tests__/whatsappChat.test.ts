import { describe, expect, it } from 'vitest';
import {
  chatReply,
  findModels,
  rateChoiceId,
  vehicleGuideRows,
  WA_BUTTON_TITLE_MAX,
  WA_ID_MAX,
  WA_MAX_BUTTONS,
  WA_MAX_LIST_ROWS,
  WA_ROW_DESCRIPTION_MAX,
  WA_ROW_TITLE_MAX,
  type ChatBranch,
  type ChatContext,
  type ChatMessage,
} from '../index';

const hub: ChatBranch = {
  id: 'b1',
  name: 'Kovur',
  city: 'Kovur',
  address: 'Near Highway, Sai Baba Temple, Kovur',
  phone: '9154752999',
  location: { latitude: 14.49, longitude: 79.98 },
  hours: { opensAt: '07:00', closesAt: '20:00', weeklyOff: null, weeklyOffDays: [] },
  reviewUrl: 'https://g.page/r/abc/review',
  vehicleTypes: [
    { id: 'hatch', name: 'Hatchback', category: 'car', bodyKey: 'hatch' },
    { id: 'suv', name: 'SUV', category: 'car', bodyKey: 'suvLarge' },
    { id: 'scooter', name: 'Scooter', category: 'bike', bodyKey: 'scooter' },
  ],
  services: [
    {
      id: 'foam',
      name: 'Foam Wash',
      popular: true,
      prices: [
        { vehicleTypeId: 'hatch', price: 29900 },
        { vehicleTypeId: 'suv', price: 39900 },
        { vehicleTypeId: 'scooter', price: 9900 },
      ],
    },
    { id: 'interior', name: 'Interior Clean', popular: false, prices: [{ vehicleTypeId: 'hatch', price: 19900 }] },
  ],
  plans: [
    { name: 'Shine', washes: 4, months: 1, popular: true, prices: [{ vehicleTypeId: 'hatch', total: 99900, listTotal: 119600 }] },
  ],
};
const ctx: ChatContext = { businessName: 'Sri Mana Wash', branches: [hub] };

const reply = (input: Parameters<typeof chatReply>[0], c = ctx) => chatReply(input, c);
const text = (t: string) => reply({ kind: 'text', text: t });
const choose = (id: string) => reply({ kind: 'choice', id });
const only = (messages: ChatMessage[]) => {
  expect(messages).toHaveLength(1);
  return messages[0]!;
};
const bodyOf = (m: ChatMessage) => ('text' in m ? m.text : '');

/** Every message must fit WhatsApp's limits, or Meta rejects it. */
function expectValid(messages: ChatMessage[]) {
  for (const m of messages) {
    if (m.type === 'buttons') {
      expect(m.buttons.length).toBeGreaterThan(0);
      expect(m.buttons.length).toBeLessThanOrEqual(WA_MAX_BUTTONS);
      expect(m.text.length).toBeLessThanOrEqual(1024);
      for (const b of m.buttons) {
        expect([...b.title].length).toBeLessThanOrEqual(WA_BUTTON_TITLE_MAX);
        expect(b.id.length).toBeLessThanOrEqual(WA_ID_MAX);
      }
      expect(new Set(m.buttons.map((b) => b.id)).size).toBe(m.buttons.length);
    }
    if (m.type === 'list') {
      expect(m.rows.length).toBeGreaterThan(0);
      expect(m.rows.length).toBeLessThanOrEqual(WA_MAX_LIST_ROWS);
      for (const r of m.rows) {
        expect([...r.title].length).toBeLessThanOrEqual(WA_ROW_TITLE_MAX);
        expect([...(r.description ?? '')].length).toBeLessThanOrEqual(WA_ROW_DESCRIPTION_MAX);
        expect(r.id.length).toBeLessThanOrEqual(WA_ID_MAX);
      }
      expect(new Set(m.rows.map((r) => r.id)).size).toBe(m.rows.length);
    }
  }
}

describe('WhatsApp assistant', () => {
  it('greets with Car, Bike and Location', () => {
    const m = only(text('Hi').messages);
    expectValid([m]);
    expect(m.type).toBe('buttons');
    if (m.type !== 'buttons') return;
    expect(m.text).toContain('Sri Mana Wash');
    expect(m.buttons.map((b) => b.id)).toEqual(['cat|b1|car', 'cat|b1|bike', 'loc|b1']);
  });

  it('leaves out Bike when the branch washes no two-wheelers', () => {
    const carsOnly = { ...ctx, branches: [{ ...hub, vehicleTypes: hub.vehicleTypes.filter((t) => t.category === 'car') }] };
    const m = only(reply({ kind: 'text', text: 'hello' }, carsOnly).messages);
    if (m.type !== 'buttons') throw new Error('expected buttons');
    expect(m.buttons.map((b) => b.title)).toEqual(['🚗 Car', '📍 Location & hours', '💬 Talk to us']);
  });

  it('walks company → model → prices', () => {
    const makes = only(choose('cat|b1|car').messages);
    expectValid([makes]);
    if (makes.type !== 'list') throw new Error('expected list');
    expect(makes.rows[0]!.title).toBe('Maruti Suzuki');
    // Tractors and buses aren't on a branch that only washes cars.
    expect(makes.rows.some((r) => r.title === 'Mahindra Construction')).toBe(false);

    const models = only(choose(makes.rows[0]!.id).messages);
    expectValid([models]);
    if (models.type !== 'list') throw new Error('expected list');
    expect(models.rows.every((r) => r.id.startsWith('pr|b1|Maruti Suzuki|') || r.id.startsWith('mo|b1|car|Maruti Suzuki|'))).toBe(true);

    const priceMessages = choose(models.rows[0]!.id).messages;
    expectValid(priceMessages);
    expect(bodyOf(priceMessages[0]!)).toContain('Maruti Suzuki');
  });

  it('pages long lists with a More row', () => {
    const makes = only(choose('cat|b1|car').messages);
    if (makes.type !== 'list') throw new Error('expected list');
    const more = makes.rows.at(-1)!;
    expect(more.title).toBe('More companies ›');
    const next = only(choose(more.id).messages);
    expectValid([next]);
    if (next.type !== 'list') throw new Error('expected list');
    expect(next.rows.map((r) => r.title)).not.toContain('Maruti Suzuki');
  });

  it("shows only that model's prices and plans", () => {
    const m = only(choose('pr|b1|Maruti Suzuki|Swift').messages);
    expectValid([m]);
    const body = bodyOf(m);
    expect(body).toContain('Maruti Suzuki Swift');
    expect(body).toContain('Hatchback');
    expect(body).toContain('Foam Wash ⭐: *₹299*');
    expect(body).toContain('Interior Clean: *₹199*');
    expect(body).not.toContain('₹399');
    expect(body).toContain('Shine ⭐: 4 washes in a month, *₹999* (save ₹197)');
    expect(body).toContain('7 am – 8 pm');
  });

  it('prices an SUV as an SUV', () => {
    const body = bodyOf(only(choose('pr|b1|Hyundai|Creta').messages));
    expect(body).toContain('Foam Wash ⭐: *₹399*');
    expect(body).not.toContain('Interior Clean');
  });

  it('jumps straight to a typed model', () => {
    expect(bodyOf(only(text('swift').messages))).toContain('Maruti Suzuki Swift');
    expect(bodyOf(only(text('Activa').messages))).toContain('Honda Activa');
    expect(bodyOf(only(text('my car is a creta').messages))).toContain('Hyundai Creta');
  });

  it('asks which one when a name fits several models', () => {
    const rows = vehicleGuideRows();
    expect(findModels('swift dzire', rows).every((r) => r.model.toLowerCase().includes('dzire'))).toBe(true);
    const m = text('City');
    expectValid(m.messages);
  });

  it('falls back to the welcome for anything else', () => {
    const m = only(text('when are you open?').messages);
    expect(m.type).toBe('buttons');
  });

  it('sends the location, hours and phone', () => {
    const out = choose('loc|b1').messages;
    expectValid(out);
    expect(out[0]).toMatchObject({ type: 'location', latitude: 14.49, longitude: 79.98 });
    const card = bodyOf(out[1]!);
    expect(card).toContain('7 am – 8 pm');
    expect(card).toContain('+91 91547 52999');
  });

  it('points to the team number for a chat', () => {
    expect(bodyOf(only(choose('talk|b1').messages))).toContain('https://wa.me/919154752999');
  });

  it('answers the bill’s Rate us button with the review link', () => {
    expect(bodyOf(only(choose(rateChoiceId('b1')).messages))).toContain('https://g.page/r/abc/review');
  });

  it('handles STOP and START', () => {
    expect(text('STOP').marketing).toBe('stop');
    expect(text('start').marketing).toBe('start');
    expect(text('Hi').marketing).toBeUndefined();
  });

  it('says thanks back without the whole menu', () => {
    expect(bodyOf(only(text('Thank you 🙏').messages))).toContain("You're welcome");
  });

  it('asks for the branch first when there are several', () => {
    const two = { ...ctx, branches: [hub, { ...hub, id: 'b2', name: 'Nellore', city: 'Nellore' }] };
    const m = only(reply({ kind: 'text', text: 'hi' }, two).messages);
    expectValid([m]);
    if (m.type !== 'list') throw new Error('expected list');
    expect(m.rows.map((r) => r.id)).toEqual(['br|b1', 'br|b2']);
    const next = only(reply({ kind: 'choice', id: 'br|b2' }, two).messages);
    if (next.type !== 'buttons') throw new Error('expected buttons');
    expect(next.buttons[0]!.id).toBe('cat|b2|car');
  });

  it('says sorry for a model the branch has no price for', () => {
    const body = bodyOf(only(choose('pr|b1|Tata|Prima').messages));
    expect(body).toContain("don't wash");
  });
});
