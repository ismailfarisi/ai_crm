import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { TemplateEditor } from '@/components/catalog/template-editor';

export const metadata: Metadata = { title: 'Product template' };

// `params` and `searchParams` are async in Next 16.
export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ starter?: string }>;
}) {
  const { id } = await params;
  const { starter } = await searchParams;

  return (
    <PageGuard permission={PERMISSIONS.CATALOG_MANAGE} title="You can't manage the catalog">
      <TemplateEditor templateId={id} fromStarter={starter === '1'} />
    </PageGuard>
  );
}
