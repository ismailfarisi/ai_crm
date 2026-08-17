import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { AccountsView } from '@/components/finance/accounts/accounts-view';

export const metadata: Metadata = { title: 'Bank & Cash Accounts' };

export default function AccountsPage() {
  return (
    <PageGuard permission={PERMISSIONS.FINANCE_READ} title="You cannot view bank accounts">
      <AccountsView />
    </PageGuard>
  );
}
