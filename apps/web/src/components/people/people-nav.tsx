'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Banknote, Users, type LucideIcon } from 'lucide-react';
import { PERMISSIONS } from '@saas/shared';
import { useSession } from '@/lib/session-context';
import type { AccessRule } from '@/lib/access';
import { cn } from '@/lib/utils';

interface PeopleTab {
  href: string;
  label: string;
  icon: LucideIcon;
  rule: AccessRule;
}

export const PEOPLE_NAV_ITEMS: PeopleTab[] = [
  { href: '/people/employees', label: 'Employees', icon: Users, rule: { permission: PERMISSIONS.EMPLOYEE_READ } },
  { href: '/people/payroll', label: 'Payroll', icon: Banknote, rule: { permission: PERMISSIONS.PAYROLL_READ } },
];

export function PeopleNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const { check } = useSession();

  return (
    <nav
      data-testid="people-nav"
      aria-label="People navigation"
      className={cn('flex items-center gap-1.5 overflow-x-auto border-b border-border/40 pb-3', className)}
    >
      {PEOPLE_NAV_ITEMS.filter((item) => check(item.rule)).map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all',
              active
                ? 'bg-ink text-surface shadow-xs dark:bg-amber-500 dark:text-stone-950'
                : 'text-ink-muted hover:bg-surface-muted/80 hover:text-ink',
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
