import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { TemplateListView } from '@/components/settings/document-templates/template-list-view';

export const metadata: Metadata = { title: 'Document Templates' };

export default function DocumentTemplatesPage() {
  return (
    <PageGuard
      permission={PERMISSIONS.DOCUMENT_TEMPLATE_READ}
      title="You don't have permission to view document templates"
    >
      <TemplateListView />
    </PageGuard>
  );
}
