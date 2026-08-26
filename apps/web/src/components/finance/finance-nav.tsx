'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  TrendingUp,
  Receipt,
  DollarSign,
  Landmark,
  Layers,
  LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FinanceTabItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string | number;
}

export const FINANCE_NAV_ITEMS: FinanceTabItem[] = [
  {
    href: '/finance',
    label: 'Treasury Overview',
    icon: TrendingUp,
  },
  {
    href: '/finance/expenses',
    label: 'Expenses & Receipts',
    icon: Receipt,
  },
  {
    href: '/finance/budgets',
    label: 'Category Budgets',
    icon: DollarSign,
  },
  {
    href: '/finance/accounts',
    label: 'Bank & Cash Accounts',
    icon: Landmark,
  },
  {
    href: '/finance/subscriptions',
    label: 'Subscriptions & SaaS',
    icon: Layers,
  },
];

export interface FinanceNavProps {
  className?: string;
}

export function FinanceNav({ className }: FinanceNavProps) {
  const pathname = usePathname();

  return (
    <nav
      data-testid="finance-nav"
      aria-label="Finance navigation"
      className={cn(
        'flex items-center gap-1.5 overflow-x-auto border-b border-border/40 pb-3 scrollbar-none',
        className,
      )}
    >
      {FINANCE_NAV_ITEMS.map((item) => {
        const isActive =
          item.href === '/finance'
            ? pathname === '/finance'
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            data-testid={`finance-nav-item-${item.href.replace(/\//g, '-')}`}
            className={cn(
              'group inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all',
              isActive
                ? 'bg-ink text-surface shadow-xs dark:bg-amber-500 dark:text-stone-950'
                : 'text-ink-muted hover:bg-surface-muted/80 hover:text-ink',
            )}
          >
            <Icon
              className={cn(
                'size-3.5 shrink-0 transition-colors',
                isActive
                  ? 'text-surface dark:text-stone-950'
                  : 'text-ink-subtle group-hover:text-ink',
              )}
            />
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums',
                  isActive
                    ? 'bg-surface/20 text-surface dark:bg-stone-900/20 dark:text-stone-950'
                    : 'bg-surface-muted text-ink-subtle',
                )}
              >
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
