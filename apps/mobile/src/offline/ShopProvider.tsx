import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import {
  roundStock,
  stockLevel,
  toStockQuantity,
  type StockLevel,
  type StockUnit,
} from '@mana/domain';
import { useAuth } from '../api/auth';
import { api } from '../api/client';
import { setShopName } from '../config/shop';
import { flushErrors } from '../utils/errorReporter';
import { useSync } from './SyncProvider';
import { CacheKeys, readCache, writeCache } from './cache';
import type { OutboxItem } from './types';

export interface RosterMember {
  id: string;
  name: string;
  role: string;
}

export interface ShopInfo {
  name: string;
  city: string | null;
  /** 6-digit shop ID new teammates type to ask to join. */
  code: string;
}

/** One of the shops this person can open — owners running several branches see them all. */
export interface MyShop {
  shopId: string;
  name: string;
  city: string | null;
  code: string;
  current: boolean;
}

interface ShopSnapshot {
  info: ShopInfo | null;
  googleReviewUrl: string | null;
  roster: RosterMember[];
  myShops: MyShop[];
  canAddShop: boolean;
}

const EMPTY: ShopSnapshot = {
  info: null,
  googleReviewUrl: null,
  roster: [],
  myShops: [],
  canAddShop: false,
};

export interface StockItemView {
  id: string;
  name: string;
  unit: StockUnit;
  balance: number;
  lowAt: number | null;
  level: StockLevel;
  usedWeek: number;
  /** Set on the phone when a use / count on this item hasn't synced yet. */
  pending?: boolean;
}

/** Server balances with this phone's unsynced stock entries applied on top. */
function withPendingMoves(items: StockItemView[], outbox: OutboxItem[]): StockItemView[] {
  const moves = outbox.flatMap((i) =>
    i.op.kind === 'stock.move' && i.state === 'pending' ? [i.op.payload] : [],
  );
  if (moves.length === 0) return items;
  return items.map((item) => {
    const mine = moves.filter((m) => m.itemId === item.id);
    if (mine.length === 0) return item;
    let balance = item.balance;
    let usedWeek = item.usedWeek;
    for (const m of mine) {
      const q = toStockQuantity(m.quantity, m.unit, item.unit);
      if (q == null) continue;
      if (m.kind === 'use') {
        // Same as the server: use never takes the books below zero.
        balance = Math.max(0, balance - q);
        usedWeek += q;
      } else if (m.kind === 'in') balance += q;
      else balance = q;
    }
    balance = roundStock(balance);
    return {
      ...item,
      balance,
      usedWeek: roundStock(usedWeek),
      level: stockLevel(balance, item.lowAt),
      pending: true,
    };
  });
}

interface ShopContextValue extends ShopSnapshot {
  refresh: () => Promise<void>;
  /** Applies a saved change immediately instead of waiting for the next pull. */
  setGoogleReviewUrl: (url: string | null) => void;
  /** Owner only: errors logged since the error log was last opened. */
  unseenErrors: number;
  markErrorsSeen: () => void;
  /** Owner only: people waiting for approval to join the team. */
  joinRequests: number;
  /** Inventory, cached for offline, with unsynced entries from this phone applied. */
  stock: StockItemView[];
  /** Items at or under their alert level, or out. */
  lowStock: number;
  refreshStock: () => Promise<void>;
}

const ShopContext = createContext<ShopContextValue | null>(null);

/**
 * Small, rarely-changing shop data every phone needs offline: the shop's name and ID, the review
 * link that goes in thank-you messages, and who's on the team (for picking washers). For the
 * owner, also the new-error count and join requests, re-read on reconnect and whenever the app
 * comes to the foreground.
 */
export function ShopProvider({ children }: { children: React.ReactNode }) {
  const { user, isOwner } = useAuth();
  const { online, items: outbox, version } = useSync();
  const [snapshot, setSnapshot] = useState<ShopSnapshot>(EMPTY);
  const [unseenErrors, setUnseenErrors] = useState(0);
  const [joinRequests, setJoinRequests] = useState(0);
  const [serverStock, setServerStock] = useState<StockItemView[]>([]);
  const userId = user?.id ?? null;

  useEffect(() => {
    void readCache<Partial<ShopSnapshot>>(CacheKeys.shop).then((saved) => {
      setSnapshot(saved ? { ...EMPTY, ...saved } : EMPTY);
    });
    void readCache<StockItemView[]>(CacheKeys.stock).then((saved) => setServerStock(saved ?? []));
  }, [userId]);

  const refreshStock = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.stock.$get();
      if (res.status === 402) {
        // Inventory is Pro: drop stock cached during a trial so no low-stock nags linger.
        setServerStock([]);
        void writeCache(CacheKeys.stock, []);
        return;
      }
      if (!res.ok) return;
      const body = await res.json();
      const next = body.items.map((i) => ({
        id: i.id,
        name: i.name,
        unit: i.unit as StockUnit,
        balance: i.balance,
        lowAt: i.lowAt,
        level: i.level,
        usedWeek: i.usedWeek,
      }));
      setServerStock(next);
      void writeCache(CacheKeys.stock, next);
    } catch {
      // Offline: keep the cached list.
    }
  }, [userId]);

  // A synced stock entry or expense changes balances.
  useEffect(() => {
    if (online) void refreshStock();
  }, [online, version, refreshStock]);

  const commit = useCallback((next: ShopSnapshot) => {
    setSnapshot(next);
    void writeCache(CacheKeys.shop, next);
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    void flushErrors();
    if (isOwner) {
      api.shop.errors.unseen
        .$get()
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (body) setUnseenErrors(body.count);
        })
        .catch(() => undefined);
      api.team.requests
        .$get()
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (Array.isArray(body)) setJoinRequests(body.length);
        })
        .catch(() => undefined);
    } else {
      setUnseenErrors(0);
      setJoinRequests(0);
    }
    try {
      const [infoRes, settingsRes, rosterRes, shopsRes] = await Promise.all([
        api.shop.info.$get(),
        api.shop.settings.$get(),
        api.shop.roster.$get(),
        isOwner ? api.auth.shops.$get() : null,
      ]);
      if (!infoRes.ok || !settingsRes.ok || !rosterRes.ok) return;
      const [info, settings, roster, shops] = await Promise.all([
        infoRes.json(),
        settingsRes.json(),
        rosterRes.json(),
        shopsRes?.ok ? shopsRes.json() : null,
      ]);
      commit({
        info: 'code' in info ? { name: info.name, city: info.city, code: info.code } : null,
        googleReviewUrl: settings.googleReviewUrl ?? null,
        roster,
        myShops: shops?.shops ?? [],
        canAddShop: shops?.canAdd ?? false,
      });
    } catch {
      // Offline: keep the cached copy.
    }
  }, [userId, isOwner, commit]);

  const markErrorsSeen = useCallback(() => {
    setUnseenErrors(0);
    api.shop.errors.seen.$post().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const shopName = snapshot.info?.name ?? null;
  useEffect(() => {
    setShopName(shopName);
  }, [shopName]);

  const setGoogleReviewUrl = useCallback(
    (url: string | null) => commit({ ...snapshot, googleReviewUrl: url }),
    [snapshot, commit],
  );

  const stock = useMemo(() => withPendingMoves(serverStock, outbox), [serverStock, outbox]);
  const lowStock = useMemo(() => stock.filter((s) => s.level !== 'ok').length, [stock]);

  const value = useMemo(
    () => ({
      ...snapshot,
      refresh,
      setGoogleReviewUrl,
      unseenErrors,
      markErrorsSeen,
      joinRequests,
      stock,
      lowStock,
      refreshStock,
    }),
    [
      snapshot,
      refresh,
      setGoogleReviewUrl,
      unseenErrors,
      markErrorsSeen,
      joinRequests,
      stock,
      lowStock,
      refreshStock,
    ],
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopContextValue {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error('useShop must be used inside ShopProvider');
  return ctx;
}
