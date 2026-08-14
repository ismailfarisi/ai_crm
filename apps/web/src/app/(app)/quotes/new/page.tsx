import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { QuoteEditorPage } from '@/components/quotes/quote-editor/quote-editor-page';

export const metadata: Metadata = { title: 'New Quotation' };

export default function NewQuotePage() {
  return (
    <PageGuard permission={PERMISSIONS.QUOTE_CREATE} title="You cannot create quotes">
      <QuoteEditorPage />
    </PageGuard>
  );
}
