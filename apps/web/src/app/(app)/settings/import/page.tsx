import type { Metadata } from 'next';
import { IMPORT_DEFINITIONS, isImportEntity } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ImportWizard } from '@/components/imports/import-wizard';

export const metadata: Metadata = { title: 'Import data' };

const CAN_IMPORT = [...new Set(Object.values(IMPORT_DEFINITIONS).map((d) => d.createPermission))];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string | string[] }>;
}) {
  const { entity } = await searchParams;
  return (
    <PageGuard anyOf={CAN_IMPORT} title="You can't import data">
      <ImportWizard initialEntity={isImportEntity(entity) ? entity : undefined} />
    </PageGuard>
  );
}
