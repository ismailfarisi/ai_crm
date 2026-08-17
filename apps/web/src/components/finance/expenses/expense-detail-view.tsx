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
  User,
  FileText,
  Clock,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  CreditCard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/field';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@/components/ui/primitives';
import { useExpense } from '@/hooks/use-expenses';
import { ExpenseStatusRibbon, ExpenseStatusBadge } from './expense-status-ribbon';
import { ReceiptPreviewCard, formatExpenseCurrency } from './receipt-preview-card';

export interface ExpenseDetailViewProps {
  id: string;
}

export function ExpenseDetailView({ id }: ExpenseDetailViewProps) {
  const router = useRouter();
  const {
    claim,
    isLoading,
    isError,
    signalClaim,
    isSignaling,
  } = useExpense(id);

  // Reject Dialog state
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

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
          <ArrowLeft className="size-3.5" />
          Back to Expenses
        </Link>
        <Card className="border-rose-500/20 bg-rose-500/5">
          <CardBody className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="size-10 text-rose-500" />
            <h3 className="mt-3 text-base font-bold text-ink">Expense Claim Not Found</h3>
            <p className="mt-1 max-w-sm text-xs text-ink-muted">
              The expense claim #{id} could not be located or you may not have permission to view it.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push('/finance/expenses')}
              className="mt-4 font-semibold"
            >
              Back to Claims List
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  const handleApprove = async () => {
    await signalClaim({ action: 'APPROVE' });
  };

  const handleRejectConfirm = async () => {
    await signalClaim({ action: 'REJECT', reason: rejectionReason || undefined });
    setIsRejectDialogOpen(false);
    setRejectionReason('');
  };

  const handleReimburse = async () => {
    await signalClaim({ action: 'REIMBURSE' });
  };

  return (
    <div data-testid="expense-detail-view" className="space-y-6">
      {/* Top Breadcrumb & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/finance/expenses"
          data-testid="back-to-expenses-link"
          className="group inline-flex items-center gap-2 text-xs font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          <span className="grid size-7 place-items-center rounded-lg border border-border/50 bg-surface-muted/60 transition-transform group-hover:-translate-x-0.5">
            <ArrowLeft className="size-3.5" />
          </span>
          <span>Back to Expenses</span>
        </Link>

        {/* Dynamic Action Buttons based on Workflow Status */}
        <div className="flex items-center gap-2">
          {claim.status === 'SUBMITTED' && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="detail-reject-btn"
                disabled={isSignaling}
                onClick={() => setIsRejectDialogOpen(true)}
                className="border-rose-500/30 text-rose-600 hover:bg-rose-50 hover:text-rose-700 font-semibold shadow-2xs dark:hover:bg-rose-950/30"
              >
                <XCircle className="size-3.5" />
                Reject Claim
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="detail-approve-btn"
                disabled={isSignaling}
                onClick={handleApprove}
                className="bg-emerald-600 text-white hover:bg-emerald-700 font-semibold shadow-xs"
              >
                <CheckCircle2 className="size-3.5" />
                Approve Claim
              </Button>
            </>
          )}

          {claim.status === 'APPROVED' && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="detail-reimburse-btn"
              disabled={isSignaling}
              onClick={handleReimburse}
              className="bg-emerald-600 text-white hover:bg-emerald-700 font-semibold shadow-xs"
            >
              <DollarSign className="size-3.5" />
              Mark as Reimbursed
            </Button>
          )}
        </div>
      </div>

      {/* Claim Banner & Main Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border/40 bg-surface/85 p-6 shadow-xs backdrop-blur-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h1
              data-testid="claim-number-title"
              className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl"
            >
              Expense Claim #{claim.claimNumber || claim.id.slice(0, 8)}
            </h1>
            <ExpenseStatusBadge status={claim.status} />
          </div>
          <p className="mt-1 text-xs text-ink-muted sm:text-sm">
            Submitted by <span className="font-semibold text-ink">{claim.employeeName || 'Staff'}</span> on{' '}
            {new Date(claim.createdAt).toLocaleDateString(undefined, {
              dateStyle: 'medium',
            })}
          </p>
        </div>

        <div className="text-right">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            Total Claim Amount
          </span>
          <div
            data-testid="claim-total-amount"
            className="text-2xl font-black tracking-tight text-ink tabular-nums sm:text-3xl"
          >
            {formatExpenseCurrency(claim.amount, claim.currency || 'USD')}
          </div>
        </div>
      </div>

      {/* Visual Workflow Progress Ribbon */}
      <ExpenseStatusRibbon
        status={claim.status}
        claim={claim}
        approvedAt={claim.approvedAt}
        approvedBy={claim.approvedById}
        reimbursedAt={claim.reimbursedAt}
        rejectionReason={claim.rejectionReason}
        createdAt={claim.createdAt}
      />

      {/* Two-Column Detail Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Claim Details & Items & Workflow */}
        <div className="space-y-6 lg:col-span-7">
          {/* Claim Metadata Card */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4 text-amber-500" />
                Claim Details
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <span className="text-[11px] font-semibold text-ink-subtle uppercase">Merchant / Vendor</span>
                  <div className="mt-1 flex items-center gap-1.5 font-medium text-ink">
                    <Building2 className="size-3.5 text-ink-subtle" />
                    <span>{claim.merchantName || 'Unspecified'}</span>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-ink-subtle uppercase">Category</span>
                  <div className="mt-1 flex items-center gap-1.5 font-medium text-ink">
                    <Tag className="size-3.5 text-ink-subtle" />
                    <span>{claim.category || 'General Expense'}</span>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-ink-subtle uppercase">Expense Incurred Date</span>
                  <div className="mt-1 flex items-center gap-1.5 font-medium text-ink">
                    <Calendar className="size-3.5 text-ink-subtle" />
                    <span>
                      {claim.expenseDate
                        ? new Date(claim.expenseDate).toLocaleDateString(undefined, { dateStyle: 'medium' })
                        : 'Not specified'}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-ink-subtle uppercase">Settlement Currency</span>
                  <div className="mt-1 flex items-center gap-1.5 font-medium text-ink font-mono">
                    <CreditCard className="size-3.5 text-ink-subtle font-sans" />
                    <span>{claim.currency || 'USD'}</span>
                  </div>
                </div>
              </div>

              {/* Description / Notes */}
              <div className="border-t border-border/30 pt-3">
                <span className="text-[11px] font-semibold text-ink-subtle uppercase">Business Justification</span>
                <p className="mt-1 text-xs text-ink-muted whitespace-pre-wrap bg-surface-muted/40 p-3 rounded-xl border border-border/40">
                  {claim.category ? `${claim.category} expense incurred by ${claim.employeeName || 'staff'}` : 'No justification notes provided.'}
                </p>
              </div>
            </CardBody>
          </Card>

          {/* Itemized Line Items (if present) */}
          {claim.items && claim.items.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tag className="size-4 text-amber-500" />
                  Itemized Line Items ({claim.items.length})
                </CardTitle>
              </CardHeader>
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border/30 bg-surface-muted/40 text-[11px] font-semibold text-ink-subtle uppercase">
                        <th className="py-2.5 px-4">Description</th>
                        <th className="py-2.5 px-4">Quantity</th>
                        <th className="py-2.5 px-4 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {claim.items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-surface-muted/20">
                          <td className="py-2.5 px-4 font-medium text-ink">{item.description}</td>
                          <td className="py-2.5 px-4 text-ink-muted tabular-nums">{item.quantity}</td>
                          <td className="py-2.5 px-4 text-right font-semibold text-ink tabular-nums">
                            {formatExpenseCurrency(item.amount, claim.currency || 'USD')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Audit / Workflow Event Log */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-amber-500" />
                Audit & Signoff History
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-border/20 pb-2">
                <span className="text-ink-muted">Submission</span>
                <span className="font-medium text-ink">
                  {new Date(claim.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>

              {claim.approvedAt && (
                <div className="flex items-center justify-between border-b border-border/20 pb-2">
                  <span className="text-ink-muted">Approved By</span>
                  <span className="font-medium text-ink">
                    {claim.approvedById || 'Finance Lead'} ({new Date(claim.approvedAt).toLocaleDateString()})
                  </span>
                </div>
              )}

              {claim.reimbursedAt && (
                <div className="flex items-center justify-between border-b border-border/20 pb-2">
                  <span className="text-ink-muted">Reimbursement Disbursed</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {new Date(claim.reimbursedAt).toLocaleDateString()}
                  </span>
                </div>
              )}

              {claim.rejectionReason && (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-rose-600 dark:text-rose-400">
                  <span className="font-bold">Rejection Reason:</span> {claim.rejectionReason}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right Column: Scanned Receipt Preview */}
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

      {/* Reject Reason Dialog */}
      <Dialog
        open={isRejectDialogOpen}
        onClose={() => setIsRejectDialogOpen(false)}
        title="Reject Expense Claim"
        description={`Provide a reason for rejecting claim #${claim.claimNumber || claim.id.slice(0, 8)}. The employee will be notified.`}
      >
        <div className="space-y-4 pt-2">
          <Textarea
            label="Rejection Reason"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="e.g. Missing detailed itemized invoice or non-compliant business expense policy."
            rows={4}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsRejectDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isSignaling}
              onClick={handleRejectConfirm}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              Confirm Rejection
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
