/**
 * The API runs on its own origin, so every request is cross-origin and must
 * carry credentials. `NEXT_PUBLIC_API_URL` is what the browser calls;
 * `API_INTERNAL_URL` lets server components reach the API over a private
 * network in production (falls back to the public URL in development).
 */
export const API_PUBLIC_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? API_PUBLIC_URL;

export const ACCESS_TOKEN_COOKIE = 'crm_access_token';
export const REFRESH_TOKEN_COOKIE = 'crm_refresh_token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** Flattens field errors into `{ field: 'first message' }` for form libraries. */
  get fieldErrors(): Record<string, string> {
    if (!this.details) return {};
    return Object.fromEntries(
      Object.entries(this.details).map(([field, messages]) => [field, messages[0]]),
    );
  }
}

export async function toApiError(response: Response): Promise<ApiError> {
  let message = response.statusText || 'Request failed';
  let details: Record<string, string[]> | undefined;

  try {
    const body = (await response.json()) as {
      message?: string;
      details?: Record<string, string[]>;
    };
    if (body.message) message = body.message;
    details = body.details;
  } catch {
    // Non-JSON error body (gateway timeout, HTML error page) — keep statusText.
  }

  return new ApiError(response.status, message, details);
}
