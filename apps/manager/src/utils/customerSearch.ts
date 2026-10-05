import { normalizePhone } from '@mana/domain';
import type { DirectoryEntry } from '../offline/directory';
import { normalizeReg } from './services';

export type MatchField = 'plate' | 'phone' | 'name';

export interface SearchHit {
  entry: DirectoryEntry;
  field: MatchField;
  /** The part of the matched field to emphasise, in that field's own formatting. */
  needle: string;
}

/** What the operator seems to have typed, used to pre-fill the new-customer form. */
export type QueryKind = 'plate' | 'phone' | 'name' | 'empty';

export const MIN_QUERY_LENGTH = 2;

export function classifyQuery(query: string): QueryKind {
  const q = query.trim();
  if (!q) return 'empty';
  const hasDigits = /\d/.test(q);
  const hasLetters = /[a-z]/i.test(q);
  if (hasDigits && hasLetters) return 'plate';
  if (hasLetters) return 'name';
  return q.replace(/\D/g, '').length >= 7 ? 'phone' : 'plate';
}

function recency(e: DirectoryEntry): number {
  return e.lastVisit ? new Date(e.lastVisit).getTime() : 0;
}

/**
 * Ranks directory rows against one free-text query: plate, phone digits or name. Plates win
 * ties because that's what staff read off the vehicle; "9561" finds AP39AV9561 because people
 * remember the last digits. Equal scores fall back to most recent visit.
 */
export function searchDirectory(entries: DirectoryEntry[], query: string, limit = 6): SearchHit[] {
  const raw = query.trim();
  if (raw.length < MIN_QUERY_LENGTH) return [];
  const reg = normalizeReg(raw);
  const digits = raw.replace(/\D/g, '');
  const phone = digits.length > 10 ? normalizePhone(digits) : digits;
  const name = raw.toLowerCase();
  const hasLetters = /[a-z]/i.test(raw);

  const scored: { hit: SearchHit; score: number }[] = [];
  for (const entry of entries) {
    let best: { field: MatchField; needle: string; score: number } | null = null;
    const consider = (field: MatchField, needle: string, score: number) => {
      if (!best || score > best.score) best = { field, needle, score };
    };

    if (reg.length >= MIN_QUERY_LENGTH) {
      const plate = entry.registrationNumber;
      if (plate === reg) consider('plate', reg, 100);
      else if (plate.endsWith(reg)) consider('plate', reg, 80);
      else if (plate.startsWith(reg)) consider('plate', reg, 72);
      else if (plate.includes(reg)) consider('plate', reg, 55);
    }

    if (!hasLetters && phone.length >= 3) {
      const p = entry.customerPhone;
      if (p === phone) consider('phone', phone, 95);
      else if (p.startsWith(phone)) consider('phone', phone, 62);
      else if (p.endsWith(phone)) consider('phone', phone, 58);
      else if (p.includes(phone)) consider('phone', phone, 45);
    }

    if (hasLetters && entry.customerName) {
      const n = entry.customerName.toLowerCase();
      if (n.startsWith(name)) consider('name', raw, 66);
      else if (n.split(/\s+/).some((w) => w.startsWith(name))) consider('name', raw, 58);
      else if (name.length >= 3 && n.includes(name)) consider('name', raw, 36);
    }

    const b = best as { field: MatchField; needle: string; score: number } | null;
    if (b) scored.push({ hit: { entry, field: b.field, needle: b.needle }, score: b.score });
  }

  return scored
    .sort((a, b) => b.score - a.score || recency(b.hit.entry) - recency(a.hit.entry))
    .slice(0, limit)
    .map((s) => s.hit);
}

/** Most recently seen vehicles, for the empty search state. */
export function recentEntries(entries: DirectoryEntry[], limit = 5): DirectoryEntry[] {
  return entries
    .filter((e) => e.lastVisit)
    .sort((a, b) => recency(b) - recency(a))
    .slice(0, limit);
}

export function entriesForCustomer(
  entries: DirectoryEntry[],
  customerId: string,
): DirectoryEntry[] {
  return entries.filter((e) => e.customerId === customerId);
}

export function findByPhone(entries: DirectoryEntry[], phone: string): DirectoryEntry | null {
  let best: DirectoryEntry | null = null;
  for (const e of entries) {
    if (e.customerPhone === phone && (!best || recency(e) > recency(best))) best = e;
  }
  return best;
}

/** "98•••••111" — enough to confirm with the customer without reading out their number. */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return phone;
  return `${phone.slice(0, 2)}${'•'.repeat(phone.length - 5)}${phone.slice(-3)}`;
}

export function formatPhone(phone: string): string {
  return phone.length === 10 ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}
