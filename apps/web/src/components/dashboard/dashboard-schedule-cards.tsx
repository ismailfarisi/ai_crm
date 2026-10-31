import Link from 'next/link';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export interface ScheduleItem {
  id: string;
  /** "QT-2026-0014" or "Not yet numbered". */
  reference: string;
  title: string;
  amount?: string;
  /** "Since 28 Oct 2026". */
  timeLabel?: string;
  href: string;
}

export interface ScheduleGroup {
  key: string;
  title: string;
  /** The real number, which can be more than the items listed. */
  count: number;
  items: ScheduleItem[];
  /** Where the full list lives. */
  href: string;
  /** Approvals are the viewer's to decide, and say so. */
  tone?: 'warning' | 'neutral';
}

export interface DashboardScheduleCardsProps {
  /**
   * Real work items, in the order they matter to the viewer. There is no
   * sample list: this panel used to show three invented meetings to every
   * account, identical across unrelated tenants.
   */
  groups?: ScheduleGroup[];
  /** Shown when nothing in any group is outstanding. */
  emptyLabel?: string;
  className?: string;
}

/**
 * What is waiting on the viewer, one group per kind of work. Approvals come
 * first and are never crowded out by drafts: each group shows its own count,
 * so seven approvals cannot hide behind three newer drafts.
 */
export function DashboardScheduleCards({
  groups = [],
  emptyLabel = 'Nothing is waiting on you.',
  className,
}: DashboardScheduleCardsProps) {
  const shown = groups.filter((g) => g.count > 0);

  return (
    <section
      aria-labelledby="waiting-title"
      className={cn('flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-xs', className)}
    >
      <h2 id="waiting-title" className="text-sm font-semibold text-ink">
        Waiting on you
      </h2>

      {shown.length === 0 ? (
        <p data-testid="schedule-empty-state" className="py-10 text-center text-xs text-ink-muted">
          {emptyLabel}
        </p>
      ) : (
        <div className="mt-3 space-y-5">
          {shown.map((group) => (
            <div key={group.key} data-testid={`waiting-${group.key}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  {group.title}
                  <Badge tone={group.tone ?? 'neutral'} className="tabular-nums normal-case">
                    {group.count}
                  </Badge>
                </h3>
                {group.count > group.items.length && (
                  <Link
                    href={group.href}
                    className="inline-flex items-center gap-1 text-xs font-medium text-ink underline-offset-2 hover:underline"
                  >
                    View all {group.count}
                    <ArrowRight className="size-3" aria-hidden />
                  </Link>
                )}
              </div>
              <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="flex min-h-11 items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-muted"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                        <p className="truncate text-xs text-ink-muted">
                          <span className="font-mono">{item.reference}</span>
                          {item.timeLabel ? ` · ${item.timeLabel}` : ''}
                        </p>
                      </div>
                      {item.amount && (
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{item.amount}</span>
                      )}
                      <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
