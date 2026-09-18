'use client';

import { useEffect } from 'react';
import { API_PUBLIC_URL } from '@/lib/api/config';

/** Only ever go somewhere inside this app — never to a URL a caller supplied. */
function safeDestination(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  return next;
}

/**
 * Spends the refresh cookie the server side cannot see, then carries on.
 *
 * `window.location.replace` rather than a router push: the whole point is a
 * fresh document request that now carries the new access-token cookie, and
 * replacing keeps this page out of the back history.
 */
export function SessionContinue({ next }: { next?: string }) {
  useEffect(() => {
    const destination = safeDestination(next);

    // Tells the proxy this attempt has been made. If the cookie is still
    // missing on the next request the proxy sends the person to /login rather
    // than back here, so a broken refresh cannot loop.
    document.cookie = 'crm_refresh_try=1; path=/; max-age=30; samesite=lax';

    void fetch(`${API_PUBLIC_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((response) => {
        window.location.replace(
          response.ok
            ? destination
            : `/login?next=${encodeURIComponent(destination)}`,
        );
      })
      .catch(() => {
        window.location.replace(`/login?next=${encodeURIComponent(destination)}`);
      });
  }, [next]);

  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
      <div
        className="size-6 animate-spin rounded-full border-2 border-border border-t-brand"
        role="status"
        aria-label="Signing you back in"
      />
      <p className="text-sm text-ink-muted">Signing you back in…</p>
    </div>
  );
}
