import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { QuotesView } from '@/components/quotes/quotes-view';

export const metadata: Metadata = { title: 'Quotes & Workflow Orchestration' };

export default function QuotesPage() {
  return (
    <PageGuard permission={PERMISSIONS.QUOTE_READ} title="You can't view quotes">
      <QuotesView />
    </PageGuard>
  );
}
