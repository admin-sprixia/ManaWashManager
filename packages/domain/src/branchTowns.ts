import { distanceKm, type GeoPoint } from './serviceArea';

/**
 * Opening a branch without typing a code. HQ gives the branch's pincode and drops a pin where it
 * is; India Post's office list says which district and state that is and which towns and areas
 * are around it. Each town of the business has one 3-letter code for good — big cities their
 * well-known one (HYD, BLR, MAA…), other towns one made from the name (Kovur → KVR) that no other
 * town has — and its branches are numbered: KVR-001, KVR-002.
 */

// ─── Pincodes and places ────────────────────────────────────────────────────

export const PINCODE_RE = /^[1-9]\d{5}$/;

export const isValidPincode = (value: string) => PINCODE_RE.test(value);

/** What someone typed ("524 137") → digits only, at most 6. */
export const normalizePincode = (value: string) => value.replace(/\D/g, '').slice(0, 6);

/** Roughly India, islands included: a pin outside is a slip (0, 0 or the wrong sign). */
export function inIndia(p: GeoPoint): boolean {
  return p.latitude >= 6 && p.latitude <= 37.6 && p.longitude >= 68 && p.longitude <= 97.5;
}

export type PostOfficeKind = 'HO' | 'PO' | 'BO';

/** One India Post office: head (HO), sub (PO) or branch (BO, usually a village). */
export interface PostOffice {
  name: string;
  kind: PostOfficeKind;
  district: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
}

const SMALL_WORDS = new Set(['and', 'of', 'the', 'in', 'on']);
/** Short words that are titles, not abbreviations: "DR. Ambedkar" → "Dr. Ambedkar". */
const TITLES = new Set(['DR', 'ST', 'MT', 'SMT']);

/** "SPSR NELLORE" → "SPSR Nellore", "ANDHRA PRADESH" → "Andhra Pradesh". Vowel-less words stay capitals. */
export function titleCase(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => {
      const letters = word.replace(/[^a-z]/gi, '');
      if (TITLES.has(letters.toUpperCase())) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      if (!/[aeiou]/i.test(word) && letters.length > 0 && letters.length <= 5) return word.toUpperCase();
      const lower = word.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.replace(/(^|[-'(])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
    })
    .join(' ');
}

/** Office-type endings in all the ways India Post writes them: B.O, SO, H.Q., GPO, TSO, NDSO… */
const OFFICE_SUFFIX =
  /\s+(?:B\.?\s?O|S\.?\s?O|H\.?\s?O|H\.?\s?Q|G\.?\s?P\.?\s?O|P\.?\s?O|N\.?\s?D\.?\s?C|M\.?\s?D\.?\s?G|T\.?\s?S\.?\s?O|N\.?\s?D\.?\s?S\.?\s?O|E\.?\s?D\.?\s?S\.?\s?O)\.?$/i;

/** A post office's place name: "Kovur Cutchery S.O" → "Kovur Cutchery", "Aundh (Pune) H.O" → "Aundh". */
export function placeName(officeName: string): string {
  let name = officeName.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  while (OFFICE_SUFFIX.test(name)) name = name.replace(OFFICE_SUFFIX, '').trim();
  return titleCase(name.replace(/[.,]+$/, ''));
}

/**
 * A town's spelling-proof key: letters only, doubled letters once, final vowels dropped. Kovur and
 * Kovuru, Nellore and Nelore are the same town.
 */
export function townKey(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '').replace(/(.)\1+/g, '$1');
  const trimmed = letters.replace(/[AEIOU]+$/, '');
  return trimmed.length >= 2 ? trimmed : letters;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** Two different town names that are probably one town spelt two ways (Kovur / Kavur, Nellur / Nellore). */
export function looksAlike(a: string, b: string): boolean {
  const x = townKey(a);
  const y = townKey(b);
  if (x === y) return false;
  if (Math.min(x.length, y.length) < 3) return false;
  return editDistance(x, y) <= 1 || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
}

// ─── Town codes ─────────────────────────────────────────────────────────────

export interface CityCode {
  name: string;
  /** The code people already know (airport / railway). */
  code: string;
  aliases: readonly string[];
  centre: GeoPoint;
  /** A pin this close to the centre is in the city (its areas are named, not separate towns). */
  radiusKm: number;
}

/** Big cities keep the codes everyone knows; no other town is ever given one of these. */
export const CITY_CODES: readonly CityCode[] = [
  { name: 'Hyderabad', code: 'HYD', aliases: ['Secunderabad', 'Cyberabad'], centre: { latitude: 17.385, longitude: 78.4867 }, radiusKm: 22 },
  { name: 'Bengaluru', code: 'BLR', aliases: ['Bangalore'], centre: { latitude: 12.9716, longitude: 77.5946 }, radiusKm: 22 },
  { name: 'Chennai', code: 'MAA', aliases: ['Madras'], centre: { latitude: 13.0827, longitude: 80.2707 }, radiusKm: 20 },
  { name: 'Mumbai', code: 'BOM', aliases: ['Bombay'], centre: { latitude: 19.076, longitude: 72.8777 }, radiusKm: 25 },
  { name: 'Delhi', code: 'DEL', aliases: ['New Delhi'], centre: { latitude: 28.6139, longitude: 77.209 }, radiusKm: 25 },
  { name: 'Kolkata', code: 'CCU', aliases: ['Calcutta'], centre: { latitude: 22.5726, longitude: 88.3639 }, radiusKm: 15 },
  { name: 'Pune', code: 'PNQ', aliases: ['Poona'], centre: { latitude: 18.5204, longitude: 73.8567 }, radiusKm: 15 },
  { name: 'Ahmedabad', code: 'AMD', aliases: [], centre: { latitude: 23.0225, longitude: 72.5714 }, radiusKm: 15 },
  { name: 'Visakhapatnam', code: 'VTZ', aliases: ['Vizag', 'Vishakhapatnam'], centre: { latitude: 17.6868, longitude: 83.2185 }, radiusKm: 15 },
  { name: 'Vijayawada', code: 'VGA', aliases: ['Bezawada'], centre: { latitude: 16.5062, longitude: 80.648 }, radiusKm: 10 },
  { name: 'Nellore', code: 'NLR', aliases: [], centre: { latitude: 14.4426, longitude: 79.9865 }, radiusKm: 6 },
  { name: 'Tirupati', code: 'TIR', aliases: ['Tirupathi'], centre: { latitude: 13.6288, longitude: 79.4192 }, radiusKm: 6 },
  { name: 'Guntur', code: 'GNT', aliases: [], centre: { latitude: 16.3067, longitude: 80.4365 }, radiusKm: 7 },
  { name: 'Rajahmundry', code: 'RJA', aliases: ['Rajamahendravaram', 'Rajamundry'], centre: { latitude: 17.0005, longitude: 81.804 }, radiusKm: 7 },
  { name: 'Kakinada', code: 'KKD', aliases: [], centre: { latitude: 16.9891, longitude: 82.2475 }, radiusKm: 6 },
  { name: 'Warangal', code: 'WGL', aliases: ['Hanamkonda'], centre: { latitude: 17.9689, longitude: 79.5941 }, radiusKm: 8 },
  { name: 'Kurnool', code: 'KNL', aliases: [], centre: { latitude: 15.8281, longitude: 78.0373 }, radiusKm: 6 },
  { name: 'Coimbatore', code: 'CJB', aliases: ['Kovai'], centre: { latitude: 11.0168, longitude: 76.9558 }, radiusKm: 10 },
  { name: 'Kochi', code: 'COK', aliases: ['Cochin', 'Ernakulam'], centre: { latitude: 9.9312, longitude: 76.2673 }, radiusKm: 12 },
  { name: 'Lucknow', code: 'LKO', aliases: [], centre: { latitude: 26.8467, longitude: 80.9462 }, radiusKm: 15 },
  { name: 'Jaipur', code: 'JAI', aliases: [], centre: { latitude: 26.9124, longitude: 75.7873 }, radiusKm: 15 },
  { name: 'Surat', code: 'STV', aliases: [], centre: { latitude: 21.1702, longitude: 72.8311 }, radiusKm: 12 },
  { name: 'Nagpur', code: 'NAG', aliases: [], centre: { latitude: 21.1458, longitude: 79.0882 }, radiusKm: 12 },
];

const CITY_CODE_SET = new Set(CITY_CODES.map((c) => c.code));

/** The big city a pin is in, if any (the closest centre within its radius). */
export function cityAt(p: GeoPoint): CityCode | null {
  let best: { city: CityCode; km: number } | null = null;
  for (const city of CITY_CODES) {
    const km = distanceKm(p, city.centre);
    if (km <= city.radiusKm && (!best || km < best.km)) best = { city, km };
  }
  return best?.city ?? null;
}

/** The big city a town name stands for ("Bangalore" → Bengaluru), if any. */
export function cityNamed(name: string): CityCode | null {
  const key = townKey(name);
  return CITY_CODES.find((c) => townKey(c.name) === key || c.aliases.some((a) => townKey(a) === key)) ?? null;
}

const isVowel = (c: string) => 'AEIOU'.includes(c);

/**
 * 3-letter codes for a town name, best first: its first letter, then the consonants that follow
 * (Kovur → KVR, Kavali → KVL, Gudur → GDR), then other letters, then anything left.
 */
export function codeCandidates(name: string): string[] {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '').replace(/(.)\1+/g, '$1');
  if (!letters) return [];
  const first = letters[0]!;
  const rest = [...letters.slice(1)];
  const consonants = rest.filter((c) => !isVowel(c));
  const out = new Set<string>();
  for (let i = 0; i < consonants.length; i++) for (let j = i + 1; j < consonants.length; j++) out.add(first + consonants[i]! + consonants[j]!);
  const pairs: string[] = [];
  for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) pairs.push(rest[i]! + rest[j]!);
  for (const p of pairs.filter((p) => !isVowel(p[0]!))) out.add(first + p);
  for (const p of pairs) out.add(first + p);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of alphabet) for (const b of alphabet) out.add(first + a + b);
  return [...out];
}

/**
 * The code a new town gets: its city code if it's a big city (and free), else the first candidate
 * no other town of the business has and no big city owns. Null only if all 676 codes for its first
 * letter are taken.
 */
export function newTownCode(name: string, taken: ReadonlySet<string>): string | null {
  const city = cityNamed(name);
  if (city && !taken.has(city.code)) return city.code;
  for (const code of codeCandidates(name)) {
    if (!taken.has(code) && !CITY_CODE_SET.has(code)) return code;
  }
  return null;
}

export const isTownCode = (code: string) => /^[A-Z]{3}$/.test(code);

/** The number part of a branch code ("KVR-012" → 12), or null when it isn't one of the town's. */
export function branchNumber(code: string, townCode: string): number | null {
  const m = new RegExp(`^${townCode}-(\\d{1,4})$`).exec(code);
  return m ? Number(m[1]) : null;
}

/** The next free number in a town, after every branch code already using it. */
export function nextBranchNumber(codes: readonly string[], townCode: string): number {
  return codes.reduce((max, c) => Math.max(max, branchNumber(c, townCode) ?? 0), 0) + 1;
}

// ─── Names and choices ──────────────────────────────────────────────────────

export const BRANCH_NAME_MAX = 60;
export const TOWN_NAME_MAX = 40;

/**
 * A branch's name: its town, with its area in a big city or when the town already has a branch;
 * never the same as another branch of the business (a same-named town elsewhere gets its district).
 */
export function branchName(input: {
  town: string;
  area: string | null;
  district: string;
  /** Names already used by the business's branches. */
  taken: readonly string[];
  /** Whether the taken names include branches in this very town. */
  townHasBranches: boolean;
}): string {
  const used = new Set(input.taken.map((n) => n.trim().toLowerCase()));
  const free = (n: string) => !used.has(n.toLowerCase());
  const cut = (n: string) => n.slice(0, BRANCH_NAME_MAX).trim();
  const area = input.area && townKey(input.area) !== townKey(input.town) ? input.area : null;
  // "Kovur Cutchery" already says Kovur.
  const withArea = area && (area.toLowerCase().startsWith(`${input.town.toLowerCase()} `) ? area : `${input.town} ${area}`);
  const base = cut(withArea ?? input.town);
  if (free(base)) return base;
  if (!input.townHasBranches) {
    const withDistrict = cut(`${base} (${input.district})`);
    if (free(withDistrict)) return withDistrict;
  }
  const stem = base.slice(0, BRANCH_NAME_MAX - 4).trim();
  for (let n = 2; n < 1000; n++) {
    const numbered = `${stem} ${n}`;
    if (free(numbered)) return numbered;
  }
  return base;
}

type Located = { office: PostOffice; km: number | null };

function byDistance(offices: readonly PostOffice[], pin: GeoPoint): Located[] {
  return offices
    .map((office) => ({
      office,
      km: office.latitude != null && office.longitude != null ? distanceKm(pin, { latitude: office.latitude, longitude: office.longitude }) : null,
    }))
    .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
}

export interface TownChoice {
  name: string;
  /** A big city (its areas are the branches), or a town from the post offices nearby. */
  from: 'city' | 'post_office';
}

/**
 * What the town can be, best first: the big city the pin is in, then the towns of the pincode's
 * head and sub post offices nearest the pin (villages' branch offices only when there are none).
 */
export function townChoices(offices: readonly PostOffice[], pin: GeoPoint, max = 4): TownChoice[] {
  const out: TownChoice[] = [];
  const keys = new Set<string>();
  const add = (name: string, from: TownChoice['from']) => {
    const key = townKey(name);
    if (!name || name.length > TOWN_NAME_MAX || keys.has(key)) return;
    keys.add(key);
    out.push({ name, from });
  };
  const city = cityAt(pin);
  if (city) add(city.name, 'city');
  const main = offices.filter((o) => o.kind !== 'BO');
  const pool = main.length ? main : offices;
  // "Kovur Cutchery" and "Kukatpally Court Complex" are areas of Kovur and Kukatpally.
  const names = pool.map((o) => placeName(o.name));
  const townOf = (name: string) =>
    names
      .filter((other) => other !== name && name.toLowerCase().startsWith(`${other.toLowerCase()} `))
      .sort((a, b) => a.length - b.length)[0] ?? name;
  for (const { office } of byDistance(pool, pin)) {
    const name = townOf(placeName(office.name));
    const asCity = cityNamed(name);
    add(asCity ? asCity.name : name, asCity ? 'city' : 'post_office');
    if (out.length >= max) break;
  }
  return out;
}

/** Areas near the pin (any post office), nearest first, leaving out the town itself. */
export function areaChoices(offices: readonly PostOffice[], pin: GeoPoint, town: string, max = 5): string[] {
  const out: string[] = [];
  const keys = new Set([townKey(town)]);
  for (const { office, km } of byDistance(offices, pin)) {
    if (km != null && km > 15) break;
    const name = placeName(office.name);
    const key = townKey(name);
    if (!name || name.length > TOWN_NAME_MAX || keys.has(key)) continue;
    keys.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

/** How far the pin is from the nearest of the pincode's offices with a known point; null if none has one. */
export function kmFromPincode(offices: readonly PostOffice[], pin: GeoPoint): number | null {
  return byDistance(offices, pin)[0]?.km ?? null;
}

/** The middle of a pincode's offices that have a point (where the map opens); null if none has one. */
export function pincodeCentre(offices: readonly PostOffice[]): GeoPoint | null {
  const pts = offices.filter((o): o is PostOffice & { latitude: number; longitude: number } => o.latitude != null && o.longitude != null);
  if (!pts.length) return null;
  return {
    latitude: pts.reduce((n, o) => n + o.latitude, 0) / pts.length,
    longitude: pts.reduce((n, o) => n + o.longitude, 0) / pts.length,
  };
}

/** The district and state of a pincode: what most of its offices say. */
export function pincodePlace(offices: readonly PostOffice[]): { district: string; state: string } | null {
  if (!offices.length) return null;
  const vote = (pick: (o: PostOffice) => string) => {
    const counts = new Map<string, number>();
    for (const o of offices) counts.set(pick(o), (counts.get(pick(o)) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  };
  return { district: titleCase(vote((o) => o.district)), state: titleCase(vote((o) => o.state)) };
}

// ─── Checks before opening ──────────────────────────────────────────────────

/** Another branch closer than this needs a "same place?" confirmation. */
export const NEAR_BRANCH_METERS = 300;
/** A pin farther than this from every office of the pincode is probably the wrong pincode or pin. */
export const FAR_FROM_PINCODE_KM = 25;

export const BRANCH_CHECK_KINDS = ['near_branch', 'far_from_pincode', 'new_state', 'similar_town'] as const;
export type BranchCheckKind = (typeof BRANCH_CHECK_KINDS)[number];

export interface BranchCheck {
  kind: BranchCheckKind;
  message: string;
}
