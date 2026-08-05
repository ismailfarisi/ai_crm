import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { SessionDto } from '@saas/shared';
import { serverFetchOrNull } from './api/server';
import { subjectFromSession, type AccessSubject } from './access';

/**
 * De-duplicated for the lifetime of one request.
 *
 * The authenticated layout needs the session, and so does every page-level
 * guard beneath it. Without `cache()` a single navigation would hit `/auth/me`
 * two or three times; with it, exactly once.
 */
export const getSession = cache(async (): Promise<SessionDto | null> => {
  return serverFetchOrNull<SessionDto>('/auth/me');
});

/**
 * Loads the session for a server component, or sends the visitor to /login.
 *
 * Note this cannot silently refresh an expired access token — a server
 * component cannot write cookies. If the access token has expired but the
 * refresh cookie is still valid, `proxy.ts` lets the request through, this
 * returns null, and the redirect to /login is the honest outcome. The
 * client-side refresh in `api/client.ts` covers the common case of expiry while
 * the app is open.
 */
export async function requireSession(): Promise<SessionDto> {
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  return session;
}

export async function getOptionalSession(): Promise<SessionDto | null> {
  return getSession();
}

/** The current user's permissions and role slugs, for `checkAccess`. */
export async function getAccessSubject(): Promise<AccessSubject> {
  return subjectFromSession(await requireSession());
}
