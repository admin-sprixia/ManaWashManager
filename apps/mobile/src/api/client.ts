import { hc } from 'hono/client';
import type { AppType } from '@mana/api';
import { getSessionToken } from './session';

// Local dev: http://localhost:8787, reached over USB via `adb reverse tcp:8787 tcp:8787`
// (same trick as Metro's port 8081). Swap to the deployed *.workers.dev URL for production.
const API_BASE_URL = 'http://localhost:8787';

/**
 * Fully typed API client generated from the Worker's own route types (Hono RPC) —
 * no separate schema or codegen step; a change to an API route's shape is a type error
 * here at build time. See the build plan's "API layer" row in Tech stack.
 */
export const api = hc<AppType>(API_BASE_URL, {
  headers: async () => {
    const token = await getSessionToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
});
