import { use } from 'react';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { CustomRecordDetailView } from '@/components/objects/custom-record-detail-view';

export const metadata: Metadata = { title: 'Custom Record Details' };

export interface RecordDetailPageProps {
  params: Promise<{ slug: string; id: string }>;
}

export default function RecordDetailPage({ params }: RecordDetailPageProps) {
  const { slug, id } = use(params);
  return (
    <PageGuard
      permission={PERMISSIONS.CUSTOM_RECORD_READ}
      title="You don't have permission to view custom records"
    >
      <CustomRecordDetailView slug={slug} id={id} />
    </PageGuard>
  );
}
