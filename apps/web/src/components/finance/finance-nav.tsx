'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export interface FinanceTabItem {
  href: string;
  label: string;
  badge?: string | number;
}

export interface FinanceNavGroup {
  /** Shown before the group's items; a group of one needs none. */
  label?: string;
  items: FinanceTabItem[];
}

/** Money is day-to-day cash; books is the ledger and its settings. */
export const FINANCE_NAV_GROUPS: FinanceNavGroup[] = [
  {
    label: 'Money',
    items: [
      { href: '/finance', label: 'Overview' },
      { href: '/finance/accounts', label: 'Accounts' },
      { href: '/finance/expenses', label: 'Expenses' },
      { href: '/finance/budgets', label: 'Budgets' },
      { href: '/finance/subscriptions', label: 'Subscriptions' },
    ],
  },
  {
    label: 'Books',
    items: [
      { href: '/finance/journal', label: 'Journal' },
      { href: '/finance/chart-of-accounts', label: 'Chart of accounts' },
      { href: '/finance/currencies', label: 'Currencies' },
      { href: '/finance/tax', label: 'Tax' },
    ],
  },
  { items: [{ href: '/finance/reports', label: 'Reports' }] },
];

export const FINANCE_NAV_ITEMS: FinanceTabItem[] = FINANCE_NAV_GROUPS.flatMap((g) => g.items);

export interface FinanceNavProps {
  className?: string;
}

/**
 * Finance sub-navigation. It wraps rather than scrolls, so every page and the
 * one you are on stay in view at any width, phones included.
 */
export function FinanceNav({ className }: FinanceNavProps) {
  const pathname = usePathname();

  return (
    <nav
      data-testid="finance-nav"
      aria-label="Finance"
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3', className)}
    >
      {FINANCE_NAV_GROUPS.map((group, index) => (
        <div
          key={group.label ?? index}
          role={group.label ? 'group' : undefined}
          aria-label={group.label}
          className={cn('flex flex-wrap items-center gap-1', index > 0 && 'sm:border-s sm:border-border sm:ps-4')}
        >
          {group.label && (
            <span aria-hidden className="pe-1 text-[11px] font-semibold text-ink-subtle">
              {group.label}
            </span>
          )}
          {group.items.map((item) => {
            const isActive =
              item.href === '/finance'
                ? pathname === '/finance'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                data-testid={`finance-nav-item-${item.href.replace(/\//g, '-')}`}
                className={cn(
                  'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-charcoal text-on-charcoal shadow-xs'
                    : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                )}
              >
                {item.label}
                {item.badge !== undefined && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                      isActive ? 'bg-on-charcoal/15' : 'bg-surface-muted text-ink-muted',
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
