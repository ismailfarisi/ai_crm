import type { Metadata } from 'next';
import { NotificationPreferencesView } from '@/components/settings/notification-preferences-view';

export const metadata: Metadata = { title: 'Notifications' };

/** Everyone's own settings: no permission needed beyond being signed in. */
export default function NotificationsSettingsPage() {
  return <NotificationPreferencesView />;
}
