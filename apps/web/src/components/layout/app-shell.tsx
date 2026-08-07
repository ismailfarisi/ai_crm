'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  ChevronRight,
  CircleDot,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Receipt,
  ShieldCheck,
  Sun,
  UserRoundCog,
  Users,
  X,
} from 'lucide-react';
import { PERMISSIONS } from '@saas/shared';
import type { AccessRule } from '@/lib/access';
import { useSession } from '@/lib/session-context';
import { cn, initials } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * Hidden entirely when the rule fails. Keep this identical to the `PageGuard`
   * rule on the destination page — same rule shape, same evaluator, so a link
   * can never lead somewhere the user is then refused.
   */
  rule?: AccessRule;
}

const NAV_SECTIONS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      {
        href: '/contacts',
        label: 'Contacts',
        icon: Users,
        rule: { permission: PERMISSIONS.CONTACT_READ },
      },
      {
        href: '/customers',
        label: 'Customers',
        icon: Building2,
        rule: { permission: PERMISSIONS.CUSTOMER_READ },
      },
      {
        href: '/quotes',
        label: 'Quotes',
        icon: FileText,
        rule: { permission: PERMISSIONS.QUOTE_READ },
      },
      {
        href: '/invoices',
        label: 'Invoices',
        icon: Receipt,
        rule: { permission: PERMISSIONS.INVOICE_READ },
      },
    ],
  },
  {
    title: 'Settings',
    items: [
      {
        href: '/settings/team',
        label: 'Team',
        icon: Users,
        rule: { permission: PERMISSIONS.USER_READ },
      },
      {
        href: '/settings/teams',
        label: 'Teams',
        icon: UserRoundCog,
        rule: { permission: PERMISSIONS.USER_READ },
      },
      {
        href: '/settings/roles',
        label: 'Roles & permissions',
        icon: ShieldCheck,
        rule: { permission: PERMISSIONS.ROLE_READ },
      },
    ],
  },
];

function pageTitleFor(pathname: string): string {
  const items = NAV_SECTIONS.flatMap((section) => section.items);
  const match = items.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return match?.label ?? 'Dashboard';
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, check, logout } = useSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => check(item.rule ?? {})),
  })).filter((section) => section.items.length > 0);

  const nav = (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4 scrollbar-thin">
      {visibleSections.map((section, index) => (
        <div key={section.title ?? index}>
          {section.title && (
            <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-ink-subtle uppercase">
              {section.title}
            </p>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-brand-soft text-brand'
                        : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                    )}
                  >
                    {active && (
                      <span className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand" />
                    )}
                    <item.icon className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — pinned while the content scrolls. */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <Brand />
        {nav}
        <UserCard onLogout={logout} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-64 flex-col border-r border-border bg-surface">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="mr-3 rounded-md p-1.5 text-ink-subtle hover:bg-surface-muted"
              >
                <X className="size-4" />
              </button>
            </div>
            {nav}
            <UserCard onLogout={logout} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur lg:px-6">
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
            <span className="truncate font-semibold text-ink">{pageTitleFor(pathname)}</span>
          </div>

          <ThemeToggle />
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-6xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
      <span className="grid size-7 place-items-center rounded-lg bg-brand text-white">
        <CircleDot className="size-4" />
      </span>
      <span className="text-sm font-semibold tracking-tight">Relay CRM</span>
    </Link>
  );
}

function UserCard({ onLogout }: { onLogout: () => void }) {
  const { session } = useSession();
  const { user } = session;

  return (
    <div className="shrink-0 border-t border-border p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand ring-1 ring-brand/20">
          {initials(user.firstName, user.lastName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{user.fullName}</p>
          <p className="truncate text-xs text-ink-subtle">
            {user.roles.map((role) => role.name).join(', ') || 'No role'}
          </p>
        </div>
      </div>
      <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={onLogout}>
        <LogOut className="size-4" />
        Sign out
      </Button>
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
