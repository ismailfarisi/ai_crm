import 'server-only';
import { cookies, headers as requestHeaders } from 'next/headers';
import { API_INTERNAL_URL, ApiError, toApiError } from './config';

interface ServerRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: object;
}

/**
 * Headers that say who the request is really from.
 *
 * Forwarded verbatim, never appended to: the proxy chain in front of us
 * already built the list, and the API counts hops from the right to decide
 * which entry it trusts. Adding our own hop would shift that count.
 */
const FORWARDED_FOR_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
  'cf-connecting-ip',
];

/**
 * Server-component API client. The browser's cookies are not attached
 * automatically on the server, so we forward the incoming Cookie header by hand
 * — and with it, who the caller is.
 *
 * Forwarding the caller's IP is not cosmetic. Every server-rendered request
 * leaves this one container, so without it the API sees a single client making
 * every request in the deployment: one rate-limit bucket shared by everyone,
 * exhausted by a handful of people browsing, and an audit trail that records
 * the container's address instead of the person's.
 *
 * `cookies()` and `headers()` are async in Next 16, and the request's own
 * headers are imported under another name because `options.headers` shadows it.
 */
export async function serverFetch<T>(path: string, options: ServerRequestOptions = {}): Promise<T> {
  const { body, query, headers, ...init } = options;

  const [cookieStore, incoming] = await Promise.all([
    cookies(),
    requestHeaders(),
  ]);
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const forwarded: Record<string, string> = {};
  for (const name of FORWARDED_FOR_HEADERS) {
    const value = incoming.get(name);
    if (value) forwarded[name] = value;
  }

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
      ...forwarded,
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
