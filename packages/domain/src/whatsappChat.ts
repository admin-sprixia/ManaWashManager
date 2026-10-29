import { clockMinutes, formatClock, offDaysOf, WEEKDAY_LABELS, type OpeningHours } from './customerApp';
import type { VehicleCategory } from './types';
import { PRICE_SIZES, priceSize, priceSizeOfBody, type PriceSize } from './priceSizes';
import type { ServiceKind } from './serviceNetwork';
import { bodyTypeDef, bodyTypeForName } from './vehicleCatalog';
import { VEHICLE_MAKES, vehicleGuideRows, vehicleTypeKeysFor, type VehicleGuideRow, type VehicleModelEdit } from './vehicleMakes';

/**
 * The WhatsApp assistant on the business number. "Hi" gets the welcome: the banner, a greeting by
 * name, today's hours, the address and phone, and Car prices / Bike prices / Get Directions.
 * Prices go by size (see priceSizes.ts): Car prices lists Small, Mid-size and Large with
 * well-known models, and a size shows its washes, the Premium Care add-on and monthly plans,
 * numbered; a number shows what's included, PLANS the 3- and 12-month plans. "Not sure?" walks
 * company → model ("Brezza is a Mid-size car"), and a typed model name works too. Everything is
 * in English or Telugu: writing in Telugu (or "తెలుగు") switches. Pure: the API feeds in the
 * branches, who's writing and what they sent, and sends back what this returns.
 *
 * Every button and list row carries everything the next step needs in its id
 * ("sz|<branch>|large", "pr|<branch>|Maruti Suzuki|Brezza"), so the assistant keeps no
 * conversation state beyond the customer's language and the last list they saw, which the API
 * stores.
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
    /** Add-ons are listed apart, as "+₹249 with any wash". */
    kind?: ServiceKind;
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
  /** The list they saw last ("sz|<branch>|large", "pr|<branch>|<make>|<model>", "pl|…"), so a number picks from it. */
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
/** Asks for the wash plans of the last price list. */
const PLAN_WORDS = new Set(['plan', 'plans', 'monthly plan', 'monthly plans', 'wash plan', 'wash plans', 'ప్లాన్', 'ప్లాన్లు', 'ప్లాన్‌లు']);
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

type VehicleType = ChatBranch['vehicleTypes'][number];
type Service = ChatBranch['services'][number];
type Plan = ChatBranch['plans'][number];

/** A vehicle type's catalog key: its linked body type, else what its name suggests. */
function typeKey(t: VehicleType): string | null {
  return t.bodyKey ?? bodyTypeForName(t.name)?.key ?? null;
}

/** The branch's vehicle type for a listed model (Swift → Hatchback), best fit first. */
export function chatVehicleType(
  branch: ChatBranch,
  make: string,
  model: string,
  edits: readonly VehicleModelEdit[] = [],
): VehicleType | null {
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

/** The vehicle type that stands for a size's prices at the branch: its first priced body type. */
function sizeType(b: ChatBranch, size: PriceSize): VehicleType | null {
  for (const key of size.bodyKeys) {
    const match = b.vehicleTypes.find((v) => typeKey(v) === key && priced(b, v.id));
    if (match) return match;
  }
  return null;
}

/** The sizes the branch has prices for, in one category. */
function sizesAt(b: ChatBranch, category: VehicleCategory): PriceSize[] {
  return PRICE_SIZES.filter((s) => s.category === category && sizeType(b, s));
}

/** The categories the branch has prices for, cars first. */
function categoriesAt(b: ChatBranch, edits: readonly VehicleModelEdit[]): VehicleCategory[] {
  return (['car', 'bike'] as const).filter((c) => sizesAt(b, c).length > 0 || modelsAt(b, c, edits).length > 0);
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

/** "3 & 12", "3, 6 & 12". */
function joinAnd(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`;
}

const sizeName = (t: Turn, s: PriceSize) => (te(t) ? s.te.name : s.name);

const categoryButton = (t: Turn, b: ChatBranch, category: VehicleCategory): ChatButton =>
  category === 'bike'
    ? { id: id('cat', b.id, 'bike'), title: say(t, '🏍️ Bike prices', '🏍️ బైక్ ధరలు') }
    : { id: id('cat', b.id, 'car'), title: say(t, '🚗 Car prices', '🚗 కార్ ధరలు') };
const directionsButton = (t: Turn, b: ChatBranch): ChatButton => ({ id: id('loc', b.id), title: say(t, '📍 Get Directions', '📍 దారి చూపించు') });
const talkButton = (t: Turn, b: ChatBranch): ChatButton => ({ id: id('talk', b.id), title: say(t, '📞 Talk to us', '📞 మాతో మాట్లాడండి') });
const menuFooter = (t: Turn) => say(t, 'Send Hi any time for the menu', 'మెనూ కోసం ఎప్పుడైనా Hi పంపండి');

/** Car prices and Bike prices (whichever the branch has), Get Directions, and Talk to us if there's room. */
function mainButtons(t: Turn, b: ChatBranch): ChatButton[] {
  const cats = categoriesAt(b, t.edits);
  return [...cats.map((c) => categoryButton(t, b, c)), directionsButton(t, b), talkButton(t, b)].slice(0, WA_MAX_BUTTONS);
}

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

/**
 * The banner, a greeting with today's hours, and Car prices / Bike prices / Get Directions.
 * There's no language button: a line says how to switch, and writing in Telugu switches anyway.
 */
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
    say(t, '(తెలుగు కోసం "తెలుగు" అని టైప్ చేయండి)', '(For English, type "English")'),
  ].join('\n');
  return {
    type: 'buttons',
    ...(t.ctx.bannerUrl ? { imageUrl: t.ctx.bannerUrl } : {}),
    text,
    buttons: mainButtons(t, b),
  };
}

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
  return t.ctx.branches.length === 1 ? [welcome(t, t.ctx.branches[0]!)] : [branchPicker(t)];
}

// ─── Car prices / Bike prices ────────────────────────────────────────────────

/** Car or Bike when the branch washes both, else straight to that one's sizes. */
function servicesReply(t: Turn, b: ChatBranch): ChatMessage[] {
  const cats = categoriesAt(b, t.edits);
  if (cats.length === 1) return categoryReply(t, b, cats[0]!);
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
      text: say(t, 'Which prices would you like to see?', 'ఏ ధరలు చూడాలి?'),
      buttons: [categoryButton(t, b, 'car'), categoryButton(t, b, 'bike')],
    },
  ];
}

/** Car prices / Bike prices: the sizes with well-known models, and "Not sure?" to find a model. */
function categoryReply(t: Turn, b: ChatBranch, category: VehicleCategory): ChatMessage[] {
  const sizes = sizesAt(b, category);
  if (!sizes.length) return [findReply(t, b, category)];
  const bike = category === 'bike';
  const rows: ChatRow[] = sizes.map((s) => ({
    id: id('sz', b.id, s.key),
    title: cut(`${s.emoji} ${sizeName(t, s)}`, WA_ROW_TITLE_MAX),
    description: cut(s.examples, WA_ROW_DESCRIPTION_MAX),
  }));
  if (makesAt(b, category, t.edits).length) {
    rows.push({
      id: id('find', b.id, category),
      title: say(t, '🤔 Not sure?', '🤔 తెలియదా?'),
      description: say(t, 'Find your model: pick the company, then the model', 'మీ మోడల్ వెతకండి: కంపెనీ, తర్వాత మోడల్'),
    });
  }
  return [
    {
      type: 'list',
      text: bike
        ? say(t, 'Which type is your bike?', 'మీ బైక్ ఏ రకం?')
        : say(
            t,
            'Which size is your car?\nPrices go by size: bigger cars take more time, water and care.',
            'మీ కార్ ఏ సైజ్?\nధరలు సైజ్‌ని బట్టి ఉంటాయి: పెద్ద కార్లకు ఎక్కువ సమయం, నీళ్ళు, శ్రద్ధ కావాలి.',
          ),
      button: bike ? say(t, 'Choose type', 'రకం ఎంచుకోండి') : say(t, 'Choose size', 'సైజ్ ఎంచుకోండి'),
      title: bike ? say(t, 'Bike types', 'బైక్ రకాలు') : say(t, 'Car sizes', 'కార్ సైజ్‌లు'),
      rows,
    },
  ];
}

/** "Not sure?": the Flow when it's published, else the company list. */
function findReply(t: Turn, b: ChatBranch, category: VehicleCategory): ChatMessage {
  return t.ctx.flows ? flowOpener(t, b, category) : makeList(t, b, category, 0);
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
  if (!models.length) return makeList(t, b, category, 0);
  const from = page * PAGE_ROWS;
  const shown = models.slice(from, from + PAGE_ROWS);
  const rows: ChatRow[] = shown.map((r) => ({
    id: pricesId(b, r.make, r.model),
    title: cut(r.model, WA_ROW_TITLE_MAX),
    description: modelKind(t, r.bodyKey),
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

/** Under a model in a list: the size it's priced as ("Mid-size car"), else its body type. */
function modelKind(t: Turn, bodyKey: string): string | undefined {
  const size = priceSizeOfBody(bodyKey);
  return size ? sizeName(t, size) : bodyTypeDef(bodyKey)?.label;
}

// ─── Price lists ─────────────────────────────────────────────────────────────

/** What a price list is for: a size the customer picked, or a model they picked or typed. */
type Target =
  | { kind: 'size'; size: PriceSize; type: VehicleType }
  | { kind: 'model'; make: string; model: string; size: PriceSize | null; type: VehicleType };

const pricesId = (b: ChatBranch, make: string, model: string) => id('pr', b.id, make, model);

function sizeTarget(b: ChatBranch, key: string | undefined): Target | null {
  const size = priceSize(key);
  const type = size && sizeType(b, size);
  return size && type ? { kind: 'size', size, type } : null;
}

function modelTarget(t: Turn, b: ChatBranch, make: string, model: string): Target | null {
  const type = chatVehicleType(b, make, model, t.edits);
  return type ? { kind: 'model', make, model, type, size: priceSizeOfBody(typeKey(type)) } : null;
}

/** The id that opens a target's price list; remembered so a number picks from it. */
const targetId = (b: ChatBranch, x: Target) => (x.kind === 'size' ? id('sz', b.id, x.size.key) : pricesId(b, x.make, x.model));
/** The id that opens a target's wash plans ("pl|<branch>|sz|large"). */
const plansId = (b: ChatBranch, x: Target) => (x.kind === 'size' ? id('pl', b.id, 'sz', x.size.key) : id('pl', b.id, 'pr', x.make, x.model));

/** A target id read back, from its kind ("sz" / "pr") and what follows the branch. */
function targetOf(t: Turn, b: ChatBranch, kind: string | undefined, rest: string[]): Target | null {
  if (kind === 'sz') return sizeTarget(b, rest[0]);
  if (kind === 'pr') return modelTarget(t, b, rest[0] ?? '', rest[1] ?? '');
  return null;
}

const categoryOf = (x: Target): VehicleCategory => x.size?.category ?? x.type.category;
const emojiOf = (x: Target) => x.size?.emoji ?? (categoryOf(x) === 'bike' ? '🏍️' : '🚘');
/** "Large / 7-seater" or "Maruti Suzuki Brezza". */
const labelOf = (t: Turn, x: Target) => (x.kind === 'size' ? sizeName(t, x.size) : `${x.make} ${x.model}`);

/** "12" → 1️⃣2️⃣. */
const keycap = (n: number) => [...String(n)].map((d) => `${d}️⃣`).join('');
const star = (item: { popular: boolean }) => (item.popular ? ' ⭐' : '');

/** "4 washes in a month" / "నెలలో 4 వాష్‌లు". */
function planSpan(t: Turn, washes: number, months: number): string {
  if (te(t)) return `${months === 1 ? 'నెలలో' : `${months} నెలల్లో`} ${washes} వాష్‌లు`;
  return `${washes} washes in ${months === 1 ? 'a month' : `${months} months`}`;
}

type ServiceItem = { name: string; popular: boolean; price: number; service: Service };
type PlanItem = { name: string; popular: boolean; price: number; listPrice: number; plan: Plan };

/**
 * What the vehicle type can have at the branch: washes (and protection), add-ons, monthly plans,
 * then longer plans. A price list numbers washes, add-ons and monthly plans in that order; the
 * plans list numbers every plan.
 */
function priceItems(b: ChatBranch, type: VehicleType) {
  const offered: ServiceItem[] = b.services.flatMap((s) => {
    const p = s.prices.find((x) => x.vehicleTypeId === type.id && x.price > 0);
    return p ? [{ name: s.name, popular: s.popular, price: p.price, service: s }] : [];
  });
  const plans: PlanItem[] = b.plans.flatMap((p) => {
    const price = p.prices.find((x) => x.vehicleTypeId === type.id && x.total > 0);
    return price ? [{ name: p.name, popular: p.popular, price: price.total, listPrice: price.listTotal, plan: p }] : [];
  });
  const services = offered.filter((s) => s.service.kind !== 'addon');
  const addons = offered.filter((s) => s.service.kind === 'addon');
  const monthly = plans.filter((p) => p.plan.months <= 1);
  const longer = plans.filter((p) => p.plan.months > 1);
  const listed: (ServiceItem | PlanItem)[] = [...services, ...addons, ...monthly];
  return { services, addons, monthly, longer, plans, listed };
}

const isPlan = (item: ServiceItem | PlanItem): item is PlanItem => 'plan' in item;

const saveNote = (t: Turn, p: PlanItem) => {
  const saving = p.listPrice - p.price;
  return saving > 0 ? say(t, ` (save ${rupees(saving)})`, ` (${rupees(saving)} ఆదా)`) : '';
};

/** "💡 3 & 12-month plans save more: reply PLANS" (a 52-wash plan over 13 months is the 12-month one). */
function longerHint(t: Turn, longer: PlanItem[]): string {
  const terms = [...new Set(longer.map((p) => (p.plan.months >= 12 ? 12 : p.plan.months)))].sort((a, c) => a - c).map(String);
  return say(
    t,
    `💡 ${joinAnd(terms)}-month plans save more: reply *PLANS*`,
    `💡 ${joinAnd(terms)} నెలల ప్లాన్‌లతో ఇంకా ఆదా: *PLANS* అని పంపండి`,
  );
}

/** The top of a price list: which size (with examples) or which model and its size, and where. */
function priceHead(t: Turn, b: ChatBranch, x: Target): string[] {
  if (x.kind === 'size') {
    const examples = [x.size.examples, ...(x.size.alsoExample ? [x.size.alsoExample] : [])].join(', ');
    return [
      `${x.size.emoji} *${sizeName(t, x.size)}*`,
      say(t, `For ${examples}…`, `ఉదా: ${examples}…`),
      say(t, `Prices at ${branchLine(t, b)}`, `${branchLine(t, b)} ధరలు`),
    ];
  }
  const name = `*${x.make} ${x.model}*`;
  if (!x.size) return [`${emojiOf(x)} ${name} · ${x.type.name}`, say(t, `Prices at ${branchLine(t, b)}`, `${branchLine(t, b)} ధరలు`)];
  return [
    say(t, `${x.size.emoji} ${name} is a *${x.size.name}*.`, `${x.size.emoji} ${name} ఒక *${x.size.te.name}*.`),
    say(t, `${x.size.short} prices at ${branchLine(t, b)}`, `${branchLine(t, b)} లో ${x.size.te.short} ధరలు`),
  ];
}

/** Another size (or, without sizes, another vehicle), Get Directions, Talk to us. */
function afterPrices(t: Turn, b: ChatBranch, category: VehicleCategory): ChatButton[] {
  const bike = category === 'bike';
  const other: ChatButton = sizesAt(b, category).length
    ? { id: id('cat', b.id, category), title: bike ? say(t, '🔁 Other type', '🔁 వేరే రకం') : say(t, '🔁 Other size', '🔁 వేరే సైజ్') }
    : { id: id('find', b.id, category), title: say(t, '🔁 Other vehicle', '🔁 వేరే వాహనం') };
  return [other, directionsButton(t, b), talkButton(t, b)];
}

/** Back to the price list a detail came from: "📋 Large car prices" or "📋 All prices". */
function backButton(t: Turn, b: ChatBranch, x: Target): ChatButton {
  const title = x.kind === 'size' ? say(t, `📋 ${x.size.short} prices`, `📋 ${x.size.te.short} ధరలు`) : say(t, '📋 All prices', '📋 అన్ని ధరలు');
  return { id: targetId(b, x), title: cut(title, WA_BUTTON_TITLE_MAX) };
}

/** A long list goes as a text with the buttons under it. */
function withButtons(t: Turn, text: string, buttons: ChatButton[]): ChatMessage[] {
  if (text.length <= WA_BUTTONS_BODY_MAX) return [{ type: 'buttons', text, buttons }];
  return [
    { type: 'text', text },
    { type: 'buttons', text: say(t, 'Anything else?', 'ఇంకా ఏమైనా?'), buttons },
  ];
}

/** No prices for this size or model at the branch (yet). */
function noPrices(t: Turn, b: ChatBranch, label: string, category: VehicleCategory): ChatMessage[] {
  return [
    {
      type: 'buttons',
      text: say(
        t,
        `Sorry, we don't have prices for the *${label}* at ${branchLine(t, b)} yet. 🙏 Please call us and we'll help.`,
        `క్షమించండి, ${branchLine(t, b)} లో *${label}* కి ఇంకా ధరలు లేవు. 🙏 మాకు కాల్ చేయండి, సహాయం చేస్తాం.`,
      ),
      buttons: afterPrices(t, b, category),
    },
  ];
}

/** The price list: washes, the add-on, monthly plans, numbered; longer plans on PLANS. */
function prices(t: Turn, b: ChatBranch, x: Target): ChatMessage[] {
  const { services, addons, monthly, longer } = priceItems(b, x.type);
  const buttons = afterPrices(t, b, categoryOf(x));
  if (!services.length) return noPrices(t, b, labelOf(t, x), categoryOf(x));
  let n = 0;
  const lines = [...priceHead(t, b, x), '', say(t, '🧽 *Washes*', '🧽 *వాష్‌లు*')];
  for (const s of services) lines.push(`${keycap(++n)} ${s.name}${star(s)}: *${rupees(s.price)}*`);
  if (addons.length) {
    lines.push(
      '',
      addons.length === 1
        ? say(t, '✨ *Add-on* (with any wash)', '✨ *అదనంగా* (ఏ వాష్‌తోనైనా)')
        : say(t, '✨ *Add-ons* (with any wash)', '✨ *అదనంగా* (ఏ వాష్‌తోనైనా)'),
    );
    for (const a of addons) {
      lines.push(`${keycap(++n)} ${a.name}: *+${rupees(a.price)}*`);
      if (a.service.description) lines.push(`_${a.service.description.replace(/\.$/, '')}_`);
    }
  }
  if (monthly.length) {
    const counts = new Set(monthly.map((p) => p.plan.washes));
    const washes = counts.size === 1 ? [...counts][0]! : null;
    lines.push(
      '',
      washes
        ? say(t, `📅 *Monthly plans* (${washes} washes)`, `📅 *నెల ప్లాన్‌లు* (${washes} వాష్‌లు)`)
        : say(t, '📅 *Monthly plans*', '📅 *నెల ప్లాన్‌లు*'),
    );
    for (const p of monthly) {
      const span = washes ? '' : `${planSpan(t, p.plan.washes, p.plan.months)}, `;
      lines.push(`${keycap(++n)} ${p.name}${star(p)}: ${span}*${rupees(p.price)}*${saveNote(t, p)}`);
    }
    if (longer.length) lines.push(longerHint(t, longer));
  } else if (longer.length) {
    lines.push('', say(t, '📅 *Wash plans*: reply *PLANS* to see them', '📅 *వాష్ ప్లాన్‌లు*: చూడటానికి *PLANS* అని పంపండి'));
  }
  lines.push('', say(t, "👉 Reply a number to see what's included", '👉 ఏమేమి ఉంటాయో చూడటానికి నంబర్ పంపండి'));
  return withButtons(t, lines.join('\n'), buttons);
}

/** "an *Express Wash* each time, and every 4th a *Premium Wash*". */
function planWhat(t: Turn, p: Plan): string | null {
  if (!p.serviceName) return null;
  const a = (name: string) => (/^[AEIOU]/i.test(name) ? 'an' : 'a');
  const each = say(t, `${a(p.serviceName)} *${p.serviceName}* each time`, `ప్రతిసారి *${p.serviceName}*`);
  if (!p.upgrade) return each;
  return say(
    t,
    `${each}, and every ${p.upgrade.every}th ${a(p.upgrade.name)} *${p.upgrade.name}*`,
    `${each}, ప్రతి ${p.upgrade.every}వ సారి *${p.upgrade.name}*`,
  );
}

/** "That's ₹436 a wash." */
const perWash = (t: Turn, total: number, washes: number) =>
  washes > 1 ? say(t, `💡 That's *${rupees(Math.round(total / washes / 100) * 100)}* a wash.`, `💡 ఒక్కో వాష్ *${rupees(Math.round(total / washes / 100) * 100)}* మాత్రమే.`) : null;

/** What's in one service, add-on or plan. */
function itemDetails(t: Turn, x: Target, item: ServiceItem | PlanItem, n: number): string {
  const head = `${keycap(n)} *${item.name}*${star(item)}`;
  const who = `${emojiOf(x)} ${labelOf(t, x)}`;
  if (isPlan(item)) {
    const p = item.plan;
    const what = planWhat(t, p);
    return [
      head,
      `${who} · *${rupees(item.price)}*${saveNote(t, item)}`,
      '',
      `📅 ${planSpan(t, p.washes, p.months)}${what ? `: ${what}` : ''}`,
      ...[perWash(t, item.price, p.washes)].filter((l): l is string => !!l),
      '',
      say(t, 'Buy it at the counter on your next visit.', 'మీ తదుపరి విజిట్‌లో కౌంటర్ వద్ద తీసుకోండి.'),
    ].join('\n');
  }
  const s = item.service;
  const addon = s.kind === 'addon';
  const checklist = s.checklist ?? [];
  return [
    head,
    `${who} · *${addon ? '+' : ''}${rupees(item.price)}*`,
    ...(s.description ? ['', s.description] : []),
    ...(checklist.length ? ['', say(t, "✅ *What's included*", '✅ *ఇందులో ఉండేవి*'), ...checklist.map((c) => `• ${c}`)] : []),
    ...(s.durationMin
      ? [
          '',
          addon
            ? say(t, `⏱️ Adds about ${s.durationMin} minutes`, `⏱️ సుమారు ${s.durationMin} నిమిషాలు ఎక్కువ`)
            : say(t, `⏱️ Takes about ${s.durationMin} minutes`, `⏱️ సుమారు ${s.durationMin} నిమిషాలు పడుతుంది`),
        ]
      : []),
    ...(addon ? ['', say(t, 'Ask for it with any wash at the counter.', 'కౌంటర్ వద్ద ఏ వాష్‌తోనైనా అడగండి.')] : []),
  ].join('\n');
}

const pickRange = (t: Turn, count: number) =>
  say(t, `Please pick a number from *1* to *${count}*. 🙏`, `దయచేసి *1* నుండి *${count}* లోపు నంబర్ పంపండి. 🙏`);

/** Item `n` of the price list. */
function details(t: Turn, b: ChatBranch, x: Target, n: number): ChatMessage[] {
  const { listed } = priceItems(b, x.type);
  const buttons = [backButton(t, b, x), directionsButton(t, b), talkButton(t, b)];
  const item = listed[n - 1];
  if (!listed.length) return prices(t, b, x);
  if (!item) return [{ type: 'buttons', text: pickRange(t, listed.length), buttons }];
  return [{ type: 'buttons', text: cut(itemDetails(t, x, item, n), WA_BUTTONS_BODY_MAX), buttons }];
}

/** PLANS: every wash plan for the size or model, by plan, with each length numbered. */
function plansList(t: Turn, b: ChatBranch, x: Target): ChatMessage[] {
  const { plans } = priceItems(b, x.type);
  const buttons = [backButton(t, b, x), directionsButton(t, b), talkButton(t, b)];
  if (!plans.length) {
    return [
      {
        type: 'buttons',
        text: say(t, `We don't have wash plans for the *${labelOf(t, x)}* yet. 🙏`, `*${labelOf(t, x)}* కి ఇంకా వాష్ ప్లాన్‌లు లేవు. 🙏`),
        buttons,
      },
    ];
  }
  // "Express Plan", "Express Plan · 3 months"… are one plan in three lengths.
  const families: { name: string; plan: Plan; items: PlanItem[] }[] = [];
  for (const p of plans) {
    const name = p.name.split(' · ')[0]!.trim();
    const family = families.find((f) => f.name === name);
    if (family) family.items.push(p);
    else families.push({ name, plan: p.plan, items: [p] });
  }
  let n = 0;
  const lines = [
    say(t, `📅 *Wash plans* · ${emojiOf(x)} ${labelOf(t, x)}`, `📅 *వాష్ ప్లాన్‌లు* · ${emojiOf(x)} ${labelOf(t, x)}`),
    say(t, 'Pay once, wash all month. Longer plans save more.', 'ఒకేసారి చెల్లించండి, నెలంతా వాష్. ఎక్కువ కాలం ప్లాన్‌లతో ఇంకా ఆదా.'),
  ];
  for (const f of families) {
    const what = planWhat(t, f.plan);
    lines.push('', `*${f.name}*${f.items.some((i) => i.popular) ? ' ⭐' : ''}${what ? `: ${what}` : ''}`);
    for (const p of f.items) lines.push(`${keycap(++n)} ${planSpan(t, p.plan.washes, p.plan.months)}: *${rupees(p.price)}*${saveNote(t, p)}`);
  }
  lines.push(
    '',
    say(t, "👉 Reply a number to see what's included", '👉 ఏమేమి ఉంటాయో చూడటానికి నంబర్ పంపండి'),
    say(t, 'Buy at the counter on your next visit.', 'మీ తదుపరి విజిట్‌లో కౌంటర్ వద్ద తీసుకోండి.'),
  );
  return withButtons(t, lines.join('\n'), buttons);
}

/** Plan `n` of the plans list. */
function planDetails(t: Turn, b: ChatBranch, x: Target, n: number): ChatMessage[] {
  const { plans } = priceItems(b, x.type);
  const buttons: ChatButton[] = [
    { id: plansId(b, x), title: say(t, '📅 All plans', '📅 అన్ని ప్లాన్‌లు') },
    backButton(t, b, x),
    talkButton(t, b),
  ];
  const item = plans[n - 1];
  if (!plans.length) return plansList(t, b, x);
  if (!item) return [{ type: 'buttons', text: pickRange(t, plans.length), buttons }];
  return [{ type: 'buttons', text: cut(itemDetails(t, x, item, n), WA_BUTTONS_BODY_MAX), buttons }];
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

/** "Thanks, our team will reply here", with the main buttons for meanwhile. */
function teamAck(t: Turn, b: ChatBranch): ChatMessage[] {
  return [
    {
      type: 'buttons',
      text: say(
        t,
        'Thanks for your message! 🙏 Our team will reply here shortly.\n\nMeanwhile, tap below for prices or directions.',
        'మీ సందేశానికి ధన్యవాదాలు! 🙏 మా టీమ్ త్వరలో ఇక్కడే జవాబు ఇస్తుంది.\n\nఈలోగా ధరలు లేదా దారి కోసం కింద నొక్కండి.',
      ),
      buttons: mainButtons(t, b),
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
    const x = modelTarget(t, b, found[0]!.make, found[0]!.model);
    if (x) return { messages: prices(t, b, x), context: targetId(b, x) };
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
            description: cut([r.make, modelKind(t, r.bodyKey)].filter(Boolean).join(' · '), WA_ROW_DESCRIPTION_MAX),
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
      ? `మీ ${bike ? 'బైక్ లేదా స్కూటర్' : 'కార్'} కంపెనీ, మోడల్ ఎంచుకోండి. అది ఏ సైజ్‌లోకి వస్తుందో, దాని ధరలు చూపిస్తాం. 👇`
      : `Pick your ${bike ? 'bike or scooter' : 'car'}'s company and model, and we'll show which size it is and its prices. 👇`,
    button: te(t) ? (bike ? 'బైక్ ఎంచుకోండి' : 'కార్ ఎంచుకోండి') : bike ? 'Choose your bike' : 'Choose your car',
    token: chatFlowToken(b.id, category, t.lang),
  };
}

/** WhatsApp's RichText markdown for a model's price list (bold is **…**), numbered like the chat's. */
function flowPrices(t: Turn, b: ChatBranch, make: string, model: string): string {
  const x = modelTarget(t, b, make, model);
  const found = x && priceItems(b, x.type);
  if (!x || !found?.services.length) {
    return say(t, `# ${make} ${model}\nSorry, we don't have prices for this one at ${placeName(t, b)} yet.`, `# ${make} ${model}\nక్షమించండి, దీనికి ఇంకా ధరలు లేవు.`);
  }
  const { services, addons, monthly, longer } = found;
  const where = `${placeName(t, b)}${b.city ? `, ${b.city}` : ''}`;
  let n = 0;
  const lines = [
    `# ${emojiOf(x)} ${make} ${model}`,
    x.size ? say(t, `A ${x.size.name.toLowerCase()} · ${where}`, `${x.size.te.name} · ${where}`) : `${x.type.name} · ${where}`,
    '',
    say(t, '## 🧽 Washes', '## 🧽 వాష్‌లు'),
    ...services.map((s) => `${++n}. **${s.name}**${star(s)} — ${rupees(s.price)}`),
  ];
  if (addons.length) {
    lines.push('', say(t, '## ✨ Add-on (with any wash)', '## ✨ అదనంగా (ఏ వాష్‌తోనైనా)'));
    for (const a of addons) lines.push(`${++n}. **${a.name}** — +${rupees(a.price)}${a.service.description ? ` · ${a.service.description.replace(/\.$/, '')}` : ''}`);
  }
  if (monthly.length) {
    lines.push('', say(t, '## 📅 Monthly plans', '## 📅 నెల ప్లాన్‌లు'));
    for (const p of monthly) lines.push(`${++n}. **${p.name}**${star(p)} — ${rupees(p.price)} · ${planSpan(t, p.plan.washes, p.plan.months)}${saveNote(t, p)}`);
  }
  if (longer.length) lines.push('', longerHint(t, longer).replace(/\*/g, '**'));
  lines.push('', say(t, "Tap below to get this in chat, then reply with a number to see what's included.", 'దీన్ని చాట్‌లో పొందండి, తర్వాత వివరాల కోసం నంబర్ పంపండి.'));
  return lines.join('\n');
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
        models: models.slice(0, 200).map((r) => ({ id: r.model, title: cut(r.model, 30), description: modelKind(t, r.bodyKey) ?? '' })),
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
  /** A price list, remembered so a number picks from it. */
  const priceList = (b: ChatBranch, x: Target) => done(prices(t, b, x), undefined, targetId(b, x));
  const planList = (b: ChatBranch, x: Target) => done(plansList(t, b, x), undefined, plansId(b, x));

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
    // "తెలుగు" / "English" on its own: the welcome in that language.
    if (TELUGU_WORDS.has(lower) || ENGLISH_WORDS.has(lower)) return done(start(t));
    // The price list (or plans list) they saw last: a number or PLANS reads from it.
    const seen = ctx.person?.context?.split('|') ?? [];
    const seenBranch = branchOf(ctx, seen[1]) ?? only;
    const onPlans = seen[0] === 'pl';
    const seenTarget = seenBranch ? (onPlans ? targetOf(t, seenBranch, seen[2], seen.slice(3)) : targetOf(t, seenBranch, seen[0], seen.slice(2))) : null;
    const pick = /^\d{1,2}$/.test(text) ? Number(text) : null;
    if (pick && seenBranch && seenTarget) {
      return done(onPlans ? planDetails(t, seenBranch, seenTarget, pick) : details(t, seenBranch, seenTarget, pick));
    }
    if (PLAN_WORDS.has(lower)) {
      if (seenBranch && seenTarget) return planList(seenBranch, seenTarget);
      const b = only ?? ctx.branches[0]!;
      return done([
        { type: 'text', text: say(t, "Pick your vehicle first and we'll show its plans. 👇", 'ముందు మీ వాహనం ఎంచుకోండి, దాని ప్లాన్‌లు చూపిస్తాం. 👇') },
        ...servicesReply(t, b),
      ]);
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
      return done([welcome(t, b)]);
    case 'svc':
    case 'home':
      return done(servicesReply(t, b));
    case 'cat':
      return done(categoryReply(t, b, category));
    case 'find':
      return done([findReply(t, b, category)]);
    case 'mk':
      return done([makeList(t, b, category, Number(rest[1]) || 0)]);
    case 'mo':
      return done([modelList(t, b, category, rest[1] ?? '', Number(rest[2]) || 0)]);
    case 'sz':
    case 'pr': {
      const x = targetOf(t, b, kind, rest);
      if (x) return priceList(b, x);
      // A model this branch has no vehicle type for (or a size it no longer prices).
      const listed = kind === 'pr' ? vehicleGuideRows(t.edits).find((r) => r.make === rest[0] && r.model === rest[1]) : null;
      return done(listed ? noPrices(t, b, `${listed.make} ${listed.model}`, listed.category) : servicesReply(t, b));
    }
    case 'pl': {
      const x = targetOf(t, b, rest[0], rest.slice(1));
      return x ? planList(b, x) : done(servicesReply(t, b));
    }
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
