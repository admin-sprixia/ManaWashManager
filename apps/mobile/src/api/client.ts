import { hc } from 'hono/client';
import type { AppType } from '@mana/api';
import { getSessionToken } from './session';
import { emitSessionInvalid, NetworkError, setOnline } from './network';

// Local dev: http://localhost:8787, reached over USB via `adb reverse tcp:8787 tcp:8787`
// (same trick as Metro's port 8081). Swap to the deployed *.workers.dev URL for production.
const API_BASE_URL = 'http://localhost:8787';

/** A wash bay on weak 2G shouldn't leave a spinner running forever. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Every request goes through here: a hard timeout, online/offline tracking for the sync
 * banner, and a global sign-out when the server rejects an authenticated session (token
 * expired, or the owner deactivated this account).
 */
async function trackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(input, { ...init, signal: controller.signal });
  } catch {
    setOnline(false);
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
  setOnline(true);

  const headers = new Headers(init?.headers);
  if (headers.has('Authorization') && (res.status === 401 || res.status === 403)) {
    const body = (await res.clone().json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401 && body?.error === 'unauthorized') emitSessionInvalid('expired');
    if (res.status === 403 && body?.error === 'account_disabled') emitSessionInvalid('disabled');
  }
  return res;
}

/**
 * Fully typed API client generated from the Worker's own route types (Hono RPC) —
 * no separate schema or codegen step; a change to an API route's shape is a type error
 * here at build time. See the build plan's "API layer" row in Tech stack.
 */
export const api = hc<AppType>(API_BASE_URL, {
  fetch: trackedFetch,
  headers: async (): Promise<Record<string, string>> => {
    const token = await getSessionToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  },
});

/** The slice of a Hono RPC response the offline layer and error helpers rely on. */
export interface ApiResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Pulls a human message out of an API error body, falling back to a generic one. */
export async function apiErrorMessage(res: ApiResponse, fallback = 'Something went wrong.'): Promise<string> {
  const body = (await res.json().catch(() => null)) as
    | { message?: string; error?: string | { issues?: { message?: string }[] } }
    | null;
  if (body?.message) return body.message;
  // zod-validator failures: { success: false, error: { issues: [...] } }
  const issue = typeof body?.error === 'object' ? body.error.issues?.[0]?.message : undefined;
  if (issue) return issue;
  if (res.status >= 500) return 'The server had a problem. Try again in a moment.';
  return fallback;
}
