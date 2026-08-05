import { API_PUBLIC_URL, ApiError, toApiError } from './config';

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Serialised into the query string; empty/undefined/null entries are dropped. */
  query?: object;
  /** Internal — stops the refresh retry from recursing. */
  _retried?: boolean;
}

/**
 * Browser-side API client.
 *
 * Auth rides on httpOnly cookies, so nothing here touches tokens. On a 401 it
 * attempts one silent refresh and replays the request; if that fails the caller
 * gets the 401 and the session provider sends the user to /login.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, _retried, headers, ...init } = options;

  const url = new URL(`${API_PUBLIC_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString(), {
    ...init,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && !_retried && !path.startsWith('/auth/')) {
    const refreshed = await silentRefresh();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, _retried: true });
    }
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * Several requests can 401 at once after an access token expires. They all share
 * one in-flight refresh so we don't rotate the refresh token N times in
 * parallel — which the API would treat as token reuse and revoke the session.
 */
let refreshInFlight: Promise<boolean> | null = null;

function silentRefresh(): Promise<boolean> {
  refreshInFlight ??= fetch(`${API_PUBLIC_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

export { ApiError };
