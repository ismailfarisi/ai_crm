import type { Metadata } from 'next';
import { use } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { QuoteEditorPage } from '@/components/quotes/quote-editor/quote-editor-page';

export const metadata: Metadata = { title: 'Quotation Editor' };

export default function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);

  return (
    <PageGuard permission={PERMISSIONS.QUOTE_READ} title="You cannot view quotes">
      <QuoteEditorPage quoteId={resolvedParams.id} />
    </PageGuard>
  );
}
