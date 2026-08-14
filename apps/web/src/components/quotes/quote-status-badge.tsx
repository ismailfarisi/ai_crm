import type { QuoteStatus } from '@/hooks/use-quotes';
import { cn } from '@/lib/utils';

interface QuoteStatusBadgeProps {
  status: QuoteStatus;
  className?: string;
}

export function QuoteStatusBadge({ status, className }: QuoteStatusBadgeProps) {
  switch (status) {
    case 'AWAITING_APPROVAL':
      return (
        <span
          className={cn(
            'inline-flex items-center rounded-full border border-brand/25 bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-hover',
            className
          )}
        >
          <span className="relative mr-1.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
          </span>
          Awaiting Approval
        </span>
      );
    case 'APPROVED':
      return (
        <span
          className={cn(
            'inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400',
            className
          )}
        >
          <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Approved
        </span>
      );
    case 'REJECTED':
      return (
        <span
          className={cn(
            'inline-flex items-center rounded-full border border-rose-500/25 bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-400',
            className
          )}
        >
          <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-rose-500" />
          Rejected
        </span>
      );
    case 'DRAFT':
    default:
      return (
        <span
          className={cn(
            'inline-flex items-center rounded-full border border-border/80 bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-muted',
            className
          )}
        >
          <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-ink-subtle" />
          Draft
        </span>
      );
  }
}
