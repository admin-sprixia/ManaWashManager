import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isRewardEligiblePlate } from '@mana/domain';
import { api } from '../../api/client';
import type { DirectoryEntry } from '../../offline/directory';
import type { RewardCard, RewardGift } from '../../offline/types';
import { liveCards } from '../../utils/rewards';

const DEBOUNCE_MS = 400;
const MIN_PLATE_LENGTH = 4;

interface LiveRewards {
  reg: string;
  isNew: boolean;
  cards: RewardCard[];
  giftsOwed: RewardGift[];
}

export interface VehicleRewards {
  /** Walk-in plates never collect stamps or gifts. */
  eligible: boolean;
  cards: RewardCard[];
  /** Owed gift items with details — only known when read from the server just now. */
  giftsOwed: RewardGift[];
  /** Owed gift items, also known offline (from the saved directory). */
  giftsOwedCount: number;
  /** No wash on file for this car yet: its first paid wash gets the welcome gift. */
  isNew: boolean;
  /** True when the cards came from the server just now (a free wash can only be used then). */
  live: boolean;
  loading: boolean;
  reload: () => void;
}

/**
 * The car's stamp cards and owed welcome gifts for New Wash. Read from the server when online
 * (always current, needed to use a free wash), otherwise from this phone's saved directory.
 */
export function useVehicleRewards(
  registration: string,
  entry: DirectoryEntry | null,
  options: { enabled: boolean; online: boolean },
): VehicleRewards {
  const reg = registration;
  const eligible = reg.length >= MIN_PLATE_LENGTH && isRewardEligiblePlate(reg);
  const ask = options.enabled && options.online && eligible;
  const [live, setLive] = useState<LiveRewards | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    if (!ask) {
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.rewards.vehicle.$get({ query: { registrationNumber: reg } });
        if (mine !== seq.current) return;
        if (!res.ok) {
          setLive(null);
          return;
        }
        const body = await res.json();
        setLive({
          reg,
          isNew: body.isNew,
          cards: body.cards as RewardCard[],
          giftsOwed: body.giftsOwed as RewardGift[],
        });
      } catch {
        // Offline or a hiccup: fall back to the saved copy.
        if (mine === seq.current) setLive(null);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    };
    const t = setTimeout(() => void load(), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [reg, ask, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return useMemo<VehicleRewards>(() => {
    if (!options.enabled || !eligible) {
      return { eligible, cards: [], giftsOwed: [], giftsOwedCount: 0, isNew: false, live: false, loading: false, reload };
    }
    const fresh = live && live.reg === reg && options.online ? live : null;
    if (fresh) {
      return {
        eligible,
        cards: liveCards(fresh.cards),
        giftsOwed: fresh.giftsOwed,
        giftsOwedCount: fresh.giftsOwed.length,
        isNew: fresh.isNew,
        live: true,
        loading,
        reload,
      };
    }
    const saved = entry && entry.registrationNumber === reg ? entry : null;
    return {
      eligible,
      cards: liveCards(saved?.rewardCards),
      giftsOwed: [],
      giftsOwedCount: saved?.giftsOwed ?? 0,
      isNew: !saved || saved.visitCount === 0,
      live: false,
      loading,
      reload,
    };
  }, [options.enabled, options.online, eligible, live, reg, entry, loading, reload]);
}
