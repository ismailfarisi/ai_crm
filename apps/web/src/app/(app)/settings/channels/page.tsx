import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ChannelsView } from '@/components/channels/channels-view';

export const metadata: Metadata = { title: 'Communication Channels' };

export default function ChannelsPage() {
  return (
    <PageGuard permission={PERMISSIONS.CHANNEL_MANAGE} title="You can't manage channel settings">
      <ChannelsView />
    </PageGuard>
  );
}
