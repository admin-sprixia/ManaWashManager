import { clockMinutes, formatClock, offDaysOf, WEEKDAY_LABELS, type OpeningHours } from './customerApp';
import type { VehicleCategory } from './types';
import { bodyTypeDef, bodyTypeForName } from './vehicleCatalog';
import { VEHICLE_MAKES, vehicleGuideRows, vehicleTypeKeysFor, type VehicleGuideRow, type VehicleModelEdit } from './vehicleMakes';

/**
 * The WhatsApp assistant on the business number. "Hi" gets the welcome: the banner, a greeting by
 * name, today's hours, the address and phone, and Services & Prices / Get Directions / తెలుగు.
 * Services & Prices walks Car or Bike → company → model to that model's hub prices and wash
 * plans. Customers pick from the lists; a typed model name ("swift") still works, unadvertised. Everything is in English or Telugu, whichever the customer picked or writes in. Pure: the
 * API feeds in the branches, who's writing and what they sent, and sends back what this returns.
 *
 * Every button and list row carries everything the next step needs in its id
 * ("mo|<branch>|car|Maruti Suzuki|0"), so the assistant keeps no conversation state beyond the
 * customer's language, which the API stores.
 */

// WhatsApp's limits for interactive messages.
export const WA_MAX_BUTTONS = 3;
export const WA_MAX_LIST_ROWS = 10;
export const WA_BUTTON_TITLE_MAX = 20;
export const WA_ROW_TITLE_MAX = 24;
export const WA_ROW_DESCRIPTION_MAX = 72;
export const WA_BUTTONS_BODY_MAX = 1024;
export const WA_FOOTER_MAX = 60;
export const WA_ID_MAX = 200;

export interface ChatBranch {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  location: { latitude: number; longitude: number } | null;
  hours: OpeningHours;
  reviewUrl: string | null;
  vehicleTypes: { id: string; name: string; category: VehicleCategory; bodyKey: string | null }[];
  /** Hub services in menu order, prices in paise. */
  services: {
    id: string;
    name: string;
    popular: boolean;
    description?: string | null;
    /** What's included, one short line each. */
    checklist?: string[];
    durationMin?: number | null;
    prices: { vehicleTypeId: string; price: number }[];
  }[];
  /** Wash plans sold at the shop, prices in paise. */
  plans: {
    name: string;
    washes: number;
    months: number;
    popular: boolean;
    /** The wash each visit gets, and the better one every Nth visit. */
    serviceName?: string | null;
    upgrade?: { every: number; name: string } | null;
    prices: { vehicleTypeId: string; total: number; listTotal: number }[];
  }[];
}

export type ChatLang = 'en' | 'te';

/** Who's writing, as far as we know them. */
export interface ChatPerson {
  /** Their name on our books, else on their WhatsApp profile. */
  name: string | null;
  /** They've washed with us or written to us before. */
  returning: boolean;
  /** The language they picked earlier, if any. */
  lang: ChatLang | null;
  /** The price list they saw last ("pr|<branch>|<make>|<model>"), so a number picks from it. */
  context?: string | null;
  /** A teammate replied lately: typed messages go to them, not the assistant. */
  paused?: boolean;
}

export interface ChatContext {
  /** The name customers know, e.g. "Sri Mana Wash". */
  businessName: string;
  branches: ChatBranch[];
  /** Head office's changes to the model list. */
  edits?: readonly VehicleModelEdit[];
  /** The picture on top of the welcome (a public https link). */
  bannerUrl?: string | null;
  person?: ChatPerson | null;
  /** For the greeting and today's hours (India time); defaults to now. */
  now?: Date;
  /** The Services & Prices Flow is published: Car / Bike opens it instead of the company list. */
  flows?: boolean;
}

/** What the customer sent: words, a tap on a button or list, or a photo / voice note / file. */
export type ChatInput = { kind: 'text'; text: string } | { kind: 'choice'; id: string } | { kind: 'media' };

export interface ChatButton {
  id: string;
  title: string;
}
export interface ChatRow {
  id: string;
  title: string;
  description?: string;
}

export type ChatMessage =
  | { type: 'text'; text: string }
  | { type: 'buttons'; text: string; buttons: ChatButton[]; footer?: string; imageUrl?: string }
  | { type: 'list'; text: string; button: string; title: string; rows: ChatRow[]; footer?: string }
  /** One button that opens a link (Google Maps, the review page). */
  | { type: 'link'; text: string; button: string; url: string; footer?: string }
  /** One button that opens the Services & Prices Flow; `token` says which branch and vehicle. */
  | { type: 'flow'; text: string; button: string; token: string }
  | { type: 'location'; latitude: number; longitude: number; name: string; address: string };

export interface ChatResult {
  messages: ChatMessage[];
  /** The customer asked for no more offers and reminders (STOP), or asked for them again (START). */
  marketing?: 'stop' | 'start';
  /** The language to answer this customer in from now on, when it changed. */
  lang?: ChatLang;
  /** The price list just sent, to remember for this customer (see ChatPerson.context). */
  context?: string;
  /** Something only a person can answer: it waits in the team's inbox. */
  forTeam?: true;
}

const STOP_WORDS = new Set(['stop', 'unsubscribe', 'stop offers', 'no offers', 'opt out', 'optout']);
const START_WORDS = new Set(['start', 'subscribe', 'opt in', 'optin']);
const THANKS =
  /^(thanks?( you)?|thank u|thx|ty|ok(ay)?|k|👍|🙏|super|great|nice|good|ధన్యవాదాలు|థాంక్స్|థ్యాంక్స్|సరే)(\s|[.!]|🙏|👍|😊)*$/iu;
const TELUGU_SCRIPT = /[ఀ-౿]/u;
/** "Hi", "hello", "menu", "prices"…: answered with the welcome. Anything else unrecognised is a question for the team. */
const GREETING =
  /^(h+i+|hai|hey+|hello+|helo|hlo|hola|namaste|namaskaram|namaskar|good (morning|afternoon|evening)|gm|menu|price|prices|rate|rates|cost|services?|start over|నమస్కారం|నమస్తే|హాయ్|హలో)$/iu;
const TELUGU_WORDS = new Set(['telugu', 'తెలుగు']);
const ENGLISH_WORDS = new Set(['english', 'ఇంగ్లీష్']);

/** The language a message is written in, if it says: Telugu script means Telugu. */
export function chatLanguageOf(text: string): ChatLang | null {
  return TELUGU_SCRIPT.test(text) ? 'te' : null;
}

const PAGE_ROWS = WA_MAX_LIST_ROWS - 1;
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const cut = (s: string, max: number) => ([...s].length <= max ? s : `${[...s].slice(0, max - 1).join('')}…`);

// ─── Ids ─────────────────────────────────────────────────────────────────────

const id = (...parts: (string | number)[]) => parts.map((p) => String(p).replace(/\|/g, '/')).join('|');

/** The quick-reply id on the bill's "Rate us" button. */
export const rateChoiceId = (branchId: string) => id('rate', branchId);

// ─── One conversation turn ───────────────────────────────────────────────────

/** What every reply needs: the business, who's writing, in which language, and when. */
interface Turn {
  ctx: ChatContext;
  lang: ChatLang;
  now: Date;
  edits: readonly VehicleModelEdit[];
}
const te = (t: Turn) => t.lang === 'te';
/** English or Telugu. */
const say = (t: Turn, en: string, telugu: string) => (te(t) ? telugu : en);

// ─── Time (India) ────────────────────────────────────────────────────────────

const IST_OFFSET_MINUTES = 5 * 60 + 30;
function indiaClock(now: Date): { day: number; minutes: number } {
  const d = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  return { day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

const TE_WEEKDAYS = ['ఆదివారం', 'సోమవారం', 'మంగళవారం', 'బుధవారం', 'గురువారం', 'శుక్రవారం', 'శనివారం'] as const;

/** "07:30" → "ఉదయం 7:30", "20:00" → "రాత్రి 8". */
function teluguClock(value: string): string {
  const minutes = clockMinutes(value);
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const part = h24 < 4 ? 'తెల్లవారుజామున' : h24 < 12 ? 'ఉదయం' : h24 < 16 ? 'మధ్యాహ్నం' : h24 < 19 ? 'సాయంత్రం' : 'రాత్రి';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${part} ${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

const clock = (t: Turn, value: string) => (te(t) ? teluguClock(value) : formatClock(value));

function hoursRange(t: Turn, h: OpeningHours): string | null {
  return h.opensAt && h.closesAt ? `${clock(t, h.opensAt)} – ${clock(t, h.closesAt)}` : null;
}

/** "🕗 Open today: 7 am – 8 pm", or when it opens next if it's closed now. */
function todayLine(t: Turn, h: OpeningHours): string | null {
  const range = hoursRange(t, h);
  if (!range || !h.opensAt || !h.closesAt) return null;
  const off = offDaysOf(h);
  const { day, minutes } = indiaClock(t.now);
  const workday = !off.includes(day);
  if (workday && minutes < clockMinutes(h.closesAt)) return say(t, `🕗 Open today: ${range}`, `🕗 ఈరోజు: ${range}`);
  const ahead = [1, 2, 3, 4, 5, 6, 7].find((k) => !off.includes((day + k) % 7));
  if (ahead == null) return null;
  const nextDay = (day + ahead) % 7;
  const when =
    ahead === 1 ? say(t, 'tomorrow', 'రేపు') : say(t, WEEKDAY_LABELS[nextDay]!, TE_WEEKDAYS[nextDay]!);
  const opens = clock(t, h.opensAt);
  return workday
    ? say(t, `🌙 Closed for today · Opens ${when} at ${opens}`, `🌙 ఈరోజుకి మూసేశాం · ${when} ${opens} కి తెరుస్తాం`)
    : say(t, `🔒 Closed today · Opens ${when} at ${opens}`, `🔒 ఈరోజు సెలవు · ${when} ${opens} కి తెరుస్తాం`);
}

// ─── Vehicles at a branch ────────────────────────────────────────────────────

/** A vehicle type's catalog key: its linked body type, else what its name suggests. */
function typeKey(t: ChatBranch['vehicleTypes'][number]): string | null {
  return t.bodyKey ?? bodyTypeForName(t.name)?.key ?? null;
}

/** The branch's vehicle type for a listed model (Swift → Hatchback), best fit first. */
export function chatVehicleType(
  branch: ChatBranch,
  make: string,
  model: string,
  edits: readonly VehicleModelEdit[] = [],
): ChatBranch['vehicleTypes'][number] | null {
  const keys = vehicleTypeKeysFor(make, model, edits);
  if (!keys) return null;
  for (const key of keys) {
    const match = branch.vehicleTypes.find((t) => typeKey(t) === key);
    if (match) return match;
  }
  return null;
}

const priced = (branch: ChatBranch, typeId: string) =>
  branch.services.some((s) => s.prices.some((p) => p.vehicleTypeId === typeId && p.price > 0));

/** The listed models this branch washes and has prices for, in one category. */
function modelsAt(branch: ChatBranch, category: VehicleCategory, edits: readonly VehicleModelEdit[]): VehicleGuideRow[] {
  return vehicleGuideRows(edits).filter((r) => {
    if (r.category !== category) return false;
    const t = chatVehicleType(branch, r.make, r.model, edits);
    return !!t && priced(branch, t.id);
  });
}

/** Companies in the order people pick them (Maruti Suzuki first), then ones head office added. */
function makesAt(branch: ChatBranch, category: VehicleCategory, edits: readonly VehicleModelEdit[]): string[] {
  const present = new Set(modelsAt(branch, category, edits).map((r) => r.make));
  const ordered = VEHICLE_MAKES.filter((m) => m.category === category && present.has(m.name)).map((m) => m.name);
  const extra = [...present].filter((m) => !ordered.includes(m)).sort((a, b) => a.localeCompare(b));
  return [...new Set([...ordered, ...extra])];
}

/** The categories the branch has prices for, cars first. */
function categoriesAt(b: ChatBranch, edits: readonly VehicleModelEdit[]): VehicleCategory[] {
  return (['car', 'bike'] as const).filter((c) => modelsAt(b, c, edits).length > 0);
}

// ─── Shared pieces ───────────────────────────────────────────────────────────

function branchLine(t: Turn, b: ChatBranch): string {
  const place = b.city ? `, ${b.city}` : '';
  return t.ctx.branches.length > 1 ? `*${b.name}*${place}` : `*${t.ctx.businessName}*${place}`;
}

const placeName = (t: Turn, b: ChatBranch) => (t.ctx.branches.length > 1 ? b.name : t.ctx.businessName);

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : phone;
}

/** "Ravi Kumar" → "Ravi"; nothing usable → null. */
function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{M}.'-]/gu, '') ?? '';
  return [...first].length >= 2 ? cut(first, 20) : null;
}

const servicesButton = (t: Turn, b: ChatBranch): ChatButton => ({ id: id('svc', b.id), title: say(t, '🚗 Services & Prices', '🚗 సేవలు & ధరలు') });
const directionsButton = (t: Turn, b: ChatBranch): ChatButton => ({ id: id('loc', b.id), title: say(t, '📍 Get Directions', '📍 దారి చూపించు') });
const talkButton = (t: Turn, b: ChatBranch): ChatButton => ({ id: id('talk', b.id), title: say(t, '📞 Talk to us', '📞 మాతో మాట్లాడండి') });
const menuFooter = (t: Turn) => say(t, 'Send Hi any time for the menu', 'మెనూ కోసం ఎప్పుడైనా Hi పంపండి');

// ─── The welcome ─────────────────────────────────────────────────────────────

function greeting(t: Turn): string {
  const p = t.ctx.person;
  const name = firstName(p?.name);
  if (te(t)) {
    const who = name ? `, ${name} గారు` : '';
    return p?.returning ? `మళ్ళీ స్వాగతం${who}! 👋` : `నమస్కారం${who}! 👋`;
  }
  const who = name ? `, ${name}` : '';
  if (p?.returning) return `Welcome back${who}! 👋`;
  const { minutes } = indiaClock(t.now);
  const part = minutes < 12 * 60 ? 'morning' : minutes < 17 * 60 ? 'afternoon' : 'evening';
  return `Good ${part}${who}! 👋`;
}

/** The banner, a greeting with today's hours, and the three main buttons. */
function welcome(t: Turn, b: ChatBranch): Extract<ChatMessage, { type: 'buttons' }> {
  const returning = !!t.ctx.person?.returning;
  const where = branchLine(t, b);
  const cats = categoriesAt(b, t.edits);
  const bikesOnly = cats.length === 1 && cats[0] === 'bike';
  const carsOnly = cats.length === 1 && cats[0] === 'car';
  const today = todayLine(t, b.hours);
  const address = b.address ?? b.city;
  const text = [
    greeting(t),
    te(t)
      ? returning
        ? `${where} కి మళ్ళీ వచ్చినందుకు సంతోషం.`
        : `${where} కి స్వాగతం.`
      : returning
        ? `Great to see you again at ${where}.`
        : `Welcome to ${where}.`,
    te(t)
      ? carsOnly
        ? 'కార్లకు ప్రొఫెషనల్ వాష్.'
        : bikesOnly
          ? 'బైక్‌లకు ప్రొఫెషనల్ వాష్.'
          : 'కార్లు, బైక్‌లకు ప్రొఫెషనల్ వాష్.'
      : carsOnly
        ? 'Professional car care.'
        : bikesOnly
          ? 'Professional bike care.'
          : 'Professional car and bike care.',
    ...(today || address || b.phone ? [''] : []),
    ...(today ? [today] : []),
    ...(address ? [`📍 ${address}`] : []),
    ...(b.phone ? [`📞 ${formatPhone(b.phone)}`] : []),
    '',
    say(t, 'How can we help you today?', 'మీకు ఎలా సహాయం చేయగలం?'),
  ].join('\n');
  return {
    type: 'buttons',
    ...(t.ctx.bannerUrl ? { imageUrl: t.ctx.bannerUrl } : {}),
    text,
    buttons: [
      servicesButton(t, b),
      directionsButton(t, b),
      { id: id('lang', b.id, te(t) ? 'en' : 'te'), title: te(t) ? '🌐 English' : '🌐 తెలుగు' },
    ],
  };
}

const welcomeMessages = (t: Turn, b: ChatBranch): ChatMessage[] => [welcome(t, b)];

/** More than one branch: which one first. */
function branchPicker(t: Turn): ChatMessage {
  return {
    type: 'list',
    text: [
      greeting(t),
      say(t, `Welcome to *${t.ctx.businessName}*.`, `*${t.ctx.businessName}* కి స్వాగతం.`),
      '',
      say(t, 'Which branch would you like?', 'ఏ బ్రాంచ్ కావాలి?'),
    ].join('\n'),
    button: say(t, 'Choose branch', 'బ్రాంచ్ ఎంచుకోండి'),
    title: say(t, 'Branches', 'బ్రాంచ్‌లు'),
    rows: t.ctx.branches.slice(0, WA_MAX_LIST_ROWS).map((b) => ({
      id: id('br', b.id),
      title: cut(b.name, WA_ROW_TITLE_MAX),
      description: cut([b.city, b.address].filter(Boolean).join(' · '), WA_ROW_DESCRIPTION_MAX) || undefined,
    })),
  };
}

function start(t: Turn): ChatMessage[] {
  return t.ctx.branches.length === 1 ? welcomeMessages(t, t.ctx.branches[0]!) : [branchPicker(t)];
}

// ─── Services & prices ───────────────────────────────────────────────────────

/** Car or Bike, or straight to the companies when the branch washes only one. */
function servicesReply(t: Turn, b: ChatBranch): ChatMessage[] {
  const cats = categoriesAt(b, t.edits);
  if (cats.length === 1) return [t.ctx.flows ? flowOpener(t, b, cats[0]!) : makeList(t, b, cats[0]!, 0)];
  if (cats.length === 0) {
    return [
      {
        type: 'buttons',
        text: say(
          t,
          `We're updating our price list right now. 🙏 Please call us or visit ${branchLine(t, b)} for today's prices.`,
          `మా ధరల జాబితా అప్‌డేట్ అవుతోంది. 🙏 ఈరోజు ధరల కోసం మాకు కాల్ చేయండి లేదా ${branchLine(t, b)} కి రండి.`,
        ),
        buttons: [talkButton(t, b), directionsButton(t, b)],
      },
    ];
  }
  return [
    {
      type: 'buttons',
      text: say(t, 'Which vehicle is it?', 'మీ వాహనం ఏది?'),
      buttons: [
        { id: id('cat', b.id, 'car'), title: say(t, '🚗 Car', '🚗 కార్') },
        { id: id('cat', b.id, 'bike'), title: say(t, '🏍️ Bike / Scooter', '🏍️ బైక్ / స్కూటర్') },
      ],
    },
  ];
}

function makeList(t: Turn, b: ChatBranch, category: VehicleCategory, page: number): ChatMessage {
  const makes = makesAt(b, category, t.edits);
  const from = page * PAGE_ROWS;
  const shown = makes.slice(from, from + PAGE_ROWS);
  const rows: ChatRow[] = shown.map((m) => ({ id: id('mo', b.id, category, m, 0), title: cut(m, WA_ROW_TITLE_MAX) }));
  if (from + PAGE_ROWS < makes.length) {
    const left = makes.length - from - PAGE_ROWS;
    rows.push({ id: id('mk', b.id, category, page + 1), title: say(t, 'More companies ›', 'మరిన్ని కంపెనీలు ›'), description: say(t, `${left} more`, `ఇంకా ${left}`) });
  }
  const bike = category === 'bike';
  return {
    type: 'list',
    text: te(t) ? `మీ ${bike ? 'బైక్ లేదా స్కూటర్' : 'కార్'} ఏ కంపెనీది?` : `Which company makes your ${bike ? 'bike or scooter' : 'car'}?`,
    button: say(t, 'Choose company', 'కంపెనీ ఎంచుకోండి'),
    title: page === 0 ? say(t, 'Companies', 'కంపెనీలు') : `${say(t, 'Companies', 'కంపెనీలు')} (${page + 1})`,
    rows,
  };
}

function modelList(t: Turn, b: ChatBranch, category: VehicleCategory, make: string, page: number): ChatMessage {
  const models = modelsAt(b, category, t.edits).filter((r) => r.make === make);
  const from = page * PAGE_ROWS;
  const shown = models.slice(from, from + PAGE_ROWS);
  const rows: ChatRow[] = shown.map((r) => ({
    id: pricesId(b, r.make, r.model),
    title: cut(r.model, WA_ROW_TITLE_MAX),
    description: bodyTypeDef(r.bodyKey)?.label,
  }));
  if (from + PAGE_ROWS < models.length) {
    const left = models.length - from - PAGE_ROWS;
    rows.push({ id: id('mo', b.id, category, make, page + 1), title: say(t, 'More models ›', 'మరిన్ని మోడల్స్ ›'), description: say(t, `${left} more`, `ఇంకా ${left}`) });
  }
  return {
    type: 'list',
    text: say(t, `Which *${make}* is it?`, `ఏ *${make}* మోడల్?`),
    button: say(t, 'Choose model', 'మోడల్ ఎంచుకోండి'),
    title: cut(page === 0 ? make : `${make} (${page + 1})`, WA_ROW_TITLE_MAX),
    rows,
  };
}

function afterPrices(t: Turn, b: ChatBranch): ChatButton[] {
  return [directionsButton(t, b), { id: id('home', b.id), title: say(t, '🔁 Another vehicle', '🔁 వేరే వాహనం') }, talkButton(t, b)];
}

/** "4 washes in a month" / "నెలలో 4 వాష్‌లు". */
function planSpan(t: Turn, washes: number, months: number): string {
  if (te(t)) return `${months === 1 ? 'నెలలో' : `${months} నెలల్లో`} ${washes} వాష్‌లు`;
  return `${washes} washes in ${months === 1 ? 'a month' : `${months} months`}`;
}

/** "12" → 1️⃣2️⃣. */
const keycap = (n: number) => [...String(n)].map((d) => `${d}\uFE0F\u20E3`).join('');

type PriceItem =
  | { kind: 'service'; name: string; popular: boolean; price: number; service: ChatBranch['services'][number] }
  | { kind: 'plan'; name: string; popular: boolean; price: number; listPrice: number; plan: ChatBranch['plans'][number] };

/** The model's vehicle type at the branch and what it can have there, numbered in this order. */
function priceItems(t: Turn, b: ChatBranch, make: string, model: string) {
  const type = chatVehicleType(b, make, model, t.edits);
  if (!type) return null;
  const services: PriceItem[] = b.services.flatMap((s) => {
    const p = s.prices.find((x) => x.vehicleTypeId === type.id && x.price > 0);
    return p ? [{ kind: 'service' as const, name: s.name, popular: s.popular, price: p.price, service: s }] : [];
  });
  const plans: PriceItem[] = b.plans.flatMap((p) => {
    const price = p.prices.find((x) => x.vehicleTypeId === type.id && x.total > 0);
    return price ? [{ kind: 'plan' as const, name: p.name, popular: p.popular, price: price.total, listPrice: price.listTotal, plan: p }] : [];
  });
  return { type, services, plans, items: [...services, ...plans] };
}

const pricesId = (b: ChatBranch, make: string, model: string) => id('pr', b.id, make, model);

/** That model's services and plans at the branch, numbered, or why there are none. */
function prices(t: Turn, b: ChatBranch, make: string, model: string): ChatMessage[] {
  const found = priceItems(t, b, make, model);
  if (!found || found.services.length === 0) {
    return [
      {
        type: 'buttons',
        text: say(
          t,
          `Sorry, we don't wash the *${make} ${model}* at ${branchLine(t, b)} yet. 🙏`,
          `క్షమించండి, ${branchLine(t, b)} లో *${make} ${model}* కి ఇంకా ధరలు లేవు. 🙏`,
        ),
        buttons: afterPrices(t, b),
      },
    ];
  }
  const { type, services, plans } = found;
  const line = (item: PriceItem, n: number) => {
    const star = item.popular ? ' ⭐' : '';
    if (item.kind === 'service') return `${keycap(n)} ${item.name}${star}: *${rupees(item.price)}*`;
    const saving = item.listPrice - item.price;
    const save = saving > 0 ? say(t, ` (save ${rupees(saving)})`, ` (${rupees(saving)} ఆదా)`) : '';
    return `${keycap(n)} ${item.name}${star}: ${planSpan(t, item.plan.washes, item.plan.months)}, *${rupees(item.price)}*${save}`;
  };
  const text = [
    `🚘 *${make} ${model}* · ${type.name}`,
    say(t, `Prices at ${branchLine(t, b)}`, `${branchLine(t, b)} ధరలు`),
    '',
    say(t, '🧽 *Washes*', '🧽 *వాష్‌లు*'),
    ...services.map((s, i) => line(s, i + 1)),
    ...(plans.length ? ['', say(t, '📅 *Wash plans*', '📅 *వాష్ ప్లాన్‌లు*'), ...plans.map((p, i) => line(p, services.length + i + 1))] : []),
    '',
    say(t, "👉 Reply with a number (like *1*) to see what's included.", '👉 ఏమేమి ఉంటాయో చూడటానికి నంబర్ పంపండి (ఉదా: *1*).'),
  ].join('\n');
  if (text.length <= WA_BUTTONS_BODY_MAX) return [{ type: 'buttons', text, buttons: afterPrices(t, b) }];
  return [
    { type: 'text', text },
    { type: 'buttons', text: say(t, 'Anything else?', 'ఇంకా ఏమైనా?'), buttons: afterPrices(t, b) },
  ];
}

/** "That's ₹436 a wash." */
const perWash = (t: Turn, total: number, washes: number) =>
  washes > 1 ? say(t, `💡 That's *${rupees(Math.round(total / washes / 100) * 100)}* a wash.`, `💡 ఒక్కో వాష్ *${rupees(Math.round(total / washes / 100) * 100)}* మాత్రమే.`) : null;

/** What's in item `n` of the model's price list. */
function details(t: Turn, b: ChatBranch, make: string, model: string, n: number): ChatMessage[] {
  const found = priceItems(t, b, make, model);
  if (!found) return prices(t, b, make, model);
  const back: ChatButton = { id: pricesId(b, make, model), title: say(t, '📋 All prices', '📋 అన్ని ధరలు') };
  const item = found.items[n - 1];
  if (!item) {
    return [
      {
        type: 'buttons',
        text: say(t, `Please pick a number from *1* to *${found.items.length}*. 🙏`, `దయచేసి *1* నుండి *${found.items.length}* లోపు నంబర్ పంపండి. 🙏`),
        buttons: [back, directionsButton(t, b), talkButton(t, b)],
      },
    ];
  }
  const head = [`${keycap(n)} *${item.name}*${item.popular ? ' ⭐' : ''}`];
  let body: string[];
  if (item.kind === 'service') {
    const s = item.service;
    const checklist = s.checklist ?? [];
    body = [
      `🚘 ${make} ${model} · *${rupees(item.price)}*`,
      ...(s.description ? ['', s.description] : []),
      ...(checklist.length ? ['', say(t, "✅ *What's included*", '✅ *ఇందులో ఉండేవి*'), ...checklist.map((c) => `• ${c}`)] : []),
      ...(s.durationMin ? ['', say(t, `⏱️ Takes about ${s.durationMin} minutes`, `⏱️ సుమారు ${s.durationMin} నిమిషాలు పడుతుంది`)] : []),
    ];
  } else {
    const p = item.plan;
    const saving = item.listPrice - item.price;
    const each = p.serviceName ? say(t, `${/^[AEIOU]/i.test(p.serviceName) ? 'an' : 'a'} *${p.serviceName}* each time`, `ప్రతిసారి *${p.serviceName}*`) : null;
    body = [
      `🚘 ${make} ${model} · *${rupees(item.price)}*${saving > 0 ? say(t, ` (save ${rupees(saving)})`, ` (${rupees(saving)} ఆదా)`) : ''}`,
      '',
      `📅 ${planSpan(t, p.washes, p.months)}${each ? `, ${each}` : ''}`,
      ...(p.upgrade ? [say(t, `✨ Every ${p.upgrade.every}th wash is ${/^[AEIOU]/i.test(p.upgrade.name) ? 'an' : 'a'} *${p.upgrade.name}*`, `✨ ప్రతి ${p.upgrade.every}వ వాష్ *${p.upgrade.name}*`)] : []),
      ...[perWash(t, item.price, p.washes)].filter((x): x is string => !!x),
      '',
      say(t, 'Buy it at the counter on your next visit.', 'మీ తదుపరి విజిట్‌లో కౌంటర్ వద్ద తీసుకోండి.'),
    ];
  }
  return [{ type: 'buttons', text: cut([...head, ...body].join('\n'), WA_BUTTONS_BODY_MAX), buttons: [back, directionsButton(t, b), talkButton(t, b)] }];
}

// ─── Location, talk, rate ───────────────────────────────────────────

function mapsLink(t: Turn, b: ChatBranch): string {
  if (b.location) return `https://www.google.com/maps/dir/?api=1&destination=${b.location.latitude},${b.location.longitude}`;
  const query = [placeName(t, b), b.address ?? b.city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** The pin (when the branch has one) and a button that opens directions in Google Maps. */
function directionsReply(t: Turn, b: ChatBranch): ChatMessage[] {
  const name = placeName(t, b);
  const today = todayLine(t, b.hours);
  const out: ChatMessage[] = [];
  if (b.location) {
    out.push({ type: 'location', latitude: b.location.latitude, longitude: b.location.longitude, name, address: b.address ?? b.city ?? '' });
  }
  out.push({
    type: 'link',
    text: [
      `📍 ${branchLine(t, b)}`,
      ...(b.address ? [b.address] : []),
      ...(today ? ['', today] : []),
      ...(b.phone ? [`📞 ${formatPhone(b.phone)}`] : []),
    ].join('\n'),
    button: say(t, 'Open in Google Maps', 'Maps లో తెరవండి'),
    url: mapsLink(t, b),
    footer: menuFooter(t),
  });
  return out;
}

function talkReply(t: Turn, b: ChatBranch): ChatMessage[] {
  const today = todayLine(t, b.hours);
  const address = b.address ?? b.city;
  if (!b.phone) {
    return [
      {
        type: 'text',
        text: say(
          t,
          `Please visit us at ${branchLine(t, b)}${b.address ? `, ${b.address}` : ''}. We'd love to help! 😊`,
          `దయచేసి ${branchLine(t, b)}${b.address ? `, ${b.address}` : ''} కి రండి. మీకు సహాయం చేయడం మాకు సంతోషం! 😊`,
        ),
      },
    ];
  }
  return [
    {
      type: 'text',
      text: [
        say(t, `📞 *Call us:* ${formatPhone(b.phone)}`, `📞 *మాకు కాల్ చేయండి:* ${formatPhone(b.phone)}`),
        ...(today ? [today] : []),
        ...(address ? ['', say(t, `📍 Or visit us: ${address}`, `📍 లేదా నేరుగా రండి: ${address}`)] : []),
      ].join('\n'),
    },
  ];
}

function rateReply(t: Turn, b: ChatBranch): ChatMessage[] {
  const thanks = say(t, `Thank you for choosing ${branchLine(t, b)}! 🙏`, `${branchLine(t, b)} ని ఎంచుకున్నందుకు ధన్యవాదాలు! 🙏`);
  if (!b.reviewUrl) return [{ type: 'text', text: `${thanks} ${say(t, 'See you next time! 🚿', 'మళ్ళీ కలుద్దాం! 🚿')}` }];
  return [
    {
      type: 'link',
      text: `${thanks}\n${say(t, 'A quick Google review helps a local business like ours a lot.', 'మీ Google రివ్యూ మా లాంటి స్థానిక వ్యాపారానికి చాలా సహాయం చేస్తుంది.')}`,
      button: say(t, '⭐ Write a review', '⭐ రివ్యూ రాయండి'),
      url: b.reviewUrl,
    },
  ];
}

/** "Thanks, our team will reply here", with the two things most people want meanwhile. */
function teamAck(t: Turn, b: ChatBranch): ChatMessage[] {
  return [
    {
      type: 'buttons',
      text: say(
        t,
        'Thanks for your message! 🙏 Our team will reply here shortly.\n\nMeanwhile, tap below for prices or directions.',
        'మీ సందేశానికి ధన్యవాదాలు! 🙏 మా టీమ్ త్వరలో ఇక్కడే జవాబు ఇస్తుంది.\n\nఈలోగా ధరలు లేదా దారి కోసం కింద నొక్కండి.',
      ),
      buttons: [servicesButton(t, b), directionsButton(t, b)],
    },
  ];
}

// ─── Typed model names ───────────────────────────────────────────────────────

/** Listed models the text names, best first: "swift", "maruti swift", "my car is a creta". */
export function findModels(text: string, rows: readonly VehicleGuideRow[]): VehicleGuideRow[] {
  const q = alnum(text);
  if (q.length < 2) return [];
  const exact = rows.filter((r) => alnum(r.model) === q || alnum(`${r.make}${r.model}`) === q);
  if (exact.length) return exact;
  // The text contains a model's whole name: keep the longest (so "swift dzire" beats "swift").
  const inText = rows.filter((r) => alnum(r.model).length >= 3 && q.includes(alnum(r.model)));
  if (inText.length) {
    const longest = Math.max(...inText.map((r) => alnum(r.model).length));
    return inText.filter((r) => alnum(r.model).length === longest);
  }
  if (q.length < 3) return [];
  return rows.filter((r) => alnum(r.model).includes(q) || alnum(`${r.make}${r.model}`).includes(q));
}

function typedModel(t: Turn, b: ChatBranch, text: string): { messages: ChatMessage[]; context?: string } | null {
  const washed = [...modelsAt(b, 'car', t.edits), ...modelsAt(b, 'bike', t.edits)];
  const found = findModels(text, washed);
  if (found.length === 1) {
    const { make, model } = found[0]!;
    return { messages: prices(t, b, make, model), context: pricesId(b, make, model) };
  }
  if (found.length > 1 && found.length <= WA_MAX_LIST_ROWS) {
    return {
      messages: [
        {
          type: 'list',
          text: say(t, 'Which one is yours?', 'మీది ఏది?'),
          button: say(t, 'Choose model', 'మోడల్ ఎంచుకోండి'),
          title: say(t, 'Models', 'మోడల్స్'),
          rows: found.map((r) => ({
            id: pricesId(b, r.make, r.model),
            title: cut(r.model, WA_ROW_TITLE_MAX),
            description: cut(`${r.make} · ${bodyTypeDef(r.bodyKey)?.label ?? ''}`.replace(/ · $/, ''), WA_ROW_DESCRIPTION_MAX),
          })),
        },
      ],
    };
  }
  if (found.length > WA_MAX_LIST_ROWS) {
    return {
      messages: [
        {
          type: 'text',
          text: say(
            t,
            `There are a lot of models matching “${cut(text.trim(), 30)}”. Pick from the list instead:`,
            `“${cut(text.trim(), 30)}” కి చాలా మోడల్స్ ఉన్నాయి. జాబితా నుండి ఎంచుకోండి:`,
          ),
        },
        ...servicesReply(t, b),
      ],
    };
  }
  return null;
}

// ─── The Services & Prices Flow ──────────────────────────────────────────────

/** Which branch, vehicle and language a Flow was opened for. */
export const chatFlowToken = (branchId: string, category: VehicleCategory, lang: ChatLang) => id('flow', branchId, category, lang);

function parseFlowToken(token: string | undefined) {
  const [kind, branchId, category, lang] = (token ?? '').split('|');
  if (kind !== 'flow' || !branchId) return null;
  return { branchId, category: (category === 'bike' ? 'bike' : 'car') as VehicleCategory, lang: (lang === 'te' ? 'te' : 'en') as ChatLang };
}

function flowOpener(t: Turn, b: ChatBranch, category: VehicleCategory): ChatMessage {
  const bike = category === 'bike';
  return {
    type: 'flow',
    text: te(t)
      ? `మీ ${bike ? 'బైక్ లేదా స్కూటర్' : 'కార్'} కంపెనీ, మోడల్ ఎంచుకోండి. ఆ మోడల్ ధరలు, ప్లాన్‌లు చూపిస్తాం. 👇`
      : `Pick your ${bike ? 'bike or scooter' : 'car'}'s company and model, and we'll show its prices and plans. 👇`,
    button: te(t) ? (bike ? 'బైక్ ఎంచుకోండి' : 'కార్ ఎంచుకోండి') : bike ? 'Choose your bike' : 'Choose your car',
    token: chatFlowToken(b.id, category, t.lang),
  };
}

/** WhatsApp's RichText markdown for a model's price list (bold is **…**, lists are numbered). */
function flowPrices(t: Turn, b: ChatBranch, make: string, model: string): string {
  const found = priceItems(t, b, make, model);
  if (!found || !found.services.length) {
    return say(t, `# ${make} ${model}\nSorry, we don't wash this one at ${placeName(t, b)} yet.`, `# ${make} ${model}\nక్షమించండి, దీనికి ఇంకా ధరలు లేవు.`);
  }
  const line = (item: PriceItem, n: number) => {
    const star = item.popular ? ' ⭐' : '';
    if (item.kind === 'service') return `${n}. **${item.name}**${star} — ${rupees(item.price)}`;
    const saving = item.listPrice - item.price;
    const save = saving > 0 ? say(t, ` · save ${rupees(saving)}`, ` · ${rupees(saving)} ఆదా`) : '';
    return `${n}. **${item.name}**${star} — ${rupees(item.price)} · ${planSpan(t, item.plan.washes, item.plan.months)}${save}`;
  };
  const { type, services, plans } = found;
  return [
    `# 🚘 ${make} ${model}`,
    `${type.name} · ${placeName(t, b)}${b.city ? `, ${b.city}` : ''}`,
    '',
    say(t, '## 🧽 Washes', '## 🧽 వాష్‌లు'),
    ...services.map((s, i) => line(s, i + 1)),
    ...(plans.length ? ['', say(t, '## 📅 Wash plans', '## 📅 వాష్ ప్లాన్‌లు'), ...plans.map((p, i) => line(p, services.length + i + 1))] : []),
    '',
    say(t, "Tap below to get this in chat, then reply with a number to see what's included.", 'దీన్ని చాట్‌లో పొందండి, తర్వాత వివరాల కోసం నంబర్ పంపండి.'),
  ].join('\n');
}

/** A decrypted request from the Flow, as WhatsApp sends it to our endpoint. */
export interface ChatFlowRequest {
  action: string;
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
}

/**
 * The next screen for a Flow request: the companies (with `logos`, base64 PNGs by company) when
 * it opens, that company's models, then the model's prices. `{ data }` alone answers a health
 * check or an error report.
 */
export function chatFlowReply(
  req: ChatFlowRequest,
  ctx: ChatContext,
  logos: Readonly<Record<string, string>> = {},
): { screen?: string; data: Record<string, unknown> } {
  if (req.action === 'ping') return { data: { status: 'active' } };
  if (req.data && 'error' in req.data) return { data: { acknowledged: true } };
  const token = parseFlowToken(req.flow_token);
  const b = (token && branchOf(ctx, token.branchId)) ?? ctx.branches[0];
  const lang = token?.lang ?? 'en';
  const category = token?.category ?? 'car';
  const t: Turn = { ctx, lang, now: ctx.now ?? new Date(), edits: ctx.edits ?? [] };
  if (!b) return { screen: 'PRICES', data: { company: '', model: '', prices: say(t, 'Prices are coming soon. 🙏', 'ధరలు త్వరలో. 🙏'), done: say(t, 'Close', 'మూసివేయి') } };
  const bike = category === 'bike';
  const companies = () => ({
    screen: 'COMPANY',
    data: {
      heading: te(t) ? `మీ ${bike ? 'బైక్' : 'కార్'} ఏ కంపెనీది?` : `Which company makes your ${bike ? 'bike or scooter' : 'car'}?`,
      label: say(t, 'Company', 'కంపెనీ'),
      next: say(t, 'Next', 'తదుపరి'),
      companies: makesAt(b, category, t.edits)
        .slice(0, 100)
        .map((m) => ({ id: m, title: cut(m, 30), ...(logos[m] ? { image: logos[m], 'alt-text': `${m} logo` } : {}) })),
    },
  });
  const step = typeof req.data?.step === 'string' ? req.data.step : null;
  const company = typeof req.data?.company === 'string' ? req.data.company : '';
  const model = typeof req.data?.model === 'string' ? req.data.model : '';
  if (req.action === 'INIT' || !step || !company) return companies();
  if (step === 'company') {
    const models = modelsAt(b, category, t.edits).filter((r) => r.make === company);
    if (!models.length) return companies();
    return {
      screen: 'MODEL',
      data: {
        heading: say(t, `Which ${company} is it?`, `ఏ ${company} మోడల్?`),
        label: say(t, 'Model', 'మోడల్'),
        next: say(t, 'See prices', 'ధరలు చూడండి'),
        company,
        models: models.slice(0, 200).map((r) => ({ id: r.model, title: cut(r.model, 30), description: bodyTypeDef(r.bodyKey)?.label ?? '' })),
      },
    };
  }
  return {
    screen: 'PRICES',
    data: { company, model, prices: flowPrices(t, b, company, model), done: say(t, 'Get this in chat', 'చాట్‌లో పొందండి') },
  };
}

/** The finished Flow (its reply in the chat): the choice that sends that model's price list. */
export function chatFlowChoice(responseJson: string): string | null {
  try {
    const r = JSON.parse(responseJson) as { company?: unknown; model?: unknown; flow_token?: unknown };
    const token = parseFlowToken(typeof r.flow_token === 'string' ? r.flow_token : undefined);
    if (!token || typeof r.company !== 'string' || typeof r.model !== 'string' || !r.company || !r.model) return null;
    return id('pr', token.branchId, r.company, r.model);
  } catch {
    return null;
  }
}

// ─── The reply ───────────────────────────────────────────────────────────────

function branchOf(ctx: ChatContext, branchId: string | undefined): ChatBranch | null {
  return ctx.branches.find((b) => b.id === branchId) ?? null;
}

/** What to send back for one message from a customer. */
export function chatReply(input: ChatInput, ctx: ChatContext): ChatResult {
  const known = ctx.person?.lang ?? null;
  let lang: ChatLang = known ?? 'en';
  let switched: ChatLang | undefined;
  const switchTo = (l: ChatLang) => {
    lang = l;
    if (l !== known) switched = l;
  };
  if (input.kind === 'text') {
    const word = input.text.trim().toLowerCase();
    if (TELUGU_WORDS.has(word)) switchTo('te');
    else if (ENGLISH_WORDS.has(word)) switchTo('en');
    else if (chatLanguageOf(input.text)) switchTo('te');
  } else if (input.kind === 'choice' && input.id.startsWith('lang|')) {
    switchTo(input.id.endsWith('|te') ? 'te' : 'en');
  }
  const t: Turn = { ctx, lang, now: ctx.now ?? new Date(), edits: ctx.edits ?? [] };
  const done = (messages: ChatMessage[], marketing?: ChatResult['marketing'], context?: string): ChatResult => ({
    messages,
    ...(marketing ? { marketing } : {}),
    ...(switched ? { lang: switched } : {}),
    ...(context ? { context } : {}),
  });
  /** A model's price list, remembered so a number can pick from it. */
  const priceList = (b: ChatBranch, make: string, model: string) => done(prices(t, b, make, model), undefined, pricesId(b, make, model));

  if (ctx.branches.length === 0) {
    return done([
      {
        type: 'text',
        text: say(t, `Thank you for contacting *${ctx.businessName}*. We'll be open for bookings soon! 🙏`, `*${ctx.businessName}* ని సంప్రదించినందుకు ధన్యవాదాలు. త్వరలో ప్రారంభిస్తాం! 🙏`),
      },
    ]);
  }
  const only = ctx.branches.length === 1 ? ctx.branches[0]! : null;

  // A teammate is talking with them: their typed messages and photos go to the inbox in silence.
  if (input.kind !== 'choice' && ctx.person?.paused) return { messages: [], forTeam: true, ...(switched ? { lang: switched } : {}) };
  if (input.kind === 'media') return { ...done(teamAck(t, only ?? ctx.branches[0]!)), forTeam: true };
  // The Stop offers / Start offers buttons on our offer messages.
  if (input.kind === 'choice' && /^(stop|start)$/i.test(input.id)) return chatReply({ kind: 'text', text: input.id }, ctx);

  if (input.kind === 'text') {
    const text = input.text.trim();
    const lower = text.toLowerCase().replace(/[.!]+$/, '');
    if (STOP_WORDS.has(lower)) {
      return done(
        [
          {
            type: 'text',
            text: say(
              t,
              "Done ✅ You won't get offers or reminders from us any more. Bills for your washes will still come here. Send *START* to turn offers back on.",
              'సరే ✅ ఇకపై మా నుండి ఆఫర్లు, రిమైండర్లు రావు. మీ వాష్ బిల్లులు మాత్రం ఇక్కడే వస్తాయి. మళ్ళీ కావాలంటే *START* పంపండి.',
            ),
          },
        ],
        'stop',
      );
    }
    if (START_WORDS.has(lower)) {
      return done(
        [
          {
            type: 'text',
            text: say(
              t,
              "You're back on our list ✅ We'll send you offers and wash reminders now and then. Send *STOP* any time.",
              'మళ్ళీ మా జాబితాలో చేరారు ✅ అప్పుడప్పుడు ఆఫర్లు, వాష్ రిమైండర్లు పంపుతాం. ఎప్పుడైనా *STOP* పంపండి.',
            ),
          },
          ...start(t),
        ],
        'start',
      );
    }
    // A number after a price list: what's in that service or plan.
    const pick = /^\d{1,2}$/.test(text) ? Number(text) : null;
    const seen = ctx.person?.context?.split('|');
    if (pick && seen?.[0] === 'pr') {
      const pb = branchOf(ctx, seen[1]) ?? only;
      if (pb) return done(details(t, pb, seen[2] ?? '', seen[3] ?? '', pick));
    }
    if (THANKS.test(text)) {
      return done([{ type: 'text', text: say(t, "You're welcome! 😊 Send *Hi* any time for our prices.", 'సంతోషం! 😊 మా ధరల కోసం ఎప్పుడైనా *Hi* పంపండి.') }]);
    }
    if (only && text && !switched) {
      const found = typedModel(t, only, text);
      if (found) return done(found.messages, undefined, found.context);
    }
    const plain = lower.replace(/[^\p{L}\p{M}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!plain || plain.length <= 2 || GREETING.test(plain)) return done(start(t));
    // A real question ("do you wash tractors?"): a person answers it from the inbox.
    return { ...done(teamAck(t, only ?? ctx.branches[0]!)), forTeam: true };
  }

  const [kind, branchId, ...rest] = input.id.split('|');
  const b = branchOf(ctx, branchId) ?? only;
  if (!b) return done(start(t));
  const category: VehicleCategory = rest[0] === 'bike' ? 'bike' : 'car';
  switch (kind) {
    case 'br':
    case 'lang':
      return done(welcomeMessages(t, b));
    case 'svc':
    case 'home':
      return done(servicesReply(t, b));
    case 'cat':
      return done([ctx.flows ? flowOpener(t, b, category) : makeList(t, b, category, 0)]);
    case 'mk':
      return done([makeList(t, b, category, Number(rest[1]) || 0)]);
    case 'mo':
      return done([modelList(t, b, category, rest[1] ?? '', Number(rest[2]) || 0)]);
    case 'pr':
      return priceList(b, rest[0] ?? '', rest[1] ?? '');
    case 'loc':
      return done(directionsReply(t, b));
    case 'talk':
      return done(talkReply(t, b));
    case 'rate':
      return done(rateReply(t, b));
    default:
      return done(start(t));
  }
}
