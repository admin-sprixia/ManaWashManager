import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './client';
import { subscribePinUpgradeRequired, subscribeSessionInvalid } from './network';
import {
  clearSession,
  getCacheShop,
  getSessionToken,
  getSessionUser,
  setCacheShop,
  setLastShop,
  setSessionToken,
  setSessionUser,
  type SessionUser,
} from './session';
import { clearCaches } from '../offline/cache';

interface AuthContextValue {
  loggedIn: boolean;
  checking: boolean;
  user: SessionUser | null;
  isOwner: boolean;
  /** Runs the team (staff only) without the owner's money and price screens. */
  isManager: boolean;
  /** Owner or manager: can open Team. */
  canManageTeam: boolean;
  /** Mana Wash HQ who work at no branch: the app opens on the HQ home, with no branch screens. */
  hqOnly: boolean;
  /** Why the last session ended, when it wasn't the user's choice — shown on the login screen. */
  sessionNotice: string | null;
  /** Shown once after signing in, e.g. who reset this person's PIN. */
  signInNotice: string | null;
  setSignInNotice: (notice: string | null) => void;
  signIn: (token: string, user: SessionUser) => Promise<void>;
  /** People at several branches: opens another of their branches without signing in again. */
  switchShop: (shopId: string) => Promise<void>;
  signOut: () => Promise<void>;
  bootstrap: () => Promise<void>;
  /** Re-reads the profile (role, name, PIN status) from the server. */
  refreshUser: () => Promise<void>;
  /** Applies a profile the server just returned, without another round-trip. */
  updateUser: (next: SessionUser) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [signInNotice, setSignInNotice] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.auth.me.$get();
      if (!res.ok) return;
      const me = await res.json();
      if (!('id' in me)) return;
      const next: SessionUser = me;
      await setSessionUser(next);
      setUser(next);
    } catch {
      // Offline: keep the cached profile.
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setChecking(true);
    const [token, sessionUser] = await Promise.all([getSessionToken(), getSessionUser()]);
    setUser(token && sessionUser ? sessionUser : null);
    setChecking(false);
    if (token && sessionUser) void refreshUser();
  }, [refreshUser]);

  const signIn = useCallback(async (token: string, next: SessionUser) => {
    // A phone can move between shops; never show one shop's saved data to another.
    if ((await getCacheShop()) !== next.shopId) {
      await clearCaches();
      await setCacheShop(next.shopId);
    }
    await setSessionToken(token);
    await setSessionUser(next);
    await setLastShop(next.phone, next.shopId);
    setSessionNotice(null);
    setUser(next);
  }, []);

  // Changes waiting to sync stay with the account (one per branch) that made them, so they reach
  // the right shop the next time that branch is open.
  const switchShop = useCallback(
    async (shopId: string) => {
      const res = await api.auth.switch.$post({ json: { shopId } });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || !('token' in body)) {
        const message = body && 'message' in body ? body.message : null;
        throw new Error(message ?? 'Couldn’t open that shop.');
      }
      await signIn(body.token, body.user);
    },
    [signIn],
  );

  const updateUser = useCallback(async (next: SessionUser) => {
    await setSessionUser(next);
    setUser(next);
  }, []);

  const forget = useCallback(async () => {
    await Promise.all([clearSession(), clearCaches()]);
    setSignInNotice(null);
    setUser(null);
  }, []);

  // Choosing to sign out also stops trusting this phone, so the next sign-in here needs a
  // WhatsApp code. Offline, it still signs out; the phone stays trusted until a reset.
  const signOut = useCallback(async () => {
    try {
      await api.auth.signout.$post();
    } catch {
      // Offline.
    }
    await forget();
  }, [forget]);

  useEffect(
    () =>
      subscribeSessionInvalid((reason, message) => {
        setSessionNotice(
          reason === 'disabled'
            ? 'Your account has been turned off. Ask the owner if this is a mistake.'
            : reason === 'revoked'
              ? 'You were signed out on this phone (your PIN, number or phones changed). Sign in again.'
              : reason === 'closed'
                ? (message ?? 'Mana Wash HQ has closed this branch.')
                : 'Your session ended. Please sign in again.',
        );
        void forget();
      }),
    [forget],
  );

  useEffect(
    () =>
      subscribePinUpgradeRequired(() => {
        setUser((current) => {
          if (!current || current.pinUpgradeRequired) return current;
          const next = { ...current, pinUpgradeRequired: true };
          void setSessionUser(next);
          return next;
        });
      }),
    [],
  );

  const value = useMemo(
    () => ({
      loggedIn: user != null,
      checking,
      user,
      isOwner: user?.role === 'owner',
      isManager: user?.role === 'manager',
      canManageTeam: user?.role === 'owner' || user?.role === 'manager',
      hqOnly: user?.hqOnly === true,
      sessionNotice,
      signInNotice,
      setSignInNotice,
      signIn,
      switchShop,
      signOut,
      bootstrap,
      refreshUser,
      updateUser,
    }),
    [
      checking,
      user,
      sessionNotice,
      signInNotice,
      signIn,
      switchShop,
      signOut,
      bootstrap,
      refreshUser,
      updateUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
