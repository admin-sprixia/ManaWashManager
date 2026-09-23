import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { clearSession, getSessionToken } from './session';

interface AuthContextValue {
  loggedIn: boolean;
  checking: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);

  const bootstrap = useCallback(async () => {
    setChecking(true);
    const token = await getSessionToken();
    setLoggedIn(Boolean(token));
    setChecking(false);
  }, []);

  const signIn = useCallback(() => setLoggedIn(true), []);

  const signOut = useCallback(async () => {
    await clearSession();
    setLoggedIn(false);
  }, []);

  const value = useMemo(
    () => ({ loggedIn, checking, signIn, signOut, bootstrap }),
    [loggedIn, checking, signIn, signOut, bootstrap],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
