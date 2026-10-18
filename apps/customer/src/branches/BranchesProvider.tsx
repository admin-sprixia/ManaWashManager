import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, send } from '../api/client';
import { errorMessage } from '../api/errors';
import type { VehicleModelEdit } from '@mana/domain';
import type { Branch } from '../api/types';

const CACHE_KEY = 'manawash.branches';
const MODELS_KEY = 'manawash.vehicleModels';

interface BranchesValue {
  /** Every branch in the app, last good copy (from this phone's cache until the network answers). */
  branches: Branch[];
  /** Head office's changes to the list of companies and models (for adding a vehicle). */
  vehicleModels: VehicleModelEdit[];
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
  const [vehicleModels, setVehicleModels] = useState<VehicleModelEdit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const body = await send(api.branches.$get());
      setBranches(body.branches);
      setVehicleModels(body.vehicleModels);
      setError(null);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(body.branches)).catch(() => undefined);
      await AsyncStorage.setItem(MODELS_KEY, JSON.stringify(body.vehicleModels)).catch(() => undefined);
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
        const models = await AsyncStorage.getItem(MODELS_KEY);
        if (models && !cancelled) {
          const parsed: unknown = JSON.parse(models);
          if (Array.isArray(parsed)) setVehicleModels(parsed as VehicleModelEdit[]);
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
    () => ({ branches, vehicleModels, loading, error, reload, byId: (id) => branches.find((b) => b.id === id) }),
    [branches, vehicleModels, loading, error, reload],
  );
  return <BranchesContext.Provider value={value}>{children}</BranchesContext.Provider>;
}

export function useBranches(): BranchesValue {
  const ctx = useContext(BranchesContext);
  if (!ctx) throw new Error('useBranches must be used inside BranchesProvider');
  return ctx;
}
