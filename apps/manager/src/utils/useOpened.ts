import { useEffect, useState } from 'react';

interface TransitionSource {
  addListener: (event: 'transitionEnd', callback: () => void) => () => void;
}

/**
 * True once the screen has finished sliding in (or shortly after, if no transition runs).
 * Heavy parts and network work wait for it, so the slide-in never competes with them.
 */
export function useOpened(navigation: TransitionSource, fallbackMs = 450): boolean {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    const done = () => setOpened(true);
    const off = navigation.addListener('transitionEnd', done);
    const t = setTimeout(done, fallbackMs);
    return () => {
      off();
      clearTimeout(t);
    };
  }, [navigation, fallbackMs]);
  return opened;
}
