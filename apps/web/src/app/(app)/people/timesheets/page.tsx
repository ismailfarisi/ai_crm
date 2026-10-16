import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { TimesheetsView } from '@/components/people/timesheets-view';

export const metadata: Metadata = { title: 'Timesheets' };

export default function TimesheetsPage() {
  return (
    <PageGuard permission={PERMISSIONS.TIMESHEET_READ} title="You can't view timesheets">
      <TimesheetsView />
    </PageGuard>
  );
}
