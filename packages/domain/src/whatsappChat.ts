import { clockMinutes, formatClock, hoursSummary, offDaysOf, WEEKDAY_LABELS, type OpeningHours } from './customerApp';
import type { VehicleCategory } from './types';
import { bodyTypeDef, bodyTypeForName } from './vehicleCatalog';
import { VEHICLE_MAKES, vehicleGuideRows, vehicleTypeKeysFor, type VehicleGuideRow, type VehicleModelEdit } from './vehicleMakes';

/**
 * The WhatsApp assistant on the business number. "Hi" gets the welcome: the banner, a greeting by
 * name with today's hours, and Services & Prices / Get Directions / తెలుగు, then a More options
 * list (rate us, talk to us, timings, plans, language). Services & Prices walks Car or Bike →
 * company → model to that model's hub prices; typing a model ("swift", "activa") jumps straight
 * there. Everything is in English or Telugu, whichever the customer picked or writes in. Pure: the
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
  services: { id: string; name: string; popular: boolean; prices: { vehicleTypeId: string; price: number }[] }[];
  /** Wash plans sold at the shop, prices in paise. */
  plans: {
    name: string;
    washes: number;
    months: number;
    popular: boolean;
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
}

export type ChatInput = { kind: 'text'; text: string } | { kind: 'choice'; id: string };

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
  | { type: 'location'; latitude: number; longitude: number; name: string; address: string };

export interface ChatResult {
  messages: ChatMessage[];
  /** The customer asked for no more offers and reminders (STOP), or asked for them again (START). */
  marketing?: 'stop' | 'start';
  /** The language to answer this customer in from now on, when it changed. */
  lang?: ChatLang;
}

const STOP_WORDS = new Set(['stop', 'unsubscribe', 'stop offers', 'no offers', 'opt out', 'optout']);
const START_WORDS = new Set(['start', 'subscribe', 'opt in', 'optin']);
const THANKS =
  /^(thanks?( you)?|thank u|thx|ty|ok(ay)?|k|👍|🙏|super|great|nice|good|ధన్యవాదాలు|థాంక్స్|థ్యాంక్స్|సరే)(\s|[.!]|🙏|👍|😊)*$/iu;
const TELUGU_SCRIPT = /[ఀ-౿]/u;
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

/** "7 am – 8 pm · closed Sundays", in the customer's language. */
function weekHours(t: Turn, h: OpeningHours): string | null {
  if (!te(t)) return hoursSummary(h);
  const range = hoursRange(t, h);
  if (!range) return null;
  const off = offDaysOf(h).map((d) => TE_WEEKDAYS[d]);
  return off.length ? `${range} · ${off.join(', ')} సెలవు` : `${range} · ప్రతి రోజు`;
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
    ...(today || address ? [''] : []),
    ...(today ? [today] : []),
    ...(address ? [`📍 ${address}`] : []),
    '',
    say(t, 'How can we help you today?', 'మీకు ఎలా సహాయం చేయగలం?'),
  ].join('\n');
  const example = bikesOnly ? 'Activa' : cats.includes('bike') ? say(t, 'Swift or Activa', 'Swift') : say(t, 'Swift or Creta', 'Swift');
  return {
    type: 'buttons',
    ...(t.ctx.bannerUrl ? { imageUrl: t.ctx.bannerUrl } : {}),
    text,
    footer: say(t, `Tip: type your model, like ${example}`, `చిట్కా: మీ మోడల్ టైప్ చేయండి, ఉదా: ${example}`),
    buttons: [
      servicesButton(t, b),
      directionsButton(t, b),
      { id: id('lang', b.id, te(t) ? 'en' : 'te'), title: te(t) ? '🌐 English' : '🌐 తెలుగు' },
    ],
  };
}

/** The second message: everything else, in one list. */
function moreOptions(t: Turn, b: ChatBranch): ChatMessage {
  const week = weekHours(t, b.hours);
  const rows: ChatRow[] = [
    ...(b.reviewUrl
      ? [{ id: id('rate', b.id), title: say(t, '⭐ Rate us on Google', '⭐ Google లో రేట్ చేయండి'), description: say(t, 'Tell us how we did', 'మా సేవ ఎలా ఉందో చెప్పండి') }]
      : []),
    {
      id: id('talk', b.id),
      title: say(t, '📞 Talk to us', '📞 మాతో మాట్లాడండి'),
      description: b.phone
        ? say(t, `Call ${formatPhone(b.phone)}`, `కాల్ చేయండి: ${formatPhone(b.phone)}`)
        : say(t, 'Visit us at the shop', 'షాప్‌కి నేరుగా రండి'),
    },
    ...(week ? [{ id: id('hrs', b.id), title: say(t, '🕗 Timings', '🕗 టైమింగ్స్'), description: cut(week, WA_ROW_DESCRIPTION_MAX) }] : []),
    ...(b.plans.length
      ? [{ id: id('pln', b.id), title: say(t, '🎁 Offers & plans', '🎁 ఆఫర్లు & ప్లాన్‌లు'), description: say(t, 'Monthly wash plans that save you money', 'డబ్బు ఆదా చేసే నెలవారీ వాష్ ప్లాన్‌లు') }]
      : []),
    { id: id('lang', b.id, te(t) ? 'en' : 'te'), title: '🌐 Language / భాష', description: 'English · తెలుగు' },
  ];
  return {
    type: 'list',
    text: say(t, 'Anything else? Tap *More options* 👇', 'ఇంకా ఏమైనా కావాలా? *మరిన్ని* నొక్కండి 👇'),
    button: say(t, 'More options', 'మరిన్ని ఆప్షన్లు'),
    title: cut(placeName(t, b), WA_ROW_TITLE_MAX),
    rows,
  };
}

const welcomeMessages = (t: Turn, b: ChatBranch): ChatMessage[] => [welcome(t, b), moreOptions(t, b)];

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
  if (cats.length === 1) return [makeList(t, b, cats[0]!, 0)];
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
      text: say(t, 'Which vehicle is it?\n\n_Or just type the model name, like *Swift* or *Activa*._', 'మీ వాహనం ఏది?\n\n_లేదా మోడల్ పేరు టైప్ చేయండి, ఉదా: *Swift*, *Activa*._'),
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
    text: te(t)
      ? `మీ ${bike ? 'బైక్ లేదా స్కూటర్' : 'కార్'} ఏ కంపెనీది?\n\n_లేదా మోడల్ పేరు టైప్ చేయండి._`
      : `Which company makes your ${bike ? 'bike or scooter' : 'car'}?\n\n_Or just type the model name._`,
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
    id: id('pr', b.id, r.make, r.model),
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

/** That model's services and plans at the branch, or why there are none. */
function prices(t: Turn, b: ChatBranch, make: string, model: string): ChatMessage[] {
  const type = chatVehicleType(b, make, model, t.edits);
  const services = type
    ? b.services.flatMap((s) => {
        const p = s.prices.find((x) => x.vehicleTypeId === type.id && x.price > 0);
        return p ? [{ name: s.name, popular: s.popular, price: p.price }] : [];
      })
    : [];
  if (!type || services.length === 0) {
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
  const plans = b.plans.flatMap((p) => {
    const price = p.prices.find((x) => x.vehicleTypeId === type.id);
    return price ? [{ ...p, price }] : [];
  });
  const hours = weekHours(t, b.hours);
  const text = [
    `🚘 *${make} ${model}* · ${type.name}`,
    say(t, `Prices at ${branchLine(t, b)}`, `${branchLine(t, b)} ధరలు`),
    '',
    ...services.map((s) => `• ${s.name}${s.popular ? ' ⭐' : ''}: *${rupees(s.price)}*`),
    ...(plans.length
      ? [
          '',
          say(t, '📅 *Wash plans*', '📅 *వాష్ ప్లాన్‌లు*'),
          ...plans.map((p) => {
            const saving = p.price.listTotal - p.price.total;
            const save = saving > 0 ? say(t, ` (save ${rupees(saving)})`, ` (${rupees(saving)} ఆదా)`) : '';
            return `• ${p.name}${p.popular ? ' ⭐' : ''}: ${planSpan(t, p.washes, p.months)}, *${rupees(p.price.total)}*${save}`;
          }),
        ]
      : []),
    ...(hours ? ['', `🕒 ${hours}`] : []),
  ].join('\n');
  if (text.length <= WA_BUTTONS_BODY_MAX) return [{ type: 'buttons', text, buttons: afterPrices(t, b) }];
  return [
    { type: 'text', text },
    { type: 'buttons', text: say(t, 'Anything else?', 'ఇంకా ఏమైనా?'), buttons: afterPrices(t, b) },
  ];
}

/** Every plan, from its lowest price, before the customer has picked a vehicle. */
function plansReply(t: Turn, b: ChatBranch): ChatMessage[] {
  const lines = b.plans.flatMap((p) => {
    const totals = p.prices.filter((x) => x.total > 0);
    if (!totals.length) return [];
    const from = Math.min(...totals.map((x) => x.total));
    const most = Math.max(...totals.map((x) => x.listTotal - x.total));
    const save = most > 0 ? say(t, ` (save up to ${rupees(most)})`, ` (${rupees(most)} వరకు ఆదా)`) : '';
    return [`• ${p.name}${p.popular ? ' ⭐' : ''}: ${planSpan(t, p.washes, p.months)}, ${say(t, `from *${rupees(from)}*`, `*${rupees(from)}* నుండి`)}${save}`];
  });
  if (!lines.length) {
    return [
      {
        type: 'buttons',
        text: say(t, 'No offers running right now. Check back soon! 🙏', 'ప్రస్తుతం ఆఫర్లు ఏమీ లేవు. త్వరలో మళ్ళీ చూడండి! 🙏'),
        buttons: [servicesButton(t, b), directionsButton(t, b)],
      },
    ];
  }
  const text = [
    say(t, '🎁 *Wash plans*', '🎁 *వాష్ ప్లాన్‌లు*'),
    say(t, 'Pay once, wash all month and save.', 'ఒకసారి కట్టండి, నెలంతా వాష్ చేయించుకోండి, డబ్బు ఆదా చేయండి.'),
    '',
    ...lines,
    '',
    say(t, 'Pick your vehicle to see its exact price 👇', 'మీ వాహనం ఎంచుకుంటే సరైన ధర చూపిస్తాం 👇'),
  ].join('\n');
  return [{ type: 'buttons', text: cut(text, WA_BUTTONS_BODY_MAX), buttons: [servicesButton(t, b), directionsButton(t, b), talkButton(t, b)] }];
}

// ─── Location, timings, talk, rate ───────────────────────────────────────────

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

function hoursReply(t: Turn, b: ChatBranch): ChatMessage[] {
  const week = weekHours(t, b.hours);
  const today = todayLine(t, b.hours);
  return [
    {
      type: 'buttons',
      text: week
        ? [say(t, `🕗 *Timings at ${placeName(t, b)}*`, `🕗 *${placeName(t, b)} టైమింగ్స్*`), week, ...(today ? ['', today] : [])].join('\n')
        : say(t, 'Please call us for our timings. 🙏', 'మా టైమింగ్స్ కోసం మాకు కాల్ చేయండి. 🙏'),
      buttons: [servicesButton(t, b), directionsButton(t, b), talkButton(t, b)],
    },
  ];
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

function typedModel(t: Turn, b: ChatBranch, text: string): ChatMessage[] | null {
  const washed = [...modelsAt(b, 'car', t.edits), ...modelsAt(b, 'bike', t.edits)];
  const found = findModels(text, washed);
  if (found.length === 1) return prices(t, b, found[0]!.make, found[0]!.model);
  if (found.length > 1 && found.length <= WA_MAX_LIST_ROWS) {
    return [
      {
        type: 'list',
        text: say(t, 'Which one is yours?', 'మీది ఏది?'),
        button: say(t, 'Choose model', 'మోడల్ ఎంచుకోండి'),
        title: say(t, 'Models', 'మోడల్స్'),
        rows: found.map((r) => ({
          id: id('pr', b.id, r.make, r.model),
          title: cut(r.model, WA_ROW_TITLE_MAX),
          description: cut(`${r.make} · ${bodyTypeDef(r.bodyKey)?.label ?? ''}`.replace(/ · $/, ''), WA_ROW_DESCRIPTION_MAX),
        })),
      },
    ];
  }
  if (found.length > WA_MAX_LIST_ROWS) {
    return [
      {
        type: 'text',
        text: say(
          t,
          `There are a lot of models matching “${cut(text.trim(), 30)}”. Pick from the list instead:`,
          `“${cut(text.trim(), 30)}” కి చాలా మోడల్స్ ఉన్నాయి. జాబితా నుండి ఎంచుకోండి:`,
        ),
      },
      ...servicesReply(t, b),
    ];
  }
  return null;
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
  } else if (input.id.startsWith('lang|')) {
    switchTo(input.id.endsWith('|te') ? 'te' : 'en');
  }
  const t: Turn = { ctx, lang, now: ctx.now ?? new Date(), edits: ctx.edits ?? [] };
  const done = (messages: ChatMessage[], marketing?: ChatResult['marketing']): ChatResult => ({
    messages,
    ...(marketing ? { marketing } : {}),
    ...(switched ? { lang: switched } : {}),
  });

  if (ctx.branches.length === 0) {
    return done([
      {
        type: 'text',
        text: say(t, `Thank you for contacting *${ctx.businessName}*. We'll be open for bookings soon! 🙏`, `*${ctx.businessName}* ని సంప్రదించినందుకు ధన్యవాదాలు. త్వరలో ప్రారంభిస్తాం! 🙏`),
      },
    ]);
  }
  const only = ctx.branches.length === 1 ? ctx.branches[0]! : null;

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
    if (THANKS.test(text)) {
      return done([{ type: 'text', text: say(t, "You're welcome! 😊 Send *Hi* any time for our prices.", 'సంతోషం! 😊 మా ధరల కోసం ఎప్పుడైనా *Hi* పంపండి.') }]);
    }
    if (only && text && !switched) {
      const found = typedModel(t, only, text);
      if (found) return done(found);
    }
    return done(start(t));
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
      return done([makeList(t, b, category, 0)]);
    case 'mk':
      return done([makeList(t, b, category, Number(rest[1]) || 0)]);
    case 'mo':
      return done([modelList(t, b, category, rest[1] ?? '', Number(rest[2]) || 0)]);
    case 'pr':
      return done(prices(t, b, rest[0] ?? '', rest[1] ?? ''));
    case 'loc':
      return done(directionsReply(t, b));
    case 'hrs':
      return done(hoursReply(t, b));
    case 'pln':
      return done(plansReply(t, b));
    case 'talk':
      return done(talkReply(t, b));
    case 'rate':
      return done(rateReply(t, b));
    default:
      return done(start(t));
  }
}
