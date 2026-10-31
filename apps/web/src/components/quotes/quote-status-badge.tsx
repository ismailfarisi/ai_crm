import type { QuoteStatus } from '@/hooks/use-quotes';
import { Badge } from '@/components/ui/primitives';

interface QuoteStatusBadgeProps {
  status: QuoteStatus;
  className?: string;
}

const STATUS: Record<QuoteStatus, { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  AWAITING_APPROVAL: { label: 'Awaiting approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

/** A word in the status's own tone. No pulsing dot: waiting is a state, not an alarm. */
export function QuoteStatusBadge({ status, className }: QuoteStatusBadgeProps) {
  const { label, tone } = STATUS[status] ?? STATUS.DRAFT;
  return (
    <Badge tone={tone} className={className}>
      {label}
    </Badge>
  );
}
