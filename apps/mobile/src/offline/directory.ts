import { api, apiErrorMessage } from '../api/client';
import { CacheKeys, readCache, writeCache } from './cache';

/** One vehicle + its owner, as New Wash suggests them. Mirrors the API's DirectoryEntry. */
export interface DirectoryEntry {
  vehicleId: string;
  registrationNumber: string;
  vehicleTypeId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  visitCount: number;
  lastVisit: string | null;
  lastServices: { serviceId: string; quantity: number }[];
  updatedAt: string;
  /** Written on this phone by a wash that hasn't been confirmed by a server sync yet. */
  local?: boolean;
}

export interface DirectorySnapshot {
  /** Keyed by registration number — the one thing that never changes for a vehicle. */
  entries: Record<string, DirectoryEntry>;
  cursor: string | null;
  lastSyncAt: number | null;
  lastFullSyncAt: number | null;
}

export const EMPTY_DIRECTORY: DirectorySnapshot = {
  entries: {},
  cursor: null,
  lastSyncAt: null,
  lastFullSyncAt: null,
};

const PAGE_SIZE = 200;
/** Safety stop so a server bug can never page forever (200 × 250 = 50k vehicles). */
const MAX_PAGES = 250;
/**
 * Each incremental pull re-reads a short window before the cursor. A write stamped just
 * before a page was read but committed just after would otherwise be skipped for good.
 */
const CURSOR_OVERLAP_MS = 2 * 60_000;
/** A full re-download catches anything incremental sync can't see (e.g. a database reset). */
export const FULL_SYNC_EVERY_MS = 24 * 60 * 60_000;

interface DirectoryPage {
  entries: DirectoryEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function loadDirectory(): Promise<DirectorySnapshot> {
  return (await readCache<DirectorySnapshot>(CacheKeys.directory)) ?? EMPTY_DIRECTORY;
}

export async function saveDirectory(snapshot: DirectorySnapshot): Promise<void> {
  await writeCache(CacheKeys.directory, snapshot);
}

function rewind(cursor: string): string {
  const [iso] = cursor.split('|');
  const t = new Date(iso ?? '').getTime();
  return Number.isNaN(t) ? '' : `${new Date(t - CURSOR_OVERLAP_MS).toISOString()}|`;
}

async function fetchPage(cursor: string | null): Promise<DirectoryPage> {
  const res = await api.customers.directory.$get({
    query: { limit: String(PAGE_SIZE), ...(cursor ? { cursor } : {}) },
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res));
  return (await res.json()) as DirectoryPage;
}

/**
 * Brings the snapshot up to date with the server. Full download when there's no cursor or the
 * last full one is a day old; otherwise only rows changed since the cursor. Throws on network
 * failure so the caller can keep the snapshot it had.
 */
export async function syncDirectory(
  current: DirectorySnapshot,
  now = Date.now(),
): Promise<DirectorySnapshot> {
  const full =
    !current.cursor || !current.lastFullSyncAt || now - current.lastFullSyncAt > FULL_SYNC_EVERY_MS;

  const fresh: Record<string, DirectoryEntry> = full ? {} : { ...current.entries };
  let cursor: string | null = full ? null : rewind(current.cursor!) || null;
  let lastCursor = current.cursor;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await fetchPage(cursor);
    for (const entry of body.entries) fresh[entry.registrationNumber] = entry;
    if (body.nextCursor) lastCursor = body.nextCursor;
    if (!body.hasMore || !body.nextCursor) break;
    cursor = body.nextCursor;
  }

  // A wash saved offline isn't on the server yet — keep its row until the server's copy arrives.
  if (full) {
    for (const entry of Object.values(current.entries)) {
      if (entry.local && !fresh[entry.registrationNumber]) fresh[entry.registrationNumber] = entry;
    }
  }

  return {
    entries: fresh,
    cursor: lastCursor,
    lastSyncAt: now,
    lastFullSyncAt: full ? now : current.lastFullSyncAt,
  };
}

export interface LocalVisit {
  registrationNumber: string;
  vehicleTypeId: string;
  customerName: string;
  customerPhone: string;
  services: { serviceId: string; quantity: number }[];
  /** Set when the operator said a known vehicle's owner simply changed numbers. */
  samePersonAs?: DirectoryEntry | null;
  at: string;
}

/**
 * Applies a just-started wash to the snapshot, the same way the server will, so the customer
 * is recognised on this phone straight away — even while the wash is still queued offline.
 */
export function applyLocalVisit(snapshot: DirectorySnapshot, visit: LocalVisit): DirectorySnapshot {
  const entries = { ...snapshot.entries };
  const all = Object.values(entries);

  if (visit.samePersonAs) {
    const ownerId = visit.samePersonAs.customerId;
    for (const e of all) {
      if (e.customerId === ownerId)
        entries[e.registrationNumber] = { ...e, customerPhone: visit.customerPhone };
    }
  }

  const sibling = Object.values(entries).find((e) => e.customerPhone === visit.customerPhone);
  const customerId = sibling?.customerId ?? `local:${visit.customerPhone}`;
  const visitCount = (sibling?.visitCount ?? 0) + 1;

  for (const e of Object.values(entries)) {
    if (e.customerId === customerId) {
      entries[e.registrationNumber] = {
        ...e,
        customerName: visit.customerName,
        visitCount,
        lastVisit: visit.at,
      };
    }
  }

  const existing = entries[visit.registrationNumber];
  entries[visit.registrationNumber] = {
    vehicleId: existing?.vehicleId ?? `local:${visit.registrationNumber}`,
    registrationNumber: visit.registrationNumber,
    vehicleTypeId: visit.vehicleTypeId,
    customerId,
    customerName: visit.customerName,
    customerPhone: visit.customerPhone,
    visitCount,
    lastVisit: visit.at,
    lastServices: visit.services,
    updatedAt: visit.at,
    local: true,
  };

  return { ...snapshot, entries };
}
