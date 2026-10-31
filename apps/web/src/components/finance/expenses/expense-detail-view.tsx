'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  DollarSign,
  Calendar,
  Building2,
  Tag,
  FileText,
  ShieldCheck,
  AlertCircle,
  CreditCard,
} from 'lucide-react';
import { PERMISSIONS } from '@saas/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@/components/ui/primitives';
import { useExpense } from '@/hooks/use-expenses';
import { useFinanceAccounts } from '@/hooks/use-finance';
import { Can } from '@/components/auth/can';
import { AttachmentsPanel } from '@/components/platform/attachments-panel';
import { ActivityTimeline } from '@/components/platform/activity-timeline';
import { ExpenseStatusRibbon, ExpenseStatusBadge } from './expense-status-ribbon';
import { ReceiptPreviewCard } from './receipt-preview-card';
import { formatExpenseCurrency, reimbursementAccount } from './expense-money';
import {
  ApproveClaimDialog,
  ReimburseClaimDialog,
  RejectClaimDialog,
} from './claim-action-dialogs';

export interface ExpenseDetailViewProps {
  id: string;
}

type PendingAction = 'approve' | 'reject' | 'reimburse' | null;

export function ExpenseDetailView({ id }: ExpenseDetailViewProps) {
  const router = useRouter();
  const { claim, isLoading, isError, signalClaim, isSignaling } = useExpense(id);
  const payFrom = reimbursementAccount(useFinanceAccounts().data);

  // Approving, rejecting and paying all wait for a confirmation.
  const [pending, setPending] = useState<PendingAction>(null);

  if (isLoading) {
    return (
      <div data-testid="expense-detail-loading" className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-24 rounded-xl" />
          <Skeleton className="h-9 w-48 rounded-xl" />
        </div>
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-48 w-full rounded-2xl" />
          </div>
          <div className="lg:col-span-5">
            <Skeleton className="h-96 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !claim) {
    return (
      <div data-testid="expense-detail-not-found" className="space-y-6">
        <Link
          href="/finance/expenses"
          className="inline-flex items-center gap-2 text-xs font-semibold text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to Expenses
        </Link>
        <Card>
          <CardBody className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="size-10 text-danger" aria-hidden />
            <h3 className="mt-3 text-sm font-semibold text-ink">Expense claim not found</h3>
            <p className="mt-1 max-w-sm text-xs text-ink-muted">
              Claim #{id} could not be found, or you do not have access to it.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/finance/expenses')}
              className="mt-4"
            >
              Back to claims
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  const notes = claim.notes?.trim();

  return (
    <div data-testid="expense-detail-view" className="space-y-6">
      {/* Breadcrumb and the actions the claim's status allows */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/finance/expenses"
          data-testid="back-to-expenses-link"
          className="group inline-flex items-center gap-2 text-xs font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          <span className="grid size-7 place-items-center rounded-lg border border-border bg-surface-muted transition-transform group-hover:-translate-x-0.5">
            <ArrowLeft className="size-3.5" aria-hidden />
          </span>
          <span>Back to Expenses</span>
        </Link>

        <Can permission={PERMISSIONS.EXPENSE_APPROVE}>
          <div className="flex flex-wrap items-center gap-2">
            {claim.status === 'SUBMITTED' && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="detail-reject-btn"
                  disabled={isSignaling}
                  onClick={() => setPending('reject')}
                  className="text-danger hover:bg-danger-soft"
                >
                  <XCircle className="size-4" aria-hidden />
                  Reject claim
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  data-testid="detail-approve-btn"
                  disabled={isSignaling}
                  onClick={() => setPending('approve')}
                >
                  <CheckCircle2 className="size-4" aria-hidden />
                  Approve claim
                </Button>
              </>
            )}

            {claim.status === 'APPROVED' && (
              <Button
                type="button"
                variant="primary"
                data-testid="detail-reimburse-btn"
                disabled={isSignaling}
                onClick={() => setPending('reimburse')}
              >
                <DollarSign className="size-4" aria-hidden />
                Reimburse claim
              </Button>
            )}
          </div>
        </Can>
      </div>

      {/* Claim header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-surface p-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 data-testid="claim-number-title" className="text-2xl font-bold tracking-tight text-ink">
              Expense Claim #{claim.claimNumber || claim.id.slice(0, 8)}
            </h1>
            <ExpenseStatusBadge status={claim.status} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            Submitted by <span className="font-semibold text-ink">{claim.employeeName || 'Staff'}</span> on{' '}
            <span className="tabular-nums">
              {new Date(claim.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </span>
          </p>
        </div>

        <div className="text-end">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Claim total</span>
          <div data-testid="claim-total-amount" className="text-2xl font-bold tracking-tight text-ink tabular-nums">
            {formatExpenseCurrency(claim.amount, claim.currency)}
          </div>
        </div>
      </div>

      <ExpenseStatusRibbon
        status={claim.status}
        claim={claim}
        approvedAt={claim.approvedAt}
        approvedBy={claim.approvedById}
        reimbursedAt={claim.reimbursedAt}
        rejectionReason={claim.rejectionReason}
        createdAt={claim.createdAt}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4 text-ink-subtle" aria-hidden />
                Claim Details
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <span className="text-[11px] font-semibold text-ink-subtle uppercase">Merchant / Vendor</span>
                  <div className="mt-1 flex items-center gap-1.5 font-medium text-ink">
                    <Building2 className="size-3.5 text-ink-subtle" aria-hidden />
                    <span>{claim.merchantName || 'Not given'}</span>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-ink-subtle uppercase">Category</span>
                  <div className="mt-1 flex items-center gap-1.5 font-medium text-ink">
                    <Tag className="size-3.5 text-ink-subtle" aria-hidden />
                    <span>{claim.category || 'General Expense'}</span>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-ink-subtle uppercase">Date spent</span>
                  <div className="mt-1 flex items-center gap-1.5 font-medium tabular-nums text-ink">
                    <Calendar className="size-3.5 text-ink-subtle" aria-hidden />
                    <span>
                      {claim.expenseDate
                        ? new Date(claim.expenseDate).toLocaleDateString(undefined, { dateStyle: 'medium' })
                        : 'Not given'}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-ink-subtle uppercase">Currency</span>
                  <div className="mt-1 flex items-center gap-1.5 font-medium text-ink">
                    <CreditCard className="size-3.5 text-ink-subtle" aria-hidden />
                    <span>{claim.currency || 'Not given'}</span>
                  </div>
                </div>
              </div>

              {/* What the claimant wrote, never a sentence made up for them */}
              <div className="border-t border-border pt-3">
                <span className="text-[11px] font-semibold text-ink-subtle uppercase">Business purpose / notes</span>
                <p
                  data-testid="claim-notes"
                  className={
                    notes
                      ? 'mt-1 whitespace-pre-wrap rounded-xl border border-border bg-surface-muted p-3 text-sm text-ink'
                      : 'mt-1 text-sm text-ink-muted'
                  }
                >
                  {notes || 'None given'}
                </p>
              </div>
            </CardBody>
          </Card>

          {claim.items && claim.items.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tag className="size-4 text-ink-subtle" aria-hidden />
                  Line items ({claim.items.length})
                </CardTitle>
              </CardHeader>
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-start text-xs">
                    <thead>
                      <tr className="border-b border-border bg-surface-muted text-[11px] font-semibold text-ink-muted uppercase">
                        <th className="py-2.5 px-4 text-start">Description</th>
                        <th className="py-2.5 px-4 text-end">Quantity</th>
                        <th className="py-2.5 px-4 text-end">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {claim.items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-surface-muted">
                          <td className="py-2.5 px-4 font-medium text-ink">{item.description}</td>
                          <td className="py-2.5 px-4 text-end text-ink-muted tabular-nums">{item.quantity}</td>
                          <td className="py-2.5 px-4 text-end font-semibold text-ink tabular-nums">
                            {formatExpenseCurrency(item.amount, claim.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-ink-subtle" aria-hidden />
                Sign-off history
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-ink-muted">Submitted</span>
                <span className="font-medium tabular-nums text-ink">
                  {new Date(claim.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>

              {claim.approvedAt && (
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="text-ink-muted">Approved by</span>
                  <span className="font-medium tabular-nums text-ink">
                    {claim.approvedById || 'Finance Lead'} ({new Date(claim.approvedAt).toLocaleDateString()})
                  </span>
                </div>
              )}

              {claim.reimbursedAt && (
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="text-ink-muted">Reimbursed</span>
                  <span className="font-medium tabular-nums text-success">
                    {new Date(claim.reimbursedAt).toLocaleDateString()}
                  </span>
                </div>
              )}

              {claim.rejectionReason && (
                <div className="rounded-xl border border-danger/20 bg-danger-soft p-3 text-ink">
                  <span className="font-semibold text-danger">Rejection reason:</span> {claim.rejectionReason}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-5">
          <ReceiptPreviewCard
            receiptUrl={claim.receiptUrl}
            merchantName={claim.merchantName}
            amount={claim.amount}
            currency={claim.currency}
            expenseDate={claim.expenseDate}
            category={claim.category}
            claim={claim}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Can permission={PERMISSIONS.FINANCE_MANAGE}>
          {(allowed) => (
            <AttachmentsPanel ownerType="EXPENSE_CLAIM" ownerId={claim.id} canEdit={allowed} />
          )}
        </Can>
        <ActivityTimeline subjectType="EXPENSE_CLAIM" subjectId={claim.id} />
      </div>

      <ApproveClaimDialog
        claim={pending === 'approve' ? claim : null}
        onClose={() => setPending(null)}
        onConfirm={() => signalClaim({ action: 'APPROVE' })}
      />
      <RejectClaimDialog
        claim={pending === 'reject' ? claim : null}
        onClose={() => setPending(null)}
        onConfirm={(_, reason) => signalClaim({ action: 'REJECT', reason })}
      />
      <ReimburseClaimDialog
        claim={pending === 'reimburse' ? claim : null}
        onClose={() => setPending(null)}
        // The account named in the confirmation is the one paid from.
        onConfirm={() => signalClaim({ action: 'REIMBURSE', accountId: payFrom?.id })}
        accountName={payFrom?.name}
      />
    </div>
  );
}
