import { QUOTE_STATUS_LABELS, quoteDisplayStatus, type QuoteDisplayStatus } from '@saas/shared';
import type { QuoteStatus } from '@/hooks/use-quotes';
import { Badge } from '@/components/ui/primitives';

interface QuoteStatusBadgeProps {
  /** The quote's stored status, or the state already worked out with `quoteDisplayStatus`. */
  status: QuoteStatus | QuoteDisplayStatus;
  /** When the customer accepted; an approved quote they accepted reads "Accepted". */
  acceptedAt?: string | Date | null;
  className?: string;
}

const TONE: Record<QuoteDisplayStatus, 'neutral' | 'warning' | 'success' | 'danger' | 'info'> = {
  DRAFT: 'neutral',
  AWAITING_APPROVAL: 'warning',
  APPROVED: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
};

/** A word in the status's own tone. No pulsing dot: waiting is a state, not an alarm. */
export function QuoteStatusBadge({ status, acceptedAt, className }: QuoteStatusBadgeProps) {
  const shown = quoteDisplayStatus({ status, acceptedAt });
  const known = shown in TONE ? shown : 'DRAFT';
  return (
    <Badge tone={TONE[known]} className={className}>
      {QUOTE_STATUS_LABELS[known]}
    </Badge>
  );
}
