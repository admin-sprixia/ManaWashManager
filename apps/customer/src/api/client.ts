import { hc, type ClientResponse } from 'hono/client';
import type { SuccessStatusCode } from 'hono/utils/http-status';
import type { AppType } from '@mana/api';
import { DEV_API_URL, PRODUCTION_API_URL } from '../config/app';
import { NetworkError, toApiError } from './errors';
import { getToken } from './session';

export const API_BASE_URL = __DEV__ ? DEV_API_URL : PRODUCTION_API_URL;

/** Weak mobile data shouldn't leave a spinner running forever. */
const REQUEST_TIMEOUT_MS = 15_000;

type SessionListener = (reason: 'expired' | 'revoked') => void;
const sessionListeners = new Set<SessionListener>();

/** The auth layer listens here and signs out when the server ends this phone's session. */
export function onSessionEnded(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

async function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(input, { ...init, signal: controller.signal });
  } catch {
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }

  const sentAuth = new Headers(init?.headers).get('Authorization');
  if (sentAuth && res.status === 401) {
    // Only the token this phone holds now counts: a request sent with an older one says nothing.
    const current = await getToken();
    if (sentAuth === `Bearer ${current ?? ''}`) {
      const body = (await res
        .clone()
        .json()
        .catch(() => null)) as { error?: string } | null;
      const reason = body?.error === 'session_revoked' ? 'revoked' : 'expired';
      sessionListeners.forEach((l) => l(reason));
    }
  }
  return res;
}

/** Typed client generated from the Worker's routes (Hono RPC); this app only uses `api.c`. */
export const api = hc<AppType>(API_BASE_URL, {
  fetch: timedFetch,
  headers: async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
}).c;

type SuccessBody<R> = R extends ClientResponse<infer T, infer S> ? (S extends SuccessStatusCode ? T : never) : never;

/** Awaits an API call and returns its success body; anything else throws an ApiError. */
export async function send<R extends ClientResponse<unknown, number>>(
  request: Promise<R>,
  fallback?: string,
): Promise<SuccessBody<R>> {
  const res = await request;
  if (!res.ok) throw await toApiError(res, fallback);
  return (await res.json()) as SuccessBody<R>;
}

/** Image source for a wash photo; the token keeps it private to this customer. */
export async function photoSource(photoId: string): Promise<{ uri: string; headers: Record<string, string> }> {
  const token = await getToken();
  return {
    uri: `${API_BASE_URL}/c/photos/${encodeURIComponent(photoId)}`,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}
