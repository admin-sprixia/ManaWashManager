import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import type { PlanLimits, PlanState, PlanTier } from '@mana/domain';
import { useAuth } from '../api/auth';
import { Pill } from '../components/EdgeList';
import { api } from '../api/client';
import { istDate } from '../utils/format';
import { useSync } from './SyncProvider';
import { CacheKeys, readCache, writeCache } from './cache';

/** The shop's plan as last read from the server, kept for offline. */
export interface PlanSnapshot {
  tier: PlanTier;
  state: PlanState;
  endsAt: string | null;
  daysLeft: number | null;
  limits: PlanLimits;
  washesThisMonth: number;
  /** IST month (YYYY-MM) the wash count is for; a new month starts from zero. */
  month: string;
}

interface PlanContextValue {
  /** Null until the first read on this phone — nothing is locked while it's unknown. */
  plan: PlanSnapshot | null;
  isPro: boolean;
  /** On the free Pro trial — Pro features work, but owners should see which ones need Pro later. */
  onTrial: boolean;
  /** Washes started this month, including ones on this phone that haven't synced yet. */
  washesUsed: number;
  /** Free plan: washes left this month (never negative); null when unlimited. */
  washesLeft: number | null;
  atWashLimit: boolean;
  refreshPlan: () => Promise<void>;
}

const PlanContext = createContext<PlanContextValue | null>(null);

const currentMonth = () => istDate(0).slice(0, 7);

/**
 * Which plan the shop is on, for showing the right screens: Pro features are hidden or marked on
 * Free, and New Wash stops at the monthly limit. The server enforces all of it regardless; this
 * just means people see an upgrade screen instead of an error.
 */
export function PlanProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { online, items: outbox, version } = useSync();
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    void readCache<PlanSnapshot>(CacheKeys.plan).then((saved) => setPlan(saved));
  }, [userId]);

  const refreshPlan = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.billing.plan.$get();
      if (!res.ok) return;
      const body = await res.json();
      const next: PlanSnapshot = {
        tier: body.tier,
        state: body.state,
        endsAt: body.endsAt,
        daysLeft: body.daysLeft,
        limits: body.limits,
        washesThisMonth: body.usage.washesThisMonth,
        month: currentMonth(),
      };
      setPlan(next);
      void writeCache(CacheKeys.plan, next);
    } catch {
      // Offline: keep the cached copy.
    }
  }, [userId]);

  // On reconnect, after each sync (a synced wash changes the count) and on returning to the app.
  useEffect(() => {
    if (online) void refreshPlan();
  }, [online, version, refreshPlan]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPlan();
    });
    return () => sub.remove();
  }, [refreshPlan]);

  const value = useMemo<PlanContextValue>(() => {
    // A Pro period that ran out while offline ends on time here too.
    const lapsed = plan?.tier === 'pro' && plan.endsAt != null && Date.parse(plan.endsAt) <= Date.now();
    const isPro = plan == null || (plan.tier === 'pro' && !lapsed);
    const synced = plan && plan.month === currentMonth() ? plan.washesThisMonth : 0;
    const queued = outbox.filter((i) => i.op.kind === 'job.start' && i.state === 'pending').length;
    const washesUsed = synced + queued;
    const limit = isPro ? null : (plan?.limits.washesPerMonth ?? null);
    const washesLeft = limit == null ? null : Math.max(0, limit - washesUsed);
    return {
      plan,
      isPro,
      onTrial: isPro && plan?.state === 'trial',
      washesUsed,
      washesLeft,
      atWashLimit: washesLeft === 0,
      refreshPlan,
    };
  }, [plan, outbox, refreshPlan]);

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used inside PlanProvider');
  return ctx;
}

/**
 * The PRO tag for a Pro feature's row: grey on Free (tapping explains and offers the upgrade),
 * teal on the trial so owners learn what stays with Pro, and nothing once Pro is paid.
 */
export function useProPill(): React.ReactElement | undefined {
  const { isPro, onTrial } = usePlan();
  if (!isPro) return <Pill label="PRO" tone="slate" />;
  return onTrial ? <Pill label="PRO" tone="teal" /> : undefined;
}
