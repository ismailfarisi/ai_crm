import type { Metadata } from 'next';
import { PublicQuoteView } from '@/components/quotes/public-quote-view';

/**
 * The customer's view of a quote, reached from an acceptance link.
 *
 * Outside both route groups on purpose: no app shell, no sign-in, and the
 * proxy lets it through whether or not a session cookie is present — a
 * member of staff opening a customer's link to check it must see what the
 * customer sees, not be bounced to the dashboard.
 *
 * `no-referrer` keeps the token out of the Referer header of anything this
 * page links to, and `noindex` keeps it out of search results if a link is
 * ever posted somewhere public.
 */
export const metadata: Metadata = {
  title: 'Your quote',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/** `params` is async in this version of Next — see apps/web/AGENTS.md. */
export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicQuoteView token={token} />;
}
