import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { TemplateEditor } from '@/components/catalog/template-editor';

export const metadata: Metadata = { title: 'New product template' };

export default function NewTemplatePage() {
  return (
    <PageGuard permission={PERMISSIONS.CATALOG_MANAGE} title="You can't manage the catalog">
      <TemplateEditor templateId={null} />
    </PageGuard>
  );
}
