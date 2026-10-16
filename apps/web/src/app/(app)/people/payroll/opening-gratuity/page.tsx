import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { OpeningGratuityView } from '@/components/people/opening-gratuity-view';

export const metadata: Metadata = { title: 'Opening gratuity' };

export default function OpeningGratuityPage() {
  return (
    <PageGuard permission={PERMISSIONS.PAYROLL_MANAGE} title="You can't set up opening balances">
      <OpeningGratuityView />
    </PageGuard>
  );
}
