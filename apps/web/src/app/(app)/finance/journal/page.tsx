import type { Metadata } from 'next';
import { use } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { JournalView } from '@/components/finance/books/journal-view';

export const metadata: Metadata = { title: 'Journal' };

export default function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const { account } = use(searchParams);

  return (
    <PageGuard permission={PERMISSIONS.FINANCE_READ} title="You cannot view the journal">
      {/* Keyed so following a link to another account starts from its filter. */}
      <JournalView key={account ?? 'all'} initialAccountId={account} />
    </PageGuard>
  );
}
