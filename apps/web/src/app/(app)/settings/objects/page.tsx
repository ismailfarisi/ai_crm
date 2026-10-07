import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ObjectStudioView } from '@/components/settings/objects/object-studio-view';

export const metadata: Metadata = { title: 'Object Studio' };

export default function ObjectStudioPage() {
  return (
    <PageGuard
      permission={PERMISSIONS.CUSTOM_OBJECT_MANAGE}
      title="You don't have permission to manage custom objects"
    >
      <ObjectStudioView />
    </PageGuard>
  );
}
