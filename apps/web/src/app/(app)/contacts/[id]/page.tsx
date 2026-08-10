import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';

export const metadata: Metadata = { title: 'Contact Detail' };

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PageGuard permission={PERMISSIONS.CONTACT_READ} title="You can't view this contact">
      <ContactDetailView params={params} />
    </PageGuard>
  );
}
