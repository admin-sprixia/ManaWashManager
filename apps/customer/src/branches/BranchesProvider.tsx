import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, send } from '../api/client';
import { errorMessage } from '../api/errors';
import type { Branch } from '../api/types';

const CACHE_KEY = 'manacarwash.branches';

interface BranchesValue {
  /** Every branch in the app, last good copy (from this phone's cache until the network answers). */
  branches: Branch[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  byId: (id: string) => Branch | undefined;
}

const BranchesContext = createContext<BranchesValue | null>(null);

/**
 * Branch contact details, hours and price lists change rarely and several screens need them
 * (Visit us, the live card, adding a vehicle, rating), so they're loaded once and cached.
 */
export function BranchesProvider({ children }: { children: React.ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const body = await send(api.branches.$get());
      setBranches(body.branches);
      setError(null);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(body.branches)).catch(() => undefined);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached && !cancelled) {
          const parsed: unknown = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            setBranches(parsed as Branch[]);
            setLoading(false);
          }
        }
      } catch {
        // A broken cache just means waiting for the network.
      }
      if (!cancelled) await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const value = useMemo<BranchesValue>(
    () => ({ branches, loading, error, reload, byId: (id) => branches.find((b) => b.id === id) }),
    [branches, loading, error, reload],
  );
  return <BranchesContext.Provider value={value}>{children}</BranchesContext.Provider>;
}

export function useBranches(): BranchesValue {
  const ctx = useContext(BranchesContext);
  if (!ctx) throw new Error('useBranches must be used inside BranchesProvider');
  return ctx;
}
