import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { SubscriptionsView } from '@/components/finance/subscriptions/subscriptions-view';

export const metadata: Metadata = { title: 'Subscriptions & Recurring Expenses' };

export default function SubscriptionsPage() {
  return (
    <PageGuard permission={PERMISSIONS.FINANCE_READ} title="You cannot view subscriptions">
      <SubscriptionsView />
    </PageGuard>
  );
}
