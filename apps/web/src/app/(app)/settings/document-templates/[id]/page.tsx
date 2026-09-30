import type { Metadata } from 'next';
import { use } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { TemplateStudio } from '@/components/settings/document-templates/template-studio';

export const metadata: Metadata = { title: 'Document Template Studio' };

export default function DocumentTemplateStudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <PageGuard
      permission={PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE}
      title="You don't have permission to edit document templates"
    >
      <TemplateStudio templateId={id} />
    </PageGuard>
  );
}
