import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';

/** While the board is open the inbox count is checked this often, so a new question shows up. */
const REFRESH_MS = 60_000;

/**
 * Badge count for the board's WhatsApp button: customers waiting for a reply the assistant
 * couldn't give. Owners and managers only (`enabled`); offline, the last known count stays.
 */
export function useInboxCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      let alive = true;
      const read = () =>
        api.whatsapp.inbox.count
          .$get()
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (alive && data) setCount(data.waiting);
          })
          .catch(() => undefined);
      void read();
      const timer = setInterval(() => void read(), REFRESH_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [enabled]),
  );

  return enabled ? count : 0;
}
