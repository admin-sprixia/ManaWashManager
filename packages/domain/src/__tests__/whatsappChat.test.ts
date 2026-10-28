import { describe, expect, it } from 'vitest';
import {
  chatReply,
  findModels,
  rateChoiceId,
  vehicleGuideRows,
  WA_BUTTON_TITLE_MAX,
  WA_FOOTER_MAX,
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
// Wednesday 28 Oct 2026, 6:30 pm in India.
const EVENING = new Date('2026-10-28T13:00:00Z');
const ctx: ChatContext = { businessName: 'Sri Mana Wash', branches: [hub], now: EVENING, bannerUrl: 'https://api.example/whatsapp/banner.jpg' };

const reply = (input: Parameters<typeof chatReply>[0], c = ctx) => chatReply(input, c);
const text = (t: string) => reply({ kind: 'text', text: t });
const choose = (id: string) => reply({ kind: 'choice', id });
const only = (messages: ChatMessage[]) => {
  expect(messages).toHaveLength(1);
  return messages[0]!;
};
const bodyOf = (m: ChatMessage) => ('text' in m ? m.text : '');
const as = <T extends ChatMessage['type']>(m: ChatMessage | undefined, type: T) => {
  expect(m?.type).toBe(type);
  return m as Extract<ChatMessage, { type: T }>;
};

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
      expect([...(m.footer ?? '')].length).toBeLessThanOrEqual(WA_FOOTER_MAX);
    }
    if (m.type === 'link') {
      expect([...m.button].length).toBeLessThanOrEqual(WA_BUTTON_TITLE_MAX);
      expect(m.url).toMatch(/^https:\/\//);
      expect([...(m.footer ?? '')].length).toBeLessThanOrEqual(WA_FOOTER_MAX);
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
      expect([...m.button].length).toBeLessThanOrEqual(WA_BUTTON_TITLE_MAX);
      expect([...m.title].length).toBeLessThanOrEqual(WA_ROW_TITLE_MAX);
    }
  }
}

describe('WhatsApp assistant', () => {
  it('welcomes with the banner, today’s hours and three buttons, then a More options list', () => {
    const [main, more, ...extra] = text('Hi').messages;
    expect(extra).toHaveLength(0);
    expectValid([main!, more!]);
    const m = as(main, 'buttons');
    expect(m.imageUrl).toBe('https://api.example/whatsapp/banner.jpg');
    expect(m.text).toContain('Good evening! 👋');
    expect(m.text).toContain('Welcome to *Sri Mana Wash*, Kovur.');
    expect(m.text).toContain('Professional car and bike care.');
    expect(m.text).toContain('🕗 Open today: 7 am – 8 pm');
    expect(m.text).toContain('📍 Near Highway, Sai Baba Temple, Kovur');
    expect(m.buttons.map((b) => b.id)).toEqual(['svc|b1', 'loc|b1', 'lang|b1|te']);
    expect(m.buttons.map((b) => b.title)).toEqual(['🚗 Services & Prices', '📍 Get Directions', '🌐 తెలుగు']);
    const list = as(more, 'list');
    expect(list.rows.map((r) => r.id)).toEqual(['rate|b1', 'talk|b1', 'hrs|b1', 'pln|b1', 'lang|b1|te']);
    expect(list.rows[1]!.description).toBe('Call +91 91547 52999');
  });

  it('greets by first name, and welcomes back someone we know', () => {
    const named = { ...ctx, person: { name: 'Ravi Kumar', returning: false, lang: null } };
    expect(bodyOf(reply({ kind: 'text', text: 'hi' }, named).messages[0]!)).toContain('Good evening, Ravi! 👋');
    const back = { ...ctx, person: { name: 'Ravi Kumar', returning: true, lang: null } };
    const body = bodyOf(reply({ kind: 'text', text: 'hi' }, back).messages[0]!);
    expect(body).toContain('Welcome back, Ravi! 👋');
    expect(body).toContain('Great to see you again at *Sri Mana Wash*, Kovur.');
  });

  it('says when it opens next after closing time and on the weekly off', () => {
    const late = { ...ctx, now: new Date('2026-10-28T15:00:00Z') }; // 8:30 pm
    expect(bodyOf(reply({ kind: 'text', text: 'hi' }, late).messages[0]!)).toContain('🌙 Closed for today · Opens tomorrow at 7 am');
    const offToday = { ...ctx, branches: [{ ...hub, hours: { ...hub.hours, weeklyOffDays: [3] } }] };
    expect(bodyOf(reply({ kind: 'text', text: 'hi' }, offToday).messages[0]!)).toContain('🔒 Closed today · Opens tomorrow at 7 am');
  });

  it('switches to Telugu and back, and remembers it', () => {
    const r = choose('lang|b1|te');
    expect(r.lang).toBe('te');
    expectValid(r.messages);
    const m = as(r.messages[0], 'buttons');
    expect(m.text).toContain('నమస్కారం! 👋');
    expect(m.text).toContain('🕗 ఈరోజు: ఉదయం 7 – రాత్రి 8');
    expect(m.buttons.map((b) => b.title)).toEqual(['🚗 సేవలు & ధరలు', '📍 దారి చూపించు', '🌐 English']);
    const inTelugu = { ...ctx, person: { name: 'Ravi', returning: true, lang: 'te' as const } };
    const again = reply({ kind: 'text', text: 'hi' }, inTelugu);
    expect(again.lang).toBeUndefined();
    expect(bodyOf(again.messages[0]!)).toContain('మళ్ళీ స్వాగతం, Ravi గారు! 👋');
    expect(reply({ kind: 'choice', id: 'lang|b1|en' }, inTelugu).lang).toBe('en');
  });

  it('answers in Telugu when someone writes in Telugu', () => {
    const r = text('నమస్కారం');
    expect(r.lang).toBe('te');
    expect(bodyOf(r.messages[0]!)).toContain('కి స్వాగతం');
    expect(text('telugu').lang).toBe('te');
  });

  it('keeps every Telugu message inside WhatsApp’s limits', () => {
    const tel = { ...ctx, person: { name: null, returning: false, lang: 'te' as const } };
    for (const choice of ['svc|b1', 'cat|b1|car', 'cat|b1|bike', 'mk|b1|car|1', 'mo|b1|car|Maruti Suzuki|0', 'pr|b1|Maruti Suzuki|Swift', 'loc|b1', 'hrs|b1', 'pln|b1', 'talk|b1', 'rate|b1']) {
      expectValid(reply({ kind: 'choice', id: choice }, tel).messages);
    }
    expect(bodyOf(reply({ kind: 'choice', id: 'pr|b1|Maruti Suzuki|Swift' }, tel).messages[0]!)).toContain('Shine ⭐: నెలలో 4 వాష్‌లు, *₹999* (₹197 ఆదా)');
  });

  it('Services & Prices asks car or bike, or goes straight to companies', () => {
    const m = as(only(choose('svc|b1').messages), 'buttons');
    expect(m.buttons.map((b) => b.id)).toEqual(['cat|b1|car', 'cat|b1|bike']);
    const carsOnly = { ...ctx, branches: [{ ...hub, vehicleTypes: hub.vehicleTypes.filter((t) => t.category === 'car') }] };
    const direct = as(only(reply({ kind: 'choice', id: 'svc|b1' }, carsOnly).messages), 'list');
    expect(direct.rows[0]!.title).toBe('Maruti Suzuki');
    expect(bodyOf(reply({ kind: 'text', text: 'hi' }, carsOnly).messages[0]!)).toContain('Professional car care.');
  });

  it('says the price list is coming when nothing is priced yet', () => {
    const empty = { ...ctx, branches: [{ ...hub, services: [] }] };
    const m = as(only(reply({ kind: 'choice', id: 'svc|b1' }, empty).messages), 'buttons');
    expect(m.text).toContain('updating our price list');
    expectValid([m]);
  });

  it('walks company → model → prices', () => {
    const makes = as(only(choose('cat|b1|car').messages), 'list');
    expectValid([makes]);
    expect(makes.rows[0]!.title).toBe('Maruti Suzuki');
    // Tractors and buses aren't on a branch that only washes cars.
    expect(makes.rows.some((r) => r.title === 'Mahindra Construction')).toBe(false);

    const models = as(only(choose(makes.rows[0]!.id).messages), 'list');
    expectValid([models]);
    expect(models.rows.every((r) => r.id.startsWith('pr|b1|Maruti Suzuki|') || r.id.startsWith('mo|b1|car|Maruti Suzuki|'))).toBe(true);

    const priceMessages = choose(models.rows[0]!.id).messages;
    expectValid(priceMessages);
    expect(bodyOf(priceMessages[0]!)).toContain('Maruti Suzuki');
  });

  it('pages long lists with a More row', () => {
    const makes = as(only(choose('cat|b1|car').messages), 'list');
    const more = makes.rows.at(-1)!;
    expect(more.title).toBe('More companies ›');
    const next = as(only(choose(more.id).messages), 'list');
    expectValid([next]);
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
    expect(as(m, 'buttons').buttons.map((b) => b.id)).toEqual(['loc|b1', 'home|b1', 'talk|b1']);
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
    expectValid(text('City').messages);
  });

  it('falls back to the welcome for anything else', () => {
    const [m] = text('when are you open?').messages;
    expect(as(m, 'buttons').buttons[0]!.id).toBe('svc|b1');
  });

  it('sends the pin and a Google Maps directions button', () => {
    const out = choose('loc|b1').messages;
    expectValid(out);
    expect(out[0]).toMatchObject({ type: 'location', latitude: 14.49, longitude: 79.98 });
    const card = as(out[1], 'link');
    expect(card.url).toBe('https://www.google.com/maps/dir/?api=1&destination=14.49,79.98');
    expect(card.button).toBe('Open in Google Maps');
    expect(card.text).toContain('🕗 Open today: 7 am – 8 pm');
    expect(card.text).toContain('+91 91547 52999');
  });

  it('searches Google Maps by name and address when there is no pin', () => {
    const noPin = { ...ctx, branches: [{ ...hub, location: null }] };
    const out = reply({ kind: 'choice', id: 'loc|b1' }, noPin).messages;
    expect(as(only(out), 'link').url).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Sri Mana Wash, Near Highway, Sai Baba Temple, Kovur')}`,
    );
  });

  it('gives the number to call', () => {
    const body = bodyOf(only(choose('talk|b1').messages));
    expect(body).toContain('📞 *Call us:* +91 91547 52999');
    expect(body).toContain('📍 Or visit us: Near Highway, Sai Baba Temple, Kovur');
  });

  it('lists the timings and the plans', () => {
    expect(bodyOf(only(choose('hrs|b1').messages))).toContain('7 am – 8 pm · every day');
    expect(bodyOf(only(choose('pln|b1').messages))).toContain('Shine ⭐: 4 washes in a month, from *₹999* (save up to ₹197)');
  });

  it('answers the bill’s Rate us button with a review button', () => {
    const m = as(only(choose(rateChoiceId('b1')).messages), 'link');
    expect(m.url).toBe('https://g.page/r/abc/review');
  });

  it('handles STOP and START', () => {
    expect(text('STOP').marketing).toBe('stop');
    expect(text('start').marketing).toBe('start');
    expect(text('Hi').marketing).toBeUndefined();
  });

  it('says thanks back without the whole menu', () => {
    expect(bodyOf(only(text('Thank you 🙏').messages))).toContain("You're welcome");
    expect(bodyOf(only(text('ధన్యవాదాలు').messages))).toContain('సంతోషం');
  });

  it('asks for the branch first when there are several', () => {
    const two = { ...ctx, branches: [hub, { ...hub, id: 'b2', name: 'Nellore', city: 'Nellore' }] };
    const m = as(only(reply({ kind: 'text', text: 'hi' }, two).messages), 'list');
    expectValid([m]);
    expect(m.rows.map((r) => r.id)).toEqual(['br|b1', 'br|b2']);
    const next = as(reply({ kind: 'choice', id: 'br|b2' }, two).messages[0], 'buttons');
    expect(next.buttons[0]!.id).toBe('svc|b2');
  });

  it('says sorry for a model the branch has no price for', () => {
    const body = bodyOf(only(choose('pr|b1|Tata|Prima').messages));
    expect(body).toContain("don't wash");
  });
});
