import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { CatalogView } from '@/components/catalog/catalog-view';

export const metadata: Metadata = { title: 'Catalog' };

export default function CatalogPage() {
  return (
    <PageGuard permission={PERMISSIONS.CATALOG_MANAGE} title="You can't manage the catalog">
      <CatalogView />
    </PageGuard>
  );
}
