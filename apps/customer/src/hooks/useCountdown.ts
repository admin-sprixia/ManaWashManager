import { useCallback, useEffect, useState } from 'react';

/** Seconds left until something may happen again (e.g. "Send a new code in 24s"). */
export function useCountdown(): [number, (seconds: number) => void] {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until <= now) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until, now]);

  const start = useCallback((seconds: number) => {
    const t = Date.now();
    setNow(t);
    setUntil(t + seconds * 1000);
  }, []);

  return [Math.max(0, Math.ceil((until - now) / 1000)), start];
}
