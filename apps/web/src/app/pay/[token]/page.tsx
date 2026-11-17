import type { Metadata } from 'next';
import { PublicInvoiceView } from '@/components/payments/public-invoice-view';

/**
 * The customer's view of an invoice, from its pay link. Open like `/q`: no
 * app shell and no sign-in; `no-referrer` keeps the token out of the
 * checkout provider's logs.
 */
export const metadata: Metadata = {
  title: 'Your invoice',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/** `params` and `searchParams` are async in this version of Next. */
export default async function PayInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const [{ token }, { paid }] = await Promise.all([params, searchParams]);
  return <PublicInvoiceView token={token} justPaid={paid === '1'} />;
}
