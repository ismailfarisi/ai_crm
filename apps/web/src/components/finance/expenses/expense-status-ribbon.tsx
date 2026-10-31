'use client';

import React from 'react';
import {
  FileEdit,
  Clock,
  CheckCircle2,
  DollarSign,
  XCircle,
  ChevronRight,
  ShieldCheck,
  UserCheck,
  AlertTriangle,
} from 'lucide-react';
import type { ExpenseClaimDto, ExpenseStatus } from '@saas/shared';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/primitives';

export interface ExpenseStatusRibbonProps {
  status: ExpenseStatus;
  claim?: ExpenseClaimDto | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  reimbursedAt?: string | null;
  rejectionReason?: string | null;
  createdAt?: string | null;
  compact?: boolean;
  className?: string;
}

interface StepConfig {
  key: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PAID';
  label: string;
  shortLabel: string;
  stepNumber: number;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS: StepConfig[] = [
  { key: 'DRAFT', label: 'Draft Created', shortLabel: 'Draft', stepNumber: 1, icon: FileEdit },
  { key: 'SUBMITTED', label: 'Submitted for Review', shortLabel: 'Submitted', stepNumber: 2, icon: Clock },
  { key: 'APPROVED', label: 'Approved', shortLabel: 'Approved', stepNumber: 3, icon: CheckCircle2 },
  { key: 'PAID', label: 'Reimbursed', shortLabel: 'Paid', stepNumber: 4, icon: DollarSign },
];

export function ExpenseStatusBadge({
  status,
  className,
}: {
  status: ExpenseStatus;
  className?: string;
}) {
  switch (status) {
    case 'DRAFT':
      return (
        <Badge
          data-testid="status-badge-draft"
          tone="neutral"
          className={cn('gap-1 font-medium', className)}
        >
          <FileEdit className="size-3 text-ink-subtle" aria-hidden />
          Draft
        </Badge>
      );
    case 'SUBMITTED':
      return (
        <Badge
          data-testid="status-badge-submitted"
          tone="warning"
          className={cn('gap-1 font-medium', className)}
        >
          <Clock className="size-3" aria-hidden />
          Submitted
        </Badge>
      );
    case 'APPROVED':
      return (
        <Badge
          data-testid="status-badge-approved"
          tone="info"
          className={cn('gap-1 font-medium', className)}
        >
          <CheckCircle2 className="size-3" aria-hidden />
          Approved
        </Badge>
      );
    case 'PAID':
      return (
        <Badge
          data-testid="status-badge-paid"
          tone="success"
          className={cn('gap-1 font-medium', className)}
        >
          <DollarSign className="size-3" aria-hidden />
          Paid
        </Badge>
      );
    case 'REJECTED':
      return (
        <Badge
          data-testid="status-badge-rejected"
          tone="danger"
          className={cn('gap-1 font-medium', className)}
        >
          <XCircle className="size-3" aria-hidden />
          Rejected
        </Badge>
      );
    default:
      return (
        <Badge tone="neutral" className={className}>
          {status}
        </Badge>
      );
  }
}

function formatStepDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

export function ExpenseStatusRibbon({
  status,
  claim,
  approvedAt,
  approvedBy,
  reimbursedAt,
  rejectionReason,
  createdAt,
  compact = false,
  className,
}: ExpenseStatusRibbonProps) {
  const isRejected = status === 'REJECTED';

  const effectiveApprovedAt = approvedAt ?? claim?.approvedAt;
  const effectiveApprovedBy = approvedBy ?? claim?.approvedById;
  const effectiveReimbursedAt = reimbursedAt ?? claim?.reimbursedAt;
  const effectiveRejectionReason = rejectionReason ?? claim?.rejectionReason;
  const effectiveCreatedAt = createdAt ?? claim?.createdAt;

  const getStepState = (
    stepKey: StepConfig['key'],
  ): 'completed' | 'current' | 'upcoming' | 'rejected' => {
    if (isRejected) {
      if (stepKey === 'DRAFT') return 'completed';
      if (stepKey === 'SUBMITTED') return 'rejected';
      return 'upcoming';
    }

    if (status === 'PAID') {
      if (stepKey === 'PAID') return 'current';
      return 'completed';
    }

    if (status === 'APPROVED') {
      if (stepKey === 'DRAFT' || stepKey === 'SUBMITTED') return 'completed';
      if (stepKey === 'APPROVED') return 'current';
      return 'upcoming';
    }

    if (status === 'SUBMITTED') {
      if (stepKey === 'DRAFT') return 'completed';
      if (stepKey === 'SUBMITTED') return 'current';
      return 'upcoming';
    }

    // DRAFT
    if (stepKey === 'DRAFT') return 'current';
    return 'upcoming';
  };

  const getStepTimestamp = (stepKey: StepConfig['key']): string | null => {
    switch (stepKey) {
      case 'DRAFT':
        return formatStepDate(effectiveCreatedAt);
      case 'SUBMITTED':
        return formatStepDate(effectiveCreatedAt);
      case 'APPROVED':
        return formatStepDate(effectiveApprovedAt);
      case 'PAID':
        return formatStepDate(effectiveReimbursedAt);
      default:
        return null;
    }
  };

  if (compact) {
    return (
      <div
        data-testid="expense-status-ribbon-compact"
        className={cn('inline-flex items-center gap-1.5', className)}
      >
        <ExpenseStatusBadge status={status} />
        {effectiveApprovedBy && status === 'APPROVED' && (
          <span className="text-[11px] text-ink-muted">by {effectiveApprovedBy}</span>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="expense-status-ribbon"
      className={cn('flex flex-col gap-2.5 w-full', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Expense Claim Lifecycle" className="w-full sm:w-auto">
          <ol className="flex items-center rounded-2xl border border-border bg-surface p-1 text-xs">
            {STEPS.map((step, idx) => {
              const state = getStepState(step.key);
              const isLast = idx === STEPS.length - 1;
              const timestamp = getStepTimestamp(step.key);
              const StepIcon = step.icon;

              return (
                <li
                  key={step.key}
                  data-testid={`ribbon-step-${step.key.toLowerCase()}`}
                  className="flex items-center"
                >
                  <div
                    className={cn(
                      'flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-all text-xs',
                      state === 'current' && 'bg-charcoal text-on-charcoal font-semibold',
                      state === 'completed' &&
                        'text-ink-muted font-medium hover:text-ink',
                      state === 'upcoming' && 'text-ink-subtle',
                      state === 'rejected' &&
                        'bg-danger-soft text-danger font-semibold border border-danger/20',
                    )}
                  >
                    <StepIcon
                      className={cn(
                        'size-3.5 shrink-0',
                        state === 'completed' && 'text-success stroke-[2.2]',
                        state === 'current' && 'text-on-charcoal stroke-[2.2]',
                        state === 'rejected' && 'text-danger',
                        state === 'upcoming' && 'text-ink-subtle',
                      )}
                    />

                    <div className="flex flex-col text-start">
                      <span className="hidden sm:inline whitespace-nowrap">{step.label}</span>
                      <span className="inline sm:hidden whitespace-nowrap">{step.shortLabel}</span>
                      {timestamp && state !== 'upcoming' && (
                        <span className="text-[11px] font-normal tabular-nums whitespace-nowrap">
                          {timestamp}
                        </span>
                      )}
                    </div>
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

        {/* Status Badge callout */}
        <div className="flex items-center gap-2">
          <ExpenseStatusBadge status={status} />
        </div>
      </div>

      {/* Additional context banner: Approval actor or Rejection reason */}
      {status === 'APPROVED' && (effectiveApprovedBy || effectiveApprovedAt) && (
        <div
          data-testid="approval-info-banner"
          className="flex items-center gap-2 rounded-xl border border-info/20 bg-info-soft px-3 py-2 text-xs text-ink"
        >
          <UserCheck className="size-4 text-info shrink-0" aria-hidden />
          <span>
            Approved by <strong className="font-semibold">{effectiveApprovedBy || 'Authorized Manager'}</strong>
            {effectiveApprovedAt && ` on ${formatStepDate(effectiveApprovedAt)}`}
          </span>
        </div>
      )}

      {status === 'PAID' && effectiveReimbursedAt && (
        <div
          data-testid="reimbursement-info-banner"
          className="flex items-center gap-2 rounded-xl border border-success/20 bg-success-soft px-3 py-2 text-xs text-ink"
        >
          <ShieldCheck className="size-4 text-success shrink-0" aria-hidden />
          <span>
            Reimbursed on <strong className="font-semibold">{formatStepDate(effectiveReimbursedAt)}</strong>
          </span>
        </div>
      )}

      {isRejected && (
        <div
          data-testid="rejection-info-banner"
          className="flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-xs text-ink"
        >
          <AlertTriangle className="size-4 text-danger shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1">
            <p className="font-semibold text-danger">Claim rejected</p>
            <p className="mt-0.5 text-ink">
              {effectiveRejectionReason || 'No reason was recorded.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
