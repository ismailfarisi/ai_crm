import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { SuppliersView } from '@/components/purchasing/suppliers-view';

export const metadata: Metadata = { title: 'Suppliers' };

export default function SuppliersPage() {
  return (
    <PageGuard permission={PERMISSIONS.SUPPLIER_READ} title="You can't view suppliers">
      <SuppliersView />
    </PageGuard>
  );
}
