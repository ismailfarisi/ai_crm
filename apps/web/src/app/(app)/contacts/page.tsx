import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ContactsView } from '@/components/contacts/contacts-view';

export const metadata: Metadata = { title: 'Contacts' };

export default function ContactsPage() {
  return (
    <PageGuard permission={PERMISSIONS.CONTACT_READ} title="You can't view contacts">
      <ContactsView />
    </PageGuard>
  );
}
