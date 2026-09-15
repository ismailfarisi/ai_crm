import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { FakeCheckout } from '@/components/settings/billing/fake-checkout';

export const metadata: Metadata = { title: 'Checkout' };

export default function Page() {
  return (
    <PageGuard permission={PERMISSIONS.ORG_MANAGE_BILLING} title="You can't manage billing">
      <Suspense fallback={null}>
        <FakeCheckout />
      </Suspense>
    </PageGuard>
  );
}
