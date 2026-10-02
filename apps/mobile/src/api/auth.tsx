import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SEAT_LOCKED_MESSAGE } from '@mana/domain';
import { api } from './client';
import { subscribeSessionInvalid } from './network';
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
  /** Why the last session ended, when it wasn't the user's choice — shown on the login screen. */
  sessionNotice: string | null;
  signIn: (token: string, user: SessionUser) => Promise<void>;
  /** Owners with several branches: opens another of their shops without signing in again. */
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

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.auth.me.$get();
      if (!res.ok) return;
      const me = await res.json();
      if (!('id' in me)) return;
      const next: SessionUser = { ...me, role: me.role === 'owner' ? 'owner' : 'staff' };
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

  const signOut = useCallback(async () => {
    await Promise.all([clearSession(), clearCaches()]);
    setUser(null);
  }, []);

  useEffect(
    () =>
      subscribeSessionInvalid((reason) => {
        setSessionNotice(
          reason === 'disabled'
            ? 'Your account has been turned off. Ask the owner if this is a mistake.'
            : reason === 'revoked'
              ? 'Your PIN was changed or reset. Sign in with the new PIN.'
              : reason === 'seat_locked'
                ? SEAT_LOCKED_MESSAGE
                : 'Your session ended. Please sign in again.',
        );
        void signOut();
      }),
    [signOut],
  );

  const value = useMemo(
    () => ({
      loggedIn: user != null,
      checking,
      user,
      isOwner: user?.role === 'owner',
      sessionNotice,
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
