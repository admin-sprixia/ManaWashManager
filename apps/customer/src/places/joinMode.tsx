import React, { createContext, useContext, type PropsWithChildren } from 'react';
import type { RequestPass } from '../api/session';

/**
 * Who is joining a place. A new number joins with its service-request ticket (and is signed in
 * by the join); a customer joins with their sign-in. The join screens work the same for both.
 */
export type JoinMode = { kind: 'ticket'; pass: RequestPass } | { kind: 'customer' };

const JoinModeContext = createContext<JoinMode | null>(null);

export function JoinModeProvider({ mode, children }: PropsWithChildren<{ mode: JoinMode }>) {
  return <JoinModeContext.Provider value={mode}>{children}</JoinModeContext.Provider>;
}

export function useJoinMode(): JoinMode {
  const mode = useContext(JoinModeContext);
  if (!mode) throw new Error('useJoinMode must be used inside JoinModeProvider');
  return mode;
}
