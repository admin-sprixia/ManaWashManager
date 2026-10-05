/** A request that never reached the API (no signal, DNS, timeout). Safe to try again. */
export class NetworkError extends Error {
  constructor(message = 'No connection. Check your internet and try again.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The slice of a Hono RPC response the error helpers need. */
export interface ApiResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** An API answer that wasn't a success, with the server's message for people. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Turns a failed response into an ApiError carrying the server's message (or a plain fallback). */
export async function toApiError(res: ApiResponse, fallback = 'Something went wrong. Try again.'): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as
    | { message?: string; error?: string | { issues?: { message?: string }[] }; retryAfter?: number }
    | null;
  const code = typeof body?.error === 'string' ? body.error : null;
  if (body?.message) return new ApiError(body.message, res.status, code);
  // zod-validator failures: { success: false, error: { issues: [...] } }
  const issue = typeof body?.error === 'object' ? body.error.issues?.[0]?.message : undefined;
  if (issue) return new ApiError(issue, res.status, 'invalid');
  if (code === 'too_soon' && body?.retryAfter) {
    return new ApiError(`Wait ${body.retryAfter}s before asking for another code.`, res.status, code);
  }
  if (res.status === 429) return new ApiError('Too many tries. Wait a few minutes and try again.', res.status, code);
  if (res.status >= 500) return new ApiError('Our server had a problem. Try again in a moment.', res.status, code);
  return new ApiError(fallback, res.status, code);
}

/** A message fit to show for anything thrown by an API call. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return 'Something went wrong. Try again.';
}
