import type { Metadata } from 'next';
import { SessionContinue } from '@/components/auth/session-continue';

export const metadata: Metadata = { title: 'Signing you back in' };

/**
 * The interstitial that keeps a full-page navigation from signing you out.
 *
 * The access token lives 15 minutes and the refresh token much longer, but the
 * refresh cookie is scoped to the API's auth routes — deliberately, to keep it
 * off ordinary requests — so the Next server never receives it and cannot
 * refresh on a server-rendered navigation. A server component cannot write
 * cookies either. The browser can do both, so the proxy sends the request here
 * and this page does it, then continues to where the person was going.
 */
export default async function Page({
  searchParams,
}: {
  // Async in Next 16.
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <SessionContinue next={next} />;
}
