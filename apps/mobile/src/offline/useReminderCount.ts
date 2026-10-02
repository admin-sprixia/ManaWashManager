import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useSync } from './SyncProvider';
import { usePlan } from './PlanProvider';

/**
 * Badge count for the Job Board's bell: vehicles due a follow-up that nobody has acted on,
 * plus referral rewards not yet sent to the customer.
 * Re-read whenever the board regains focus or something reaches the server. Offline, the
 * last known count stays.
 */
export function useReminderCount(): number {
  const { version } = useSync();
  const { isPro } = usePlan();
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      // Reminders are a Pro feature; on Free the bell opens the upgrade sheet instead.
      if (!isPro) return;
      let alive = true;
      api.reminders
        .$get()
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (alive && data) setCount(data.actionable);
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version, isPro]),
  );

  return isPro ? count : 0;
}
