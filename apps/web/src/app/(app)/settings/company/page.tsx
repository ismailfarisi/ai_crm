import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { CompanyView } from '@/components/settings/company-view';

export const metadata: Metadata = { title: 'Company' };

export default function CompanyPage() {
  return (
    <PageGuard permission={PERMISSIONS.ORG_READ} title="You can't view company settings">
      <CompanyView />
    </PageGuard>
  );
}
