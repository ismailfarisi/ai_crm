import type { Metadata } from 'next';
import { use } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ReportsView } from '@/components/finance/reports/reports-view';

export const metadata: Metadata = { title: 'Financial reports' };

export default function Page({ searchParams }: { searchParams: Promise<{ report?: string }> }) {
  const { report } = use(searchParams);

  return (
    <PageGuard permission={PERMISSIONS.FINANCE_READ} title="You cannot view finance">
      <ReportsView key={report ?? 'default'} initialReport={report} />
    </PageGuard>
  );
}
