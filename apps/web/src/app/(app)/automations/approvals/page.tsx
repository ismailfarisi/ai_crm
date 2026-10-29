import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ApprovalsInbox } from '@/components/automations/approvals/approvals-inbox';

export const metadata: Metadata = { title: 'Approvals' };

export default function AutomationApprovalsPage() {
  return (
    <PageGuard permission={PERMISSIONS.AUTOMATION_APPROVE} title="You can't approve automations">
      <ApprovalsInbox />
    </PageGuard>
  );
}
