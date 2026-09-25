/**
 * Tiny app-wide network state, fed by every API request (see `client.ts`). There's no
 * connectivity library on purpose: "can we reach *our* API" is the only question that
 * matters, and each real request answers it more accurately than an OS radio flag.
 */
type Listener = (online: boolean) => void;

let online = true;
const listeners = new Set<Listener>();

export function isOnline(): boolean {
  return online;
}

export function setOnline(next: boolean): void {
  if (next === online) return;
  online = next;
  listeners.forEach((l) => l(next));
}

export function subscribeOnline(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type SessionListener = (reason: 'expired' | 'disabled') => void;
const sessionListeners = new Set<SessionListener>();

/** Fired when an authenticated request is rejected — the auth layer signs the user out. */
export function emitSessionInvalid(reason: 'expired' | 'disabled'): void {
  sessionListeners.forEach((l) => l(reason));
}

export function subscribeSessionInvalid(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

/** A request that never reached the API (no signal, DNS, timeout) — safe to retry later. */
export class NetworkError extends Error {
  constructor(message = 'No connection') {
    super(message);
    this.name = 'NetworkError';
  }
}
