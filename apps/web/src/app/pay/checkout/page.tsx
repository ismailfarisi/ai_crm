import type { Metadata } from 'next';
import { TestCheckout } from '@/components/payments/test-checkout';

export const metadata: Metadata = {
  title: 'Test checkout',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

type Search = Record<'session' | 'amount' | 'currency' | 'description' | 'success' | 'cancel', string | undefined>;

/** `searchParams` is async in this version of Next. */
export default async function TestCheckoutPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  return (
    <TestCheckout
      session={q.session ?? ''}
      amount={Number(q.amount ?? 0)}
      currency={q.currency ?? 'AED'}
      description={q.description ?? 'Payment'}
      success={q.success}
      cancel={q.cancel}
    />
  );
}
