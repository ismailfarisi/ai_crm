'use client';

import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Calendar,
  Clock,
  FileText,
  PhoneCall,
  Video,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ScheduleItem {
  id: string;
  title: string;
  category: 'meeting' | 'quote' | 'call';
  categoryLabel: string;
  timeLabel: string;
  amount?: string;
  statusBadge?: string;
  attendees?: string[];
  href: string;
}

const DEFAULT_SCHEDULE_ITEMS: ScheduleItem[] = [
  {
    id: '1',
    title: 'Acme Corp — Enterprise Contract Review',
    category: 'meeting',
    categoryLabel: 'Google Meet',
    timeLabel: 'Today, 10:30 AM',
    attendees: ['AC', 'JD', 'MS'],
    href: '/contacts',
  },
  {
    id: '2',
    title: 'Quantum Dynamics — Cloud Migration Suite',
    category: 'quote',
    categoryLabel: 'Draft Quote',
    timeLabel: 'Due Today, 2:00 PM',
    amount: '$45,000',
    statusBadge: 'Ready for Review',
    attendees: ['QD', 'IF'],
    href: '/quotes',
  },
  {
    id: '3',
    title: 'Starlight Industries — Discovery & Scope',
    category: 'call',
    categoryLabel: 'Discovery Call',
    timeLabel: 'Tomorrow, 11:00 AM',
    attendees: ['SI', 'JD'],
    href: '/contacts',
  },
];

const CATEGORY_ICONS = {
  meeting: Video,
  quote: FileText,
  call: PhoneCall,
};

export interface DashboardScheduleCardsProps {
  items?: ScheduleItem[];
  className?: string;
}

export function DashboardScheduleCards({
  items = DEFAULT_SCHEDULE_ITEMS,
  className,
}: DashboardScheduleCardsProps) {
  return (
    <div
      className={cn(
        'flex flex-col justify-between rounded-2xl border border-border bg-surface p-5 shadow-xs',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Calendar className="size-3.5" />
          </span>
          <h3 className="text-sm font-semibold text-ink">Upcoming Deals & Schedule</h3>
        </div>

        <Link
          href="/quotes"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
        >
          View all
          <ArrowRight className="size-3" />
        </Link>
      </div>

      {/* Schedule Stack of Warm Gradient Cards */}
      <div className="mt-3.5 space-y-3">
        {items.map((item) => {
          const Icon = CATEGORY_ICONS[item.category] || FileText;

          return (
            <div
              key={item.id}
              className="group relative flex flex-col justify-between rounded-2xl border border-amber-200/60 bg-gradient-to-br from-amber-100/70 to-amber-50/30 p-3.5 shadow-2xs transition-all hover:border-amber-300 hover:shadow-xs dark:border-amber-900/40 dark:from-amber-950/30 dark:to-stone-900/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {/* Category & Time Badges */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/60 bg-amber-200/50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                      <Icon className="size-3" />
                      {item.categoryLabel}
                    </span>

                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted">
                      <Clock className="size-3 text-ink-subtle" />
                      {item.timeLabel}
                    </span>

                    {item.amount && (
                      <span className="rounded-md bg-stone-900 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 dark:bg-stone-800 dark:text-amber-200">
                        {item.amount}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h4 className="mt-1.5 truncate text-xs font-semibold text-ink group-hover:text-amber-950 dark:group-hover:text-amber-200">
                    {item.title}
                  </h4>
                </div>

                {/* Circular Dark Action Button */}
                <Link
                  href={item.href}
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-[#1E1E1E] text-white shadow-xs transition-all group-hover:scale-105 group-hover:bg-black dark:bg-stone-800 dark:hover:bg-stone-700"
                  aria-label={`Open ${item.title}`}
                >
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </div>

              {/* Bottom Row: Attendees Avatars & Status */}
              <div className="mt-2.5 flex items-center justify-between border-t border-amber-200/40 pt-2 dark:border-amber-900/30">
                <div className="flex items-center -space-x-1.5 overflow-hidden">
                  {item.attendees?.map((initial, i) => (
                    <span
                      key={i}
                      className="grid size-5.5 place-items-center rounded-full border border-surface bg-amber-200 text-[9px] font-bold text-amber-900 dark:border-stone-800 dark:bg-amber-900 dark:text-amber-100"
                    >
                      {initial}
                    </span>
                  ))}
                </div>

                {item.statusBadge && (
                  <span className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                    {item.statusBadge}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
