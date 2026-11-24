'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  ChevronRight,
  LogOut,
  Menu,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import { PERMISSIONS } from '@saas/shared';
import { useSession } from '@/lib/session-context';
import { cn, initials } from '@/lib/utils';
import { allNavItems } from '@/lib/nav';
import { useCustomObjects } from '@/hooks/use-custom-objects';
import { Button } from '@/components/ui/button';
import { AssistantProvider } from '@/components/assistant/assistant-provider';
import { AssistantLauncher } from '@/components/assistant/assistant-launcher';
import { AssistantPanel } from '@/components/assistant/assistant-panel';
import { KerfMark } from '@/components/brand/kerf-mark';
import { NotificationBell } from './notification-bell';
import { BillingBanner } from './billing-banner';
import { SidebarNav, activeHrefFor } from './sidebar-nav';

function pageTitleFor(pathname: string, customObjects?: { slug: string; name: string }[]): string {
  const allItems = allNavItems();
  const matchHref = activeHrefFor(pathname, allItems);
  const match = allItems.find((item) => item.href === matchHref);
  if (match) return match.label;
  if (customObjects) {
    const customMatch = customObjects.find(
      (obj) => pathname === `/objects/${obj.slug}` || pathname.startsWith(`/objects/${obj.slug}/`),
    );
    if (customMatch) return customMatch.name;
  }
  return 'Dashboard';
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, check, logout } = useSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: customObjects = [] } = useCustomObjects();
  const closeDrawer = () => setMobileOpen(false);

  const canUseAssistant = check({ permission: PERMISSIONS.ASSISTANT_USE });

  return (
    <AssistantProvider>
    {/* The sidebar is about 37 tab stops; the first one skips it. */}
    <a
      href="#main-content"
      className="sr-only z-50 rounded-full bg-charcoal px-4 py-2 text-sm font-semibold text-on-charcoal focus:not-sr-only focus:fixed focus:start-4 focus:top-3"
    >
      Skip to content
    </a>
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex print:hidden">
        <Brand />
        <SidebarNav onNavigate={() => undefined} />
        <UserCard onLogout={logout} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-64 flex-col border-r border-border bg-surface shadow-xl">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted"
              >
                <X className="size-4" />
              </button>
            </div>
            <SidebarNav onNavigate={closeDrawer} />
            <UserCard onLogout={logout} />
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col print:w-full print:block">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur lg:px-6 print:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted lg:hidden"
          >
            <Menu className="size-5" />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
            <span className="hidden truncate text-ink-subtle sm:inline">
              {session.organization.name}
            </span>
            <ChevronRight className="hidden size-3.5 shrink-0 text-ink-subtle sm:inline" />
            <span className="truncate font-semibold text-ink">{pageTitleFor(pathname, customObjects)}</span>
          </div>

          {canUseAssistant && <AssistantLauncher />}
          <NotificationBell />
          <ThemeToggle />
        </header>
        <div className="print:hidden">
          <BillingBanner />
        </div>

        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none lg:px-8 lg:py-8 print:p-0 print:m-0">
          <div className="mx-auto max-w-6xl space-y-6 print:max-w-none print:space-y-0">{children}</div>
        </main>
      </div>
      {canUseAssistant && <AssistantPanel />}
    </div>
    </AssistantProvider>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-4 pt-4 pb-3">
      <KerfMark />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold tracking-tight text-ink">Kerf</span>
        <span className="text-xs font-medium uppercase tracking-wider text-ink-subtle">
          Workspace
        </span>
      </div>
    </Link>
  );
}

function UserCard({ onLogout }: { onLogout: () => void }) {
  const { session } = useSession();
  const { user } = session;

  return (
    <div className="shrink-0 border-t border-border/60 p-3">
      <div className="flex items-center gap-2.5 rounded-2xl border border-border/70 bg-surface-muted/40 p-2 transition-colors hover:bg-surface-muted/60">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-ink ring-1 ring-brand/40">
          {initials(user.firstName, user.lastName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold leading-tight text-ink">{user.fullName}</p>
          <span className="inline-block truncate rounded-md border border-border/50 bg-surface px-1.5 py-0.5 text-xs font-medium text-ink-muted">
            {user.roles.map((role) => role.name).join(', ') || 'Member'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full text-ink-subtle hover:bg-surface hover:text-ink"
            aria-label="Notifications"
          >
            <Bell className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full text-ink-subtle hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
            onClick={onLogout}
            aria-label="Sign out"
          >
            <LogOut className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

const THEME_KEY = 'relay-theme';

function subscribeToTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function ThemeToggle() {
  // Driven by the <html> class the no-flash script in the root layout applies,
  // so the icon never hydrates out of sync with the active theme.
  const dark = useSyncExternalStore(
    subscribeToTheme,
    () => document.documentElement.classList.contains('dark'),
    () => false,
  );

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => {
        document.documentElement.classList.toggle('dark', !dark);
        try {
          localStorage.setItem(THEME_KEY, !dark ? 'dark' : 'light');
        } catch {
          // Private browsing — the toggle still works for this session.
        }
      }}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
