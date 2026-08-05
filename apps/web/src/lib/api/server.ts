import 'server-only';
import { cookies } from 'next/headers';
import { API_INTERNAL_URL, ApiError, toApiError } from './config';

interface ServerRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: object;
}

/**
 * Server-component API client. The browser's cookies are not attached
 * automatically on the server, so we forward the incoming Cookie header by hand.
 *
 * `cookies()` is async in Next 16.
 */
export async function serverFetch<T>(path: string, options: ServerRequestOptions = {}): Promise<T> {
  const { body, query, headers, ...init } = options;

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const url = new URL(`${API_INTERNAL_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString(), {
    ...init,
    headers: {
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // Session and CRM data are per-user and change constantly — never cache.
    cache: 'no-store',
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** Returns null instead of throwing when the caller is not signed in. */
export async function serverFetchOrNull<T>(
  path: string,
  options: ServerRequestOptions = {},
): Promise<T | null> {
  try {
    return await serverFetch<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError && (error.isUnauthorized || error.isForbidden)) {
      return null;
    }
    throw error;
  }
}
