import { hc } from 'hono/client';
import type { AppType } from '@mana/api';
import { getSessionToken } from './session';
import { emitSessionInvalid, NetworkError, setOnline } from './network';
import { DEV_API_URL, PRODUCTION_API_URL } from '../config/app';
import type { ExpensePayload } from '../offline/types';

export const API_BASE_URL = __DEV__ ? DEV_API_URL : PRODUCTION_API_URL;

/** A wash bay on weak 2G shouldn't leave a spinner running forever. */
const REQUEST_TIMEOUT_MS = 15_000;
/** A 1.5 MB photo on a weak signal needs longer than a JSON call. */
const UPLOAD_TIMEOUT_MS = 90_000;

/**
 * Every request goes through here: a hard timeout, online/offline tracking for the sync
 * banner, and a global sign-out when the server rejects an authenticated session (token
 * expired, the owner deactivated this account, or the shop's plan has no seat for it).
 */
async function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // The server times queued actions by the gap between this and their occurredAt, both read
  // from this phone's clock, so a phone set to the wrong day can't move them to another day.
  const sendHeaders = new Headers(init?.headers);
  sendHeaders.set('X-Client-Time', new Date().toISOString());
  let res: Response;
  try {
    res = await fetch(input, { ...init, headers: sendHeaders, signal: controller.signal });
  } catch {
    setOnline(false);
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
  setOnline(true);

  const headers = new Headers(init?.headers);
  const sentAuth = headers.get('Authorization');
  if (sentAuth && (res.status === 401 || res.status === 403)) {
    // A request that left before this phone saved a new token (e.g. right after changing the
    // PIN) is rejected for the old one; that says nothing about the current session.
    const current = await getSessionToken();
    if (sentAuth !== `Bearer ${current ?? ''}`) return res;
    const body = (await res.clone().json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401 && body?.error === 'unauthorized') emitSessionInvalid('expired');
    if (res.status === 401 && body?.error === 'session_revoked') emitSessionInvalid('revoked');
    if (res.status === 403 && body?.error === 'account_disabled') emitSessionInvalid('disabled');
    if (res.status === 403 && body?.error === 'plan_seat_locked') emitSessionInvalid('seat_locked');
  }
  return res;
}

/**
 * Fully typed API client generated from the Worker's own route types (Hono RPC) —
 * no separate schema or codegen step; a change to an API route's shape is a type error
 * here at build time. See the build plan's "API layer" row in Tech stack.
 */
export const api = hc<AppType>(API_BASE_URL, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => trackedFetch(input, init),
  headers: async (): Promise<Record<string, string>> => {
    const token = await getSessionToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  },
});

export interface PhotoUpload {
  id: string;
  jobId: string;
  kind: 'before' | 'after';
  uri: string;
  contentType: string;
  occurredAt: string;
}

/**
 * Multipart upload of a file on this phone. Hono RPC can't send a React Native file
 * reference ({ uri, type, name }), so this one goes through plain fetch.
 */
export async function uploadPhoto(photo: PhotoUpload): Promise<Response> {
  const form = new FormData();
  form.append('id', photo.id);
  form.append('jobId', photo.jobId);
  form.append('kind', photo.kind);
  form.append('occurredAt', photo.occurredAt);
  form.append('file', {
    uri: photo.uri,
    type: photo.contentType,
    name: `${photo.id}.${photo.contentType === 'image/png' ? 'png' : 'jpg'}`,
  } as unknown as Blob);
  const token = await getSessionToken();
  return trackedFetch(
    `${API_BASE_URL}/photos`,
    { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} },
    UPLOAD_TIMEOUT_MS,
  );
}

/** An expense with its bill and item photos, sent as one multipart request. */
export async function uploadExpense(expense: ExpensePayload): Promise<Response> {
  const { billPhoto, itemPhoto, ...data } = expense;
  const form = new FormData();
  form.append('data', JSON.stringify(data));
  for (const [field, photo] of [
    ['billPhoto', billPhoto],
    ['itemPhoto', itemPhoto],
  ] as const) {
    form.append(field, {
      uri: photo.uri,
      type: photo.contentType,
      name: `${expense.id}-${field}.${photo.contentType === 'image/png' ? 'png' : 'jpg'}`,
    } as unknown as Blob);
  }
  const token = await getSessionToken();
  return trackedFetch(
    `${API_BASE_URL}/expenses`,
    { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} },
    UPLOAD_TIMEOUT_MS,
  );
}

/** Image source for an expense's bill or item photo. */
export async function expensePhotoSource(
  expenseId: string,
  kind: 'bill' | 'item',
): Promise<{ uri: string; headers: Record<string, string> }> {
  const token = await getSessionToken();
  return {
    uri: `${API_BASE_URL}/expenses/${expenseId}/photos/${kind}`,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

/** Image source for a stored photo; the Authorization header keeps it private to the team. */
export async function photoSource(photoId: string): Promise<{ uri: string; headers: Record<string, string> }> {
  const token = await getSessionToken();
  return {
    uri: `${API_BASE_URL}/photos/${photoId}`,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

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
