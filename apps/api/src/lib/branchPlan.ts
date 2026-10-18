import { branchTownRepo, createPlatformDb, type BranchTownRow, type DbClient } from '@mana/db';
import {
  FAR_FROM_PINCODE_KM,
  NEAR_BRANCH_METERS,
  areaChoices,
  branchCode,
  branchName,
  distanceKm,
  inIndia,
  isValidPincode,
  kmFromPincode,
  looksAlike,
  newTownCode,
  nextBranchNumber,
  pincodePlace,
  townChoices,
  townKey,
  type BranchCheck,
  type GeoPoint,
  type TownChoice,
} from '@mana/domain';
import type { Env } from '../types';

/**
 * Everything about a new branch is decided here, never by the phone: which town it is (from the
 * pincode's post offices and the pin), the town's code (kept for good once a town has one), the
 * branch number, its name, and what HQ should check before opening it. The same plan backs the
 * preview HQ sees and the branch that's opened, so they can't differ.
 */

export interface BranchRequest {
  pincode: string;
  latitude: number;
  longitude: number;
  /** One of the town choices (by name); null = the best one. */
  town: string | null;
  /** One of the area choices, or null for none; undefined = the default. */
  area?: string | null;
}

export interface BranchTownPlan {
  name: string;
  code: string;
  nameKey: string;
  district: string;
  state: string;
  /** The business already has this town (its code is reused). */
  existingId: string | null;
}

export interface BranchPlan {
  pincode: string;
  district: string;
  state: string;
  town: BranchTownPlan;
  area: string | null;
  code: string;
  name: string;
  choices: { towns: (TownChoice & { code: string | null })[]; areas: string[] };
  checks: BranchCheck[];
  /** Branches the town already has (to show "the town's 2nd branch"). */
  townBranches: number;
}

export type PlanError =
  | { error: 'unknown_pincode'; message: string }
  | { error: 'outside_india'; message: string }
  | { error: 'no_offices'; message: string }
  | { error: 'bad_choice'; message: string }
  | { error: 'no_code'; message: string }
  /** Opening only: checks HQ hasn't confirmed yet (one may have appeared since the preview). */
  | { error: 'needs_confirmation'; message: string; checks: BranchCheck[]; plan: BranchPlan };

const fail = (error: Exclude<PlanError['error'], 'needs_confirmation'>, message: string): PlanError => ({ error, message });

const prefixOf = (code: string) => (/^[A-Z]{3}-\d{1,4}$/.test(code) ? code.slice(0, 3) : null);

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** The town a name stands for: the business's own town in that district, or a legacy branch's code. */
function existingTown(towns: BranchTownRow[], key: string, district: string, state: string) {
  return towns.find((t) => t.nameKey === key && t.district === district && t.state === state) ?? null;
}

export async function planBranch(env: Env, businessId: string, req: BranchRequest, pdb: DbClient = createPlatformDb(env.DB)): Promise<BranchPlan | PlanError> {
  if (!isValidPincode(req.pincode)) return fail('unknown_pincode', 'Enter the branch’s 6-digit pincode.');
  const pin: GeoPoint = { latitude: req.latitude, longitude: req.longitude };
  if (!inIndia(pin)) return fail('outside_india', 'That location isn’t in India. Pin the branch again.');

  const offices = await branchTownRepo.postOffices(pdb, req.pincode);
  if (!offices.length) {
    if (!(await branchTownRepo.hasPostOffices(pdb))) {
      return fail('no_offices', 'The pincode list isn’t loaded on the server yet. Ask Sprixia to load it.');
    }
    return fail('unknown_pincode', `India Post has no pincode ${req.pincode}. Check it and try again.`);
  }
  const place = pincodePlace(offices)!;
  const [towns, branches] = await Promise.all([branchTownRepo.towns(pdb, businessId), branchTownRepo.branches(pdb, businessId)]);

  // Codes already given: the business's towns, and the town part of every branch code it has.
  const takenCodes = new Set<string>([...towns.map((t) => t.code), ...branches.map((b) => prefixOf(b.code)).filter((c): c is string => !!c)]);
  const legacyCode = (key: string) => {
    const legacy = branches.find((b) => !b.townId && b.city && townKey(b.city) === key && prefixOf(b.code));
    return legacy ? prefixOf(legacy.code) : null;
  };
  const codeFor = (name: string): { code: string | null; existingId: string | null } => {
    const key = townKey(name);
    const own = existingTown(towns, key, place.district, place.state);
    if (own) return { code: own.code, existingId: own.id };
    const legacy = legacyCode(key);
    if (legacy && !towns.some((t) => t.code === legacy)) return { code: legacy, existingId: null };
    return { code: newTownCode(name, takenCodes), existingId: null };
  };

  // The town: one of the choices (or a town the business already has nearby, picked from a check).
  const choices = townChoices(offices, pin);
  const sameDistrict = towns.filter((t) => t.district === place.district && t.state === place.state);
  let townName: string;
  if (req.town == null || req.town.trim() === '') {
    townName = choices[0]?.name ?? '';
  } else {
    const key = townKey(req.town);
    const match = choices.find((c) => townKey(c.name) === key) ?? sameDistrict.find((t) => t.nameKey === key);
    if (!match) return fail('bad_choice', 'Pick the town from the list.');
    townName = match.name;
  }
  if (!townName) return fail('unknown_pincode', `India Post lists no town for ${req.pincode}.`);
  const townCode = codeFor(townName);
  if (!townCode.code) return fail('no_code', `Every code starting with ${townName[0]?.toUpperCase()} is taken. Ask Sprixia for help.`);
  const town: BranchTownPlan = {
    name: townName,
    code: townCode.code,
    nameKey: townKey(townName),
    district: place.district,
    state: place.state,
    existingId: townCode.existingId,
  };
  const townBranches = branches.filter((b) => (town.existingId && b.townId === town.existingId) || prefixOf(b.code) === town.code).length;

  // The area: one of the choices, or none. A city's branches and a town's second branch get one.
  const areas = areaChoices(offices, pin, town.name);
  let area: string | null;
  if (req.area === undefined) {
    area = choices.find((c) => townKey(c.name) === town.nameKey)?.from === 'city' || townBranches > 0 ? (areas[0] ?? null) : null;
  } else if (req.area === null || req.area.trim() === '') {
    area = null;
  } else {
    const key = townKey(req.area);
    area = areas.find((a) => townKey(a) === key) ?? null;
    if (!area) return fail('bad_choice', 'Pick the area from the list.');
  }

  const number = nextBranchNumber(await branchTownRepo.codesStartingWith(pdb, town.code), town.code);
  const name = branchName({
    town: town.name,
    area,
    district: town.district,
    taken: branches.map((b) => b.name),
    townHasBranches: townBranches > 0,
  });

  const checks: BranchCheck[] = [];
  const fromPincode = kmFromPincode(offices, pin);
  if (fromPincode != null && fromPincode > FAR_FROM_PINCODE_KM) {
    checks.push({
      kind: 'far_from_pincode',
      message: `The pin is ${formatDistance(fromPincode)} from pincode ${req.pincode}. Check the pincode and the pin.`,
    });
  }
  const near = branches
    .filter((b) => b.status !== 'closed' && b.latitude != null && b.longitude != null)
    .map((b) => ({ b, km: distanceKm(pin, { latitude: b.latitude!, longitude: b.longitude! }) }))
    .filter((x) => x.km * 1000 < NEAR_BRANCH_METERS)
    .sort((a, b) => a.km - b.km)[0];
  if (near) {
    checks.push({
      kind: 'near_branch',
      message: `${near.b.name} (${near.b.code}) is only ${formatDistance(near.km)} away. Is this really a new branch?`,
    });
  }
  if (towns.length > 0 && !towns.some((t) => t.state === place.state)) {
    checks.push({ kind: 'new_state', message: `This is the first branch in ${place.state}.` });
  }
  if (!town.existingId) {
    const alike = sameDistrict.find((t) => looksAlike(t.name, town.name));
    if (alike) {
      checks.push({
        kind: 'similar_town',
        message: `You already have ${alike.name} (${alike.code}) in ${place.district}. If it’s the same town, pick ${alike.name} instead.`,
      });
    }
  }

  return {
    pincode: req.pincode,
    district: place.district,
    state: place.state,
    town,
    area,
    code: branchCode(town.code, number),
    name,
    choices: {
      towns: [
        ...choices.map((c) => ({ ...c, code: codeFor(c.name).code })),
        ...sameDistrict
          .filter((t) => !choices.some((c) => townKey(c.name) === t.nameKey))
          .filter((t) => looksAlike(t.name, town.name))
          .map((t) => ({ name: t.name, from: 'post_office' as const, code: t.code })),
      ],
      areas,
    },
    checks,
    townBranches,
  };
}

export const isPlanError = (p: BranchPlan | PlanError): p is PlanError => 'error' in p;
