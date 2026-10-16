import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { SettlementsView } from '@/components/people/settlements-view';

export const metadata: Metadata = { title: 'Settlements' };

export default function SettlementsPage() {
  return (
    <PageGuard permission={PERMISSIONS.PAYROLL_READ} title="You can't view settlements">
      <SettlementsView />
    </PageGuard>
  );
}
