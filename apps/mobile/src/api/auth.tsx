import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { clearSession, getSessionToken, getSessionUser, type SessionUser } from './session';

interface AuthContextValue {
  loggedIn: boolean;
  checking: boolean;
  user: SessionUser | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);

  const bootstrap = useCallback(async () => {
    setChecking(true);
    const [token, sessionUser] = await Promise.all([getSessionToken(), getSessionUser()]);
    setLoggedIn(Boolean(token));
    setUser(token ? sessionUser : null);
    setChecking(false);
  }, []);

  const signIn = useCallback(async () => {
    const sessionUser = await getSessionUser();
    setUser(sessionUser);
    setLoggedIn(true);
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setUser(null);
    setLoggedIn(false);
  }, []);

  const value = useMemo(
    () => ({ loggedIn, checking, user, signIn, signOut, bootstrap }),
    [loggedIn, checking, user, signIn, signOut, bootstrap],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
