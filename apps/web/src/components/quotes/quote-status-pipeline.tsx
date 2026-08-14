'use client';

import { Check, XCircle, Clock, FileEdit, CheckCircle2, ChevronRight } from 'lucide-react';
import type { QuoteStatus } from '@saas/shared';
import { cn } from '@/lib/utils';

interface QuoteStatusPipelineProps {
  status: QuoteStatus;
  className?: string;
}

interface StepConfig {
  key: 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED';
  label: string;
  shortLabel: string;
  stepNumber: number;
}

const STEPS: StepConfig[] = [
  { key: 'DRAFT', label: 'Quotation (Draft)', shortLabel: 'Draft', stepNumber: 1 },
  { key: 'AWAITING_APPROVAL', label: 'Awaiting Approval', shortLabel: 'Review', stepNumber: 2 },
  { key: 'APPROVED', label: 'Quotation Confirmed', shortLabel: 'Confirmed', stepNumber: 3 },
];

export function QuoteStatusPipeline({ status, className }: QuoteStatusPipelineProps) {
  const isRejected = status === 'REJECTED';

  const getStepState = (stepKey: StepConfig['key']): 'completed' | 'current' | 'upcoming' | 'rejected' => {
    if (isRejected) {
      if (stepKey === 'DRAFT') return 'completed';
      if (stepKey === 'AWAITING_APPROVAL') return 'rejected';
      return 'upcoming';
    }

    if (status === 'APPROVED') {
      if (stepKey === 'APPROVED') return 'current';
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
      <nav aria-label="Quotation Lifecycle Progress" className="flex items-center">
        <ol className="flex items-center rounded-full border border-border/40 bg-surface/60 p-1 text-xs">
          {STEPS.map((step, idx) => {
            const state = getStepState(step.key);
            const isLast = idx === STEPS.length - 1;

            return (
              <li key={step.key} className="flex items-center">
                <div
                  className={cn(
                    'flex items-center gap-1.5 transition-all text-xs',
                    state === 'current' &&
                      'bg-brand text-ink font-semibold rounded-full px-3.5 py-1 shadow-xs',
                    state === 'completed' &&
                      'text-ink-muted px-3 py-1 font-medium hover:text-ink',
                    state === 'upcoming' &&
                      'text-ink-subtle px-3 py-1',
                    state === 'rejected' &&
                      'text-rose-600 dark:text-rose-400 font-semibold px-3 py-1 bg-rose-500/10 rounded-full',
                  )}
                >
                  {state === 'completed' && (
                    <Check className="size-3 text-emerald-600 dark:text-emerald-400 stroke-[2.5]" />
                  )}
                  {state === 'rejected' && (
                    <XCircle className="size-3 text-rose-600 dark:text-rose-400" />
                  )}
                  {state === 'current' && step.key === 'AWAITING_APPROVAL' && (
                    <Clock className="size-3 animate-pulse text-amber-600 dark:text-amber-400" />
                  )}
                  {state === 'current' && step.key === 'APPROVED' && (
                    <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
                  )}
                  {state === 'current' && step.key === 'DRAFT' && (
                    <FileEdit className="size-3" />
                  )}

                  {/* Label */}
                  <span className="hidden sm:inline">{step.label}</span>
                  <span className="inline sm:hidden">{step.shortLabel}</span>
                </div>

                {!isLast && (
                  <ChevronRight
                    className="size-3 text-border/80 shrink-0 mx-0.5 select-none"
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
        <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-200/60 bg-rose-100/60 px-3 py-0.5 text-xs font-semibold text-rose-800 dark:border-rose-800/40 dark:bg-rose-950/40 dark:text-rose-300">
          <XCircle className="size-3.5 text-rose-600" />
          <span>Rejected / Revision Needed</span>
        </div>
      )}
    </div>
  );
}
