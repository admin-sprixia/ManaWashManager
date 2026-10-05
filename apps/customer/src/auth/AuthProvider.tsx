import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onSessionEnded, send } from '../api/client';
import {
  clearSession,
  getAccount,
  getRequestPass,
  getToken,
  saveAccount,
  saveRequestPass,
  saveSignIn,
  type Account,
  type RequestPass,
} from '../api/session';

/**
 * Where this phone stands:
 * - signed_out: sign in with a number and WhatsApp code
 * - requesting: the number isn't a customer yet; it can ask for service and follow the request
 * - signed_in: a customer of one or more MANA branches
 */
export type AuthState =
  | { kind: 'checking' }
  | { kind: 'signed_out'; notice: string | null }
  | { kind: 'requesting'; pass: RequestPass }
  | { kind: 'signed_in'; account: Account };

interface AuthContextValue {
  state: AuthState;
  signedIn: (token: string, account: Account) => Promise<void>;
  startRequesting: (pass: RequestPass) => Promise<void>;
  signOut: (notice?: string | null) => Promise<void>;
  /** Re-reads name and branches from the server (Profile, pull to refresh). */
  refreshAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ENDED_NOTICE = {
  expired: 'You were signed out. Sign in again to see your cars and washes.',
  revoked: 'You signed out on all phones. Sign in again to continue.',
} as const;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: 'checking' });

  const signOut = useCallback(async (notice: string | null = null) => {
    await clearSession();
    setState({ kind: 'signed_out', notice });
  }, []);

  const signedIn = useCallback(async (token: string, account: Account) => {
    await saveSignIn(token, account);
    setState({ kind: 'signed_in', account });
  }, []);

  const startRequesting = useCallback(async (pass: RequestPass) => {
    await saveRequestPass(pass);
    setState({ kind: 'requesting', pass });
  }, []);

  const refreshAccount = useCallback(async () => {
    const account = await send(api.me.$get());
    await saveAccount(account);
    setState((s) => (s.kind === 'signed_in' ? { kind: 'signed_in', account } : s));
  }, []);

  useEffect(() => onSessionEnded((reason) => void signOut(ENDED_NOTICE[reason])), [signOut]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [token, account, pass] = await Promise.all([getToken(), getAccount(), getRequestPass()]);
      if (cancelled) return;
      if (token && account) {
        setState({ kind: 'signed_in', account });
        // Offline is fine: the saved account shows until the next successful refresh.
        refreshAccount().catch(() => undefined);
      } else if (pass) {
        setState({ kind: 'requesting', pass });
      } else {
        setState({ kind: 'signed_out', notice: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAccount]);

  const value = useMemo(
    () => ({ state, signedIn, startRequesting, signOut, refreshAccount }),
    [state, signedIn, startRequesting, signOut, refreshAccount],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The signed-in account; only for screens behind the signed-in navigator. */
export function useAccount(): Account {
  const { state } = useAuth();
  if (state.kind !== 'signed_in') throw new Error('useAccount needs a signed-in customer');
  return state.account;
}
