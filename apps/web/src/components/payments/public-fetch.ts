import { API_PUBLIC_URL } from '@/lib/api/config';

/**
 * Plain `fetch` for the customer's pages, not `apiFetch`: nothing here should
 * depend on, or disturb, whoever else is signed in on the browser.
 */
export async function publicCall<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PUBLIC_URL}/public/${path}`, {
    ...init,
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (typeof body?.message === 'object' ? body.message?.message : body?.message) ??
      (response.status === 429
        ? 'Too many attempts. Please wait a minute and try again.'
        : 'This link is not valid. Please check it, or contact the sender.');
    throw new Error(Array.isArray(message) ? message.join(' ') : String(message));
  }
  return body as T;
}

export const money = (n: number, currency: string) =>
  `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
