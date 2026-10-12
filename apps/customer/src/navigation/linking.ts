import { Linking } from 'react-native';
import type { LinkingOptions, PathConfigMap } from '@react-navigation/native';

/** The app's own links: `manacarwash://place/AB12CD3` (QR posters, shared links) and `manacarwash://payment/<id>` (back from checkout). */
export const LINK_PREFIX = 'manacarwash://';

let held: string | null = null;
let launchChecked = false;

/**
 * A link that opened the app (or arrived) while no navigator could take it, signed out or still
 * checking the session. The next navigator to mount opens it, once.
 */
async function takeLink(): Promise<string | null> {
  if (!launchChecked) {
    launchChecked = true;
    const launch = await Linking.getInitialURL().catch(() => null);
    if (launch && !held) held = launch;
  }
  const url = held;
  held = null;
  return url;
}

/** While signed out: keeps links that arrive so they open after sign-in. Returns the unsubscribe. */
export function holdIncomingLinks(): () => void {
  const sub = Linking.addEventListener('url', ({ url }) => {
    held = url;
  });
  return () => sub.remove();
}

/** Linking for one navigator: the held link first, then live ones. */
export function linkingFor<T extends object>(screens: PathConfigMap<T>): LinkingOptions<T> {
  return {
    prefixes: [LINK_PREFIX],
    config: { screens },
    getInitialURL: takeLink,
    subscribe(listener) {
      const sub = Linking.addEventListener('url', ({ url }) => listener(url));
      return () => sub.remove();
    },
  };
}
