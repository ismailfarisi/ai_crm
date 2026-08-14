'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Radio,
  Receipt,
  Search,
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

interface NavSection {
  title?: string;
  items: NavItem[];
}

const CORE_ACTION_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    href: '/inbox',
    label: 'Inbox',
    icon: MessageSquare,
    rule: { permission: PERMISSIONS.CHANNEL_READ },
  },
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
];

const SECONDARY_SECTIONS: NavSection[] = [
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
      {
        href: '/settings/channels',
        label: 'Channels',
        icon: Radio,
        rule: { permission: PERMISSIONS.CHANNEL_MANAGE },
      },
    ],
  },
];

function pageTitleFor(pathname: string): string {
  const allItems = [...CORE_ACTION_ITEMS, ...SECONDARY_SECTIONS.flatMap((s) => s.items)];
  const match = allItems.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return match?.label ?? 'Dashboard';
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, check, logout } = useSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Settings: true,
  });

  const toggleSection = (title: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [title]: !prev[title],
    }));
  };

  const visibleCoreItems = CORE_ACTION_ITEMS.filter((item) => check(item.rule ?? {}));
  const visibleSecondarySections = SECONDARY_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => check(item.rule ?? {})),
  })).filter((section) => section.items.length > 0);

  const sidebarContent = (
    <div className="flex flex-1 flex-col overflow-y-auto px-3 py-2 scrollbar-thin">
      {/* 2-Column Core Action Tile Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {visibleCoreItems.map((item) => {
          const active =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex min-h-[72px] flex-col items-start justify-between rounded-2xl p-3 transition-all',
                active
                  ? 'bg-[#1E1E1E] text-white shadow-md'
                  : 'border border-border/50 bg-surface-muted/60 text-ink-muted hover:bg-surface-muted hover:text-ink hover:shadow-xs',
              )}
            >
              <Icon
                className={cn(
                  'size-5 shrink-0 transition-colors',
                  active ? 'text-white' : 'text-ink-subtle group-hover:text-ink',
                )}
              />
              <span
                className={cn(
                  'text-xs font-semibold tracking-tight',
                  active ? 'text-white' : 'text-ink-muted group-hover:text-ink',
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Secondary Collapsible Sections */}
      {visibleSecondarySections.length > 0 && (
        <div className="mt-5 space-y-4">
          {visibleSecondarySections.map((section, index) => {
            const sectionTitle = section.title ?? `Section ${index + 1}`;
            const isOpen = openSections[sectionTitle] !== false;

            return (
              <div key={sectionTitle} className="space-y-1">
                {section.title && (
                  <button
                    type="button"
                    onClick={() => toggleSection(sectionTitle)}
                    className="flex w-full items-center justify-between px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle transition-colors hover:text-ink"
                  >
                    <span>{section.title}</span>
                    <ChevronDown
                      className={cn(
                        'size-3.5 text-ink-subtle transition-transform duration-200',
                        isOpen ? 'rotate-0' : '-rotate-90',
                      )}
                    />
                  </button>
                )}

                {isOpen && (
                  <ul className="space-y-0.5">
                    {section.items.map((item) => {
                      const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      const Icon = item.icon;

                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={() => setMobileOpen(false)}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              'flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-all',
                              active
                                ? 'bg-surface-muted font-semibold text-ink shadow-2xs'
                                : 'text-ink-muted hover:bg-surface-muted/70 hover:text-ink',
                            )}
                          >
                            <Icon
                              className={cn(
                                'size-3.5 shrink-0',
                                active ? 'text-brand' : 'text-ink-subtle',
                              )}
                            />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <Brand />
        <SidebarSearch />
        {sidebarContent}
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
            <SidebarSearch />
            {sidebarContent}
            <UserCard onLogout={logout} />
          </aside>
        </div>
      )}

      {/* Main Content Area */}
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
    <Link href="/dashboard" className="flex items-center gap-2.5 px-4 pt-4 pb-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-amber-500 text-stone-950 font-bold shadow-xs">
        <CircleDot className="size-4.5 stroke-[2.5]" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-bold tracking-tight text-ink">Relay CRM</span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
          Workspace
        </span>
      </div>
    </Link>
  );
}

function SidebarSearch() {
  return (
    <div className="px-3 pb-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-subtle" />
        <input
          type="text"
          placeholder="Search here"
          className="w-full rounded-full border border-border/80 bg-surface-muted/60 py-1.5 pr-4 pl-9 text-xs text-ink placeholder:text-ink-subtle transition-colors focus:border-brand focus:bg-surface focus:outline-none"
        />
      </div>
    </div>
  );
}

function UserCard({ onLogout }: { onLogout: () => void }) {
  const { session } = useSession();
  const { user } = session;

  return (
    <div className="shrink-0 border-t border-border/60 p-3">
      <div className="flex items-center gap-2.5 rounded-2xl border border-border/70 bg-surface-muted/40 p-2 transition-colors hover:bg-surface-muted/60">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-500/15 text-xs font-bold text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300">
          {initials(user.firstName, user.lastName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold leading-tight text-ink">{user.fullName}</p>
          <span className="inline-block truncate rounded-md border border-border/50 bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-subtle">
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
