import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { TaxView } from '@/components/finance/tax/tax-view';

export const metadata: Metadata = { title: 'Tax' };

export default function TaxPage() {
  return (
    <PageGuard permission={PERMISSIONS.TAX_READ} title="You can't view tax settings">
      <TaxView />
    </PageGuard>
  );
}
