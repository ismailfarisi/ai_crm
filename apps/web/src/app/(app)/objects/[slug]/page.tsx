import { use } from 'react';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { CustomObjectRecordsView } from '@/components/objects/custom-object-records-view';

export const metadata: Metadata = { title: 'Custom Records' };

export interface ObjectRecordsPageProps {
  params: Promise<{ slug: string }>;
}

export default function ObjectRecordsPage({ params }: ObjectRecordsPageProps) {
  const { slug } = use(params);
  return (
    <PageGuard
      permission={PERMISSIONS.CUSTOM_RECORD_READ}
      title="You don't have permission to view custom records"
    >
      <CustomObjectRecordsView slug={slug} />
    </PageGuard>
  );
}
