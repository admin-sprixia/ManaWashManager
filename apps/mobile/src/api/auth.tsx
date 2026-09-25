import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './client';
import { subscribeSessionInvalid } from './network';
import {
  clearSession,
  getSessionToken,
  getSessionUser,
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
    await setSessionToken(token);
    await setSessionUser(next);
    setSessionNotice(null);
    setUser(next);
  }, []);

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
      signOut,
      bootstrap,
      refreshUser,
      updateUser,
    }),
    [checking, user, sessionNotice, signIn, signOut, bootstrap, refreshUser, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
