import { AppShell } from '@/components/layout/app-shell';
import { requireSession } from '@/lib/get-session';
import { SessionProvider } from '@/lib/session-context';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Fetched on the server so the first paint already knows the user's
  // permissions — no flash of navigation they aren't allowed to see.
  const session = await requireSession();

  return (
    <SessionProvider initialSession={session}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
