import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { TemplateEditor } from '@/components/catalog/template-editor';

export const metadata: Metadata = { title: 'Product template' };

// `params` is async in Next 16.
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PageGuard permission={PERMISSIONS.CATALOG_MANAGE} title="You can't manage the catalog">
      <TemplateEditor templateId={id} />
    </PageGuard>
  );
}
