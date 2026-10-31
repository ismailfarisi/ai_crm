/** Where to go when `next` is missing or points anywhere but this app. */
export const DEFAULT_DESTINATION = '/dashboard';

// A base nobody can own, so "same origin as this" means "a path in this app".
const BASE = 'https://kerf.invalid';

/**
 * Only ever go somewhere inside this app — never to a URL a caller supplied.
 *
 * `next` arrives in the query string, so anyone can write it. The cheap check
 * (starts with one `/`) is not enough on its own: browsers read `/\evil.com`
 * as `//evil.com` and drop tabs and newlines, so `/\t/evil.com` is too. The
 * URL parser applies the same rules the browser will, so the result is
 * resolved against a fixed base and kept only if it stayed on that base.
 */
export function safeDestination(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return DEFAULT_DESTINATION;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return DEFAULT_DESTINATION;
  }
  if (url.origin !== BASE) return DEFAULT_DESTINATION;
  return `${url.pathname}${url.search}${url.hash}`;
}
