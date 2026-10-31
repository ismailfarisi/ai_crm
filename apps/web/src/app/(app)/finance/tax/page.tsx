import type { Metadata } from 'next';
import { use } from 'react';
import { isIsoDate, PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { TaxView } from '@/components/finance/tax/tax-view';

export const metadata: Metadata = { title: 'Tax' };

export default function TaxPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { from, to } = use(searchParams);
  // A link from the Finance overview opens the period its VAT figure covers.
  const range = from && to && isIsoDate(from) && isIsoDate(to) && to > from ? { from, to } : undefined;

  return (
    <PageGuard permission={PERMISSIONS.TAX_READ} title="You can't view tax settings">
      <TaxView key={range ? `${range.from}:${range.to}` : 'current'} initialRange={range} />
    </PageGuard>
  );
}
