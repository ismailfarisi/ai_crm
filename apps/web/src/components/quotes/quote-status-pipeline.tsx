'use client';

import { Check, XCircle, Clock, FileEdit, CheckCircle2 } from 'lucide-react';
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
        <ol className="flex flex-wrap items-center gap-1 sm:gap-2">
          {STEPS.map((step, idx) => {
            const state = getStepState(step.key);
            const isLast = idx === STEPS.length - 1;

            return (
              <li key={step.key} className="flex items-center">
                <div
                  className={cn(
                    'group flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-all sm:px-3.5 sm:py-1.5',
                    state === 'current' &&
                      'border-brand/40 bg-brand text-ink font-bold shadow-xs ring-2 ring-brand/20',
                    state === 'completed' &&
                      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300 font-semibold',
                    state === 'upcoming' &&
                      'border-border/80 bg-surface-muted/60 text-ink-subtle',
                    state === 'rejected' &&
                      'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300 font-semibold',
                  )}
                >
                  {/* Status icon / Step indicator */}
                  <span
                    className={cn(
                      'flex size-4.5 items-center justify-center rounded-full text-[11px] font-bold',
                      state === 'current' && 'bg-ink text-surface',
                      state === 'completed' && 'bg-emerald-600 text-white',
                      state === 'upcoming' && 'bg-border text-ink-muted',
                      state === 'rejected' && 'bg-rose-600 text-white',
                    )}
                  >
                    {state === 'completed' ? (
                      <Check className="size-3 stroke-[3]" />
                    ) : state === 'rejected' ? (
                      <XCircle className="size-3" />
                    ) : state === 'current' && step.key === 'AWAITING_APPROVAL' ? (
                      <Clock className="size-3 animate-pulse" />
                    ) : state === 'current' && step.key === 'APPROVED' ? (
                      <CheckCircle2 className="size-3" />
                    ) : state === 'current' && step.key === 'DRAFT' ? (
                      <FileEdit className="size-3" />
                    ) : (
                      step.stepNumber
                    )}
                  </span>

                  {/* Label */}
                  <span className="hidden sm:inline">{step.label}</span>
                  <span className="inline sm:hidden">{step.shortLabel}</span>
                </div>

                {!isLast && (
                  <span
                    className={cn(
                      'mx-1 text-xs select-none',
                      state === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-subtle',
                    )}
                    aria-hidden="true"
                  >
                    ➔
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Red badge if rejected */}
      {isRejected && (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-100/80 px-2.5 py-0.5 text-xs font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
          <XCircle className="size-3.5 text-rose-600" />
          <span>Rejected / Revision Needed</span>
        </div>
      )}
    </div>
  );
}
