import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { AuditView } from '@/components/platform/audit-view';

export const metadata: Metadata = { title: 'Audit trail' };

export default function Page() {
  return (
    <PageGuard permission={PERMISSIONS.AUDIT_READ} title="You can't see the audit trail">
      <AuditView />
    </PageGuard>
  );
}
