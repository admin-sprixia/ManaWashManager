import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * The current time, refreshed every minute (and when the app comes back to the front), for
 * screens whose rules change with time on their own, such as a paid wash's amount hiding from
 * staff 15 minutes after collecting.
 */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    // Line up with the start of the next minute, then every minute.
    let interval: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000));
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
      sub.remove();
    };
  }, []);
  return now;
}
