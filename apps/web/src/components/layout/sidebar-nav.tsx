'use client';

import { useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, Database, Search, Settings, X } from 'lucide-react';
import { PERMISSIONS } from '@saas/shared';
import { useSession } from '@/lib/session-context';
import { cn } from '@/lib/utils';
import { NAV_SECTIONS, SETTINGS_SECTIONS, allNavItems, searchNav, type NavItem } from '@/lib/nav';
import { useAutomationApprovalCount } from '@/hooks/use-automations';
import { useCustomObjects } from '@/hooks/use-custom-objects';

/**
 * The one visible item the pathname belongs to: an exact match or a path
 * prefix, and the longest href wins, so /automations/approvals does not also
 * light up /automations.
 */
export function activeHrefFor(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    const matches =
      pathname === item.href ||
      (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
    if (matches && (best === null || item.href.length > best.length)) best = item.href;
  }
  return best;
}

function NavBadge({ kind }: { kind: NonNullable<NavItem['badge']> }) {
  const { can } = useSession();
  const canApprove = can(PERMISSIONS.AUTOMATION_APPROVE);
  const { data } = useAutomationApprovalCount({
    enabled: kind === 'automationApprovals' && canApprove,
  });
  const count = canApprove ? (data?.count ?? 0) : 0;
  if (count <= 0) return null;
  return (
    <span
      data-testid={`nav-badge-${kind}`}
      className="ml-auto rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-semibold leading-none text-on-brand"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function NavRow({
  item,
  active,
  onNavigate,
  group,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: () => void;
  group?: string;
}) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        title={item.hint}
        className={cn(
          'flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-[13px] font-medium transition',
          active
            ? 'bg-charcoal font-semibold text-on-charcoal shadow-xs'
            : 'text-ink-muted hover:bg-surface-muted/70 hover:text-ink',
        )}
      >
        <Icon className={cn('size-4 shrink-0', active ? 'text-on-charcoal' : 'text-ink-subtle')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{item.label}</span>
          {group !== undefined && (
            <span className={cn('block truncate text-[11px] font-normal', active ? 'text-on-charcoal/80' : 'text-ink-subtle')}>
              {group ? `${group} · ` : ''}
              {item.hint}
            </span>
          )}
        </span>
        {item.badge && <NavBadge kind={item.badge} />}
      </Link>
    </li>
  );
}

function GroupHeading({
  title,
  open,
  onToggle,
  icon: Icon,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  icon?: typeof Settings;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-1.5 px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle transition-colors hover:text-ink"
    >
      {Icon && <Icon className="size-3.5" aria-hidden />}
      <span className="flex-1 text-start">{title}</span>
      <ChevronDown
        className={cn('size-3.5 transition-transform duration-200', open ? 'rotate-0' : '-rotate-90')}
        aria-hidden
      />
    </button>
  );
}

/**
 * The menu: a search box, then the pages grouped by the job they are for.
 * Search looks through every page the user may open, settings included, so a
 * collapsed group never hides anything from it.
 */
export function SidebarNav({ onNavigate }: { onNavigate: () => void }) {
  const { check } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState('');
  // Undefined means "as the default says": open, except Settings away from a settings page.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const visible = (items: NavItem[]) => items.filter((item) => check(item.rule ?? {}));
  const sections = NAV_SECTIONS.map((s) => ({ ...s, items: visible(s.items) })).filter((s) => s.items.length > 0);
  const settings = SETTINGS_SECTIONS.map((s) => ({ ...s, items: visible(s.items) })).filter(
    (s) => s.items.length > 0,
  );
  const activeHref = activeHrefFor(pathname, [...sections, ...settings].flatMap((s) => s.items));

  const { data: customObjects = [] } = useCustomObjects();
  const activeCustomObjects = customObjects.filter((obj) => !obj.isArchived);

  const results = searchNav(
    allNavItems().filter((item) => check(item.rule ?? {})),
    query,
  );

  const isOpen = (title: string, fallback: boolean) => openSections[title] ?? fallback;
  const toggle = (title: string, fallback: boolean) =>
    setOpenSections((prev) => ({ ...prev, [title]: !(prev[title] ?? fallback) }));

  const go = () => {
    setQuery('');
    onNavigate();
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') setQuery('');
    if (event.key === 'Enter' && results[0]) {
      event.preventDefault();
      router.push(results[0].href);
      go();
    }
  };

  const settingsOpen = isOpen('Settings', pathname.startsWith('/settings'));

  return (
    <>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-subtle" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Find a page"
            aria-label="Find a page"
            className="w-full rounded-full border border-border/80 bg-surface-muted/60 py-1.5 pr-8 pl-9 text-xs text-ink placeholder:text-ink-subtle transition-colors focus:border-brand focus:bg-surface focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1.5 rounded-full p-0.5 text-ink-subtle hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col overflow-y-auto px-2 pb-3 scrollbar-thin">
        {query.trim() ? (
          results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-muted">No page matches “{query.trim()}”.</p>
          ) : (
            <ul className="space-y-0.5" aria-label="Matching pages">
              {results.map((item) => (
                <NavRow
                  key={item.href}
                  item={item}
                  group={item.group}
                  active={item.href === activeHref}
                  onNavigate={go}
                />
              ))}
            </ul>
          )
        ) : (
          <>
            {sections.map((section) => {
              const title = section.title;
              const open = !title || isOpen(title, true);
              return (
                <div key={title ?? 'top'}>
                  {title && <GroupHeading title={title} open={open} onToggle={() => toggle(title, true)} />}
                  {open && (
                    <ul className="space-y-0.5">
                      {section.items.map((item) => (
                        <NavRow key={item.href} item={item} active={item.href === activeHref} onNavigate={onNavigate} />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

            {activeCustomObjects.length > 0 && (
              <div>
                <GroupHeading
                  title="Custom data"
                  open={isOpen('Custom data', true)}
                  onToggle={() => toggle('Custom data', true)}
                />
                {isOpen('Custom data', true) && (
                  <ul className="space-y-0.5">
                    {activeCustomObjects.map((obj) => {
                      const href = `/objects/${obj.slug}`;
                      const active = pathname === href || pathname.startsWith(`${href}/`);
                      return (
                        <NavRow
                          key={obj.id || obj.slug}
                          item={{ href, label: obj.name, icon: Database }}
                          active={active}
                          onNavigate={onNavigate}
                        />
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {settings.length > 0 && (
              <div className="mt-2 border-t border-border/60 pt-1">
                <GroupHeading
                  title="Settings"
                  icon={Settings}
                  open={settingsOpen}
                  onToggle={() => toggle('Settings', pathname.startsWith('/settings'))}
                />
                {settingsOpen &&
                  settings.map((section) => (
                    <div key={section.title}>
                      <p className="px-3 pt-2 pb-0.5 text-[11px] font-medium text-ink-subtle">{section.title}</p>
                      <ul className="space-y-0.5">
                        {section.items.map((item) => (
                          <NavRow key={item.href} item={item} active={item.href === activeHref} onNavigate={onNavigate} />
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </nav>
    </>
  );
}
