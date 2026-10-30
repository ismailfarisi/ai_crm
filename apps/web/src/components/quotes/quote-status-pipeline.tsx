'use client';

import { Check, Circle, XCircle, Clock, FileEdit, CheckCircle2, ChevronRight } from 'lucide-react';
import type { QuoteStatus } from '@saas/shared';
import { cn } from '@/lib/utils';

interface QuoteStatusPipelineProps {
  status: QuoteStatus;
  /** The customer has accepted: the last step, and the one that raises the order. */
  accepted?: boolean;
  className?: string;
}

interface StepConfig {
  key: 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'ACCEPTED';
  label: string;
  shortLabel: string;
  stepNumber: number;
}

const STEPS: StepConfig[] = [
  { key: 'DRAFT', label: 'Draft', shortLabel: 'Draft', stepNumber: 1 },
  { key: 'AWAITING_APPROVAL', label: 'Awaiting approval', shortLabel: 'Approval', stepNumber: 2 },
  { key: 'APPROVED', label: 'Approved', shortLabel: 'Approved', stepNumber: 3 },
  { key: 'ACCEPTED', label: 'Accepted', shortLabel: 'Accepted', stepNumber: 4 },
];

export function QuoteStatusPipeline({ status, accepted = false, className }: QuoteStatusPipelineProps) {
  const isRejected = status === 'REJECTED';

  const getStepState = (stepKey: StepConfig['key']): 'completed' | 'current' | 'upcoming' | 'rejected' => {
    if (isRejected) {
      if (stepKey === 'DRAFT') return 'completed';
      if (stepKey === 'AWAITING_APPROVAL') return 'rejected';
      return 'upcoming';
    }

    if (status === 'APPROVED') {
      if (accepted) return stepKey === 'ACCEPTED' ? 'current' : 'completed';
      if (stepKey === 'APPROVED') return 'current';
      if (stepKey === 'ACCEPTED') return 'upcoming';
      return 'completed';
    }

    if (status === 'AWAITING_APPROVAL') {
      if (stepKey === 'DRAFT') return 'completed';
      if (stepKey === 'AWAITING_APPROVAL') return 'current';
      return 'upcoming';
    }

    // DRAFT
    if (stepKey === 'DRAFT') return 'current';
    return 'upcoming';
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <nav aria-label="Quote progress" className="flex items-center">
        <ol className="flex items-center rounded-full border border-border bg-surface p-1 text-xs">
          {STEPS.map((step, idx) => {
            const state = getStepState(step.key);
            const isLast = idx === STEPS.length - 1;

            return (
              <li
                key={step.key}
                className="flex items-center"
                aria-current={state === 'current' ? 'step' : undefined}
              >
                <div
                  className={cn(
                    'flex items-center gap-1.5 transition-all text-xs',
                    state === 'current' &&
                      'bg-ink text-surface font-semibold rounded-full px-3.5 py-1 shadow-xs',
                    state === 'completed' &&
                      'text-ink-muted px-2 py-1 font-medium hover:text-ink sm:px-3',
                    state === 'upcoming' &&
                      'text-ink-subtle px-2 py-1 sm:px-3',
                    state === 'rejected' &&
                      'text-danger font-semibold px-3 py-1 bg-danger-soft rounded-full',
                  )}
                >
                  {state === 'completed' && (
                    <Check className="size-3 text-success stroke-[2.5]" aria-hidden />
                  )}
                  {state === 'rejected' && (
                    <XCircle className="size-3" aria-hidden />
                  )}
                  {state === 'current' && step.key === 'AWAITING_APPROVAL' && (
                    <Clock className="size-3" aria-hidden />
                  )}
                  {state === 'current' && (step.key === 'APPROVED' || step.key === 'ACCEPTED') && (
                    <CheckCircle2 className="size-3" aria-hidden />
                  )}
                  {state === 'current' && step.key === 'DRAFT' && (
                    <FileEdit className="size-3" aria-hidden />
                  )}

                  {state === 'upcoming' && (
                    <Circle className="size-3 sm:hidden" aria-hidden />
                  )}

                  {/* On a phone only the current step is spelled out; the rest stay readable to screen readers. */}
                  <span className={state === 'current' ? undefined : 'sr-only sm:not-sr-only'}>
                    <span className="hidden sm:inline">{step.label}</span>
                    <span className="inline sm:hidden">{step.shortLabel}</span>
                  </span>
                </div>

                {!isLast && (
                  <ChevronRight
                    className="size-3 text-ink-subtle shrink-0 mx-0.5 select-none"
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Red badge if rejected */}
      {isRejected && (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-danger/20 bg-danger-soft px-3 py-0.5 text-xs font-semibold text-danger">
          <XCircle className="size-3.5" aria-hidden />
          <span>Rejected: needs changes</span>
        </div>
      )}
    </div>
  );
}
