import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { CurrenciesView } from '@/components/finance/currencies/currencies-view';

export const metadata: Metadata = { title: 'Currencies' };

export default function Page() {
  return (
    <PageGuard permission={PERMISSIONS.FINANCE_READ} title="You cannot view finance">
      <CurrenciesView />
    </PageGuard>
  );
}
