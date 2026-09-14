import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { StockView } from '@/components/inventory/stock-view';

export const metadata: Metadata = { title: 'Stock' };

export default function InventoryPage() {
  return (
    <PageGuard permission={PERMISSIONS.INVENTORY_READ} title="You can't view stock">
      <StockView />
    </PageGuard>
  );
}
