'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Plus,
  Receipt,
  CheckCircle2,
  XCircle,
  DollarSign,
  Eye,
  FileEdit,
  ArrowUpDown,
  Building2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { EXPENSE_CATEGORY_GROUPS, PERMISSIONS } from '@saas/shared';
import type { ExpenseClaimDto, ExpenseStatus } from '@saas/shared';
import { cn } from '@/lib/utils';
import { Card, CardBody, CardHeader, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Can } from '@/components/auth/can';
import { ExpenseStatusBadge } from './expense-status-ribbon';
import { ReceiptPreviewCard } from './receipt-preview-card';
import { formatExpenseCurrency } from './expense-money';
import {
  ApproveClaimDialog,
  ReimburseClaimDialog,
  RejectClaimDialog,
} from './claim-action-dialogs';

export interface ExpenseClaimsTableProps {
  claims: ExpenseClaimDto[];
  isLoading?: boolean;
  onSelectClaim?: (claim: ExpenseClaimDto) => void;
  onApprove?: (claim: ExpenseClaimDto) => Promise<unknown> | void;
  onReject?: (claim: ExpenseClaimDto, reason: string) => Promise<unknown> | void;
  onReimburse?: (claim: ExpenseClaimDto) => Promise<unknown> | void;
  /** The account a reimbursement is paid from, named in its confirmation. */
  reimbursementAccountName?: string | null;
  onViewReceipt?: (claim: ExpenseClaimDto) => void;
  onNewClaim?: () => void;
  onEditClaim?: (claim: ExpenseClaimDto) => void;
  className?: string;
}

type StatusFilterTab = 'ALL' | ExpenseStatus;

const STATUS_TABS: { label: string; value: StatusFilterTab }[] = [
  { label: 'All Claims', value: 'ALL' },
  { label: 'Pending Review', value: 'SUBMITTED' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Drafts', value: 'DRAFT' },
  { label: 'Rejected', value: 'REJECTED' },
];

export function ExpenseClaimsTable({
  claims = [],
  isLoading = false,
  onSelectClaim,
  onApprove,
  onReject,
  onReimburse,
  reimbursementAccountName,
  onViewReceipt,
  onNewClaim,
  onEditClaim,
  className,
}: ExpenseClaimsTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilterTab>('ALL');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Modals state
  const [previewReceiptClaim, setPreviewReceiptClaim] = useState<ExpenseClaimDto | null>(null);
  // Each action with consequences waits for a confirmation naming the claim.
  const [approvingClaim, setApprovingClaim] = useState<ExpenseClaimDto | null>(null);
  const [rejectingClaim, setRejectingClaim] = useState<ExpenseClaimDto | null>(null);
  const [reimbursingClaim, setReimbursingClaim] = useState<ExpenseClaimDto | null>(null);

  // Sorting state
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'claimNumber'>('date');
  const [sortAsc, setSortAsc] = useState(false);

  // Filtered & Sorted Claims
  const filteredClaims = useMemo(() => {
    return claims.filter((claim) => {
      // Search term matching
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesQuery =
          claim.claimNumber?.toLowerCase().includes(query) ||
          claim.employeeName?.toLowerCase().includes(query) ||
          claim.merchantName?.toLowerCase().includes(query) ||
          claim.category?.toLowerCase().includes(query) ||
          claim.items?.some((i) => i.description.toLowerCase().includes(query));
        if (!matchesQuery) return false;
      }

      // Category matching
      if (categoryFilter !== 'ALL' && claim.category !== categoryFilter) {
        return false;
      }

      // Status matching
      if (statusFilter !== 'ALL' && claim.status !== statusFilter) {
        return false;
      }

      return true;
    }).sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'date') {
        const dateA = new Date(a.expenseDate || a.createdAt).getTime();
        const dateB = new Date(b.expenseDate || b.createdAt).getTime();
        comparison = dateA - dateB;
      } else if (sortBy === 'amount') {
        comparison = (a.amount || 0) - (b.amount || 0);
      } else if (sortBy === 'claimNumber') {
        comparison = (a.claimNumber || '').localeCompare(b.claimNumber || '');
      }
      return sortAsc ? comparison : -comparison;
    });
  }, [claims, searchTerm, categoryFilter, statusFilter, sortBy, sortAsc]);

  // Counts by status
  const counts = useMemo(() => {
    const map: Record<StatusFilterTab, number> = {
      ALL: claims.length,
      SUBMITTED: 0,
      APPROVED: 0,
      PAID: 0,
      DRAFT: 0,
      REJECTED: 0,
    };
    claims.forEach((c) => {
      if (map[c.status] !== undefined) {
        map[c.status]++;
      }
    });
    return map;
  }, [claims]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredClaims.length / pageSize) || 1;
  const paginatedClaims = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredClaims.slice(start, start + pageSize);
  }, [filteredClaims, currentPage, pageSize]);

  const handleViewReceiptClick = (claim: ExpenseClaimDto) => {
    if (onViewReceipt) {
      onViewReceipt(claim);
    } else {
      setPreviewReceiptClaim(claim);
    }
  };

  return (
    <div
      data-testid="expense-claims-table-container"
      className={cn('flex flex-col gap-4 w-full', className)}
    >
      {/* Main Table Card */}
      <Card>
        <CardHeader className="flex flex-col gap-3 p-4 border-b border-border">
          {/* Status Tabs */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <nav aria-label="Filter claims by status" className="flex flex-wrap gap-1.5">
              {STATUS_TABS.map((tab) => {
                const isActive = statusFilter === tab.value;
                const count = counts[tab.value];

                return (
                  <button
                    key={tab.value}
                    type="button"
                    data-testid={`status-tab-${tab.value.toLowerCase()}`}
                    aria-pressed={isActive}
                    onClick={() => {
                      setStatusFilter(tab.value);
                      setCurrentPage(1);
                    }}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors cursor-pointer',
                      isActive
                        ? 'bg-charcoal text-on-charcoal font-semibold'
                        : 'bg-surface-muted text-ink-muted hover:text-ink',
                    )}
                  >
                    <span>{tab.label}</span>
                    <span className="rounded-full bg-surface px-1.5 text-[11px] tabular-nums text-ink">
                      {count}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Search & Category Filter Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
            <div className="relative w-full sm:w-80">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-ink-subtle" aria-hidden />
              <input
                type="search"
                aria-label="Search claims"
                placeholder="Search claim #, merchant, employee..."
                data-testid="input-search-claims"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="h-10 w-full rounded-xl border border-border-control bg-surface ps-9 pe-3 text-sm text-ink placeholder:text-ink-subtle focus:outline-hidden focus:border-brand-ring focus:ring-1 focus:ring-brand-ring"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <label htmlFor="filter-category" className="flex items-center gap-1.5 text-xs text-ink-muted">
                <Filter className="size-3.5 text-ink-subtle" aria-hidden />
                <span>Category</span>
              </label>
              <select
                id="filter-category"
                data-testid="select-filter-category"
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="h-10 rounded-xl border border-border-control bg-surface px-3 text-sm text-ink focus:outline-hidden focus:border-brand-ring focus:ring-1 focus:ring-brand-ring"
              >
                <option value="ALL">All categories</option>
                {EXPENSE_CATEGORY_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>

        <CardBody className="p-0">
          {isLoading ? (
            <div data-testid="table-loading-skeleton" className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-4 py-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
              ))}
            </div>
          ) : paginatedClaims.length === 0 ? (
            <div
              data-testid="table-empty-state"
              className="flex flex-col items-center justify-center p-12 text-center"
            >
              <div className="rounded-2xl bg-surface-muted p-4 text-ink-subtle border border-border">
                <Receipt className="size-8 stroke-[1.5]" />
              </div>
              <h4 className="mt-3 text-sm font-semibold text-ink">No Expense Claims Found</h4>
              <p className="mt-1 text-xs text-ink-muted max-w-sm">
                {searchTerm || categoryFilter !== 'ALL' || statusFilter !== 'ALL'
                  ? 'No expense claims match your search filters. Try clearing or changing your filters.'
                  : 'No expense claims have been submitted yet. Submit a new expense claim to get started.'}
              </p>
              {/* Only when there are none at all: a filtered-out list needs its filters changed, not a new claim. */}
              {onNewClaim && claims.length === 0 && (
                <Can permission={PERMISSIONS.EXPENSE_SUBMIT}>
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="btn-empty-new-claim"
                    onClick={onNewClaim}
                    className="mt-4"
                  >
                    <Plus className="size-4" />
                    Submit expense claim
                  </Button>
                </Can>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table
                data-testid="expense-claims-table"
                className="w-full text-start text-xs text-ink divide-y divide-border"
              >
                <thead className="bg-surface-muted text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                  <tr>
                    <th
                      className="px-4 py-3 cursor-pointer select-none hover:text-ink"
                      onClick={() => {
                        setSortBy('claimNumber');
                        setSortAsc(!sortAsc);
                      }}
                    >
                      <div className="flex items-center gap-1">
                        <span>Claim #</span>
                        <ArrowUpDown className="size-3 text-ink-subtle" />
                      </div>
                    </th>
                    <th className="px-4 py-3">Submitter</th>
                    <th className="px-4 py-3">Merchant</th>
                    <th className="px-4 py-3">Category</th>
                    <th
                      className="px-4 py-3 cursor-pointer select-none hover:text-ink"
                      onClick={() => {
                        setSortBy('date');
                        setSortAsc(!sortAsc);
                      }}
                    >
                      <div className="flex items-center gap-1">
                        <span>Date</span>
                        <ArrowUpDown className="size-3 text-ink-subtle" />
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 cursor-pointer select-none hover:text-ink text-end"
                      onClick={() => {
                        setSortBy('amount');
                        setSortAsc(!sortAsc);
                      }}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Amount</span>
                        <ArrowUpDown className="size-3 text-ink-subtle" />
                      </div>
                    </th>
                    <th className="px-4 py-3 text-center">Receipt</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-end">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-border">
                  {paginatedClaims.map((claim) => {
                    const dateStr = claim.expenseDate
                      ? new Date(claim.expenseDate).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '—';

                    return (
                      <tr
                        key={claim.id}
                        data-testid={`claim-row-${claim.id}`}
                        className="transition-colors hover:bg-surface-muted"
                      >
                        {/* Claim Number */}
                        <td className="px-4 py-3 font-mono font-medium text-ink">
                          <button
                            type="button"
                            onClick={() => onSelectClaim?.(claim)}
                            className="font-medium text-ink underline-offset-2 hover:underline cursor-pointer text-start"
                          >
                            {claim.claimNumber || `#${claim.id.slice(0, 7)}`}
                          </button>
                        </td>

                        {/* Submitter */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div aria-hidden className="flex size-6 items-center justify-center rounded-full bg-surface-muted text-[11px] font-semibold text-ink-muted border border-border">
                              {(claim.employeeName || 'U').charAt(0).toUpperCase()}
                            </div>
                            <span className="font-medium text-ink truncate max-w-[120px]">
                              {claim.employeeName || 'Unknown'}
                            </span>
                          </div>
                        </td>

                        {/* Merchant */}
                        <td className="px-4 py-3 text-ink-muted">
                          <div className="flex items-center gap-1.5 truncate max-w-[140px]" title={claim.merchantName || '—'}>
                            <Building2 className="size-3 text-ink-subtle shrink-0" />
                            <span className="truncate text-ink font-medium">
                              {claim.merchantName || '—'}
                            </span>
                          </div>
                        </td>

                        {/* Category */}
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-lg bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-ink-muted border border-border">
                            {claim.category || 'General'}
                          </span>
                        </td>

                        {/* Date */}
                        <td className="px-4 py-3 text-ink-muted whitespace-nowrap tabular-nums">
                          {dateStr}
                        </td>

                        {/* Amount */}
                        <td className="px-4 py-3 text-end font-semibold tabular-nums text-ink whitespace-nowrap">
                          {formatExpenseCurrency(claim.amount, claim.currency)}
                        </td>

                        {/* Receipt Thumbnail / View Button */}
                        <td className="px-4 py-3 text-center">
                          {claim.receiptUrl ? (
                            <button
                              type="button"
                              onClick={() => handleViewReceiptClick(claim)}
                              aria-label={`View receipt for ${claim.claimNumber || claim.id}`}
                              data-testid={`btn-view-receipt-${claim.id}`}
                              title="View Zoomable Receipt"
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2 text-[11px] font-medium text-ink hover:bg-surface-muted transition-colors cursor-pointer"
                            >
                              <Receipt className="size-3 text-ink-muted" aria-hidden />
                              <span>Receipt</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-ink-subtle">—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <ExpenseStatusBadge status={claim.status} />
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 text-end">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Workflow Quick Action Buttons */}
                            <Can permission={PERMISSIONS.EXPENSE_APPROVE}>
                              {claim.status === 'SUBMITTED' && (
                                <>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setApprovingClaim(claim)}
                                    aria-label={`Approve claim ${claim.claimNumber || claim.id}`}
                                    data-testid={`btn-approve-claim-${claim.id}`}
                                  >
                                    <CheckCircle2 className="size-3.5" aria-hidden />
                                    Approve
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setRejectingClaim(claim)}
                                    aria-label={`Reject claim ${claim.claimNumber || claim.id}`}
                                    data-testid={`btn-reject-claim-${claim.id}`}
                                    className="text-danger hover:bg-danger-soft"
                                  >
                                    <XCircle className="size-3.5" aria-hidden />
                                    Reject
                                  </Button>
                                </>
                              )}

                              {claim.status === 'APPROVED' && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setReimbursingClaim(claim)}
                                  aria-label={`Reimburse claim ${claim.claimNumber || claim.id}`}
                                  data-testid={`btn-reimburse-claim-${claim.id}`}
                                >
                                  <DollarSign className="size-3.5" aria-hidden />
                                  Reimburse
                                </Button>
                              )}
                            </Can>

                            {(claim.status === 'DRAFT' || claim.status === 'REJECTED') && onEditClaim && (
                              <button
                                type="button"
                                onClick={() => onEditClaim(claim)}
                                aria-label={`Edit claim ${claim.claimNumber || claim.id}`}
                                data-testid={`btn-edit-claim-${claim.id}`}
                                title="Edit Claim"
                                className="grid size-8 place-items-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
                              >
                                <FileEdit className="size-3.5" />
                              </button>
                            )}

                            {onSelectClaim && (
                              <button
                                type="button"
                                onClick={() => onSelectClaim(claim)}
                                aria-label={`View claim ${claim.claimNumber || claim.id}`}
                                data-testid={`btn-view-claim-${claim.id}`}
                                title="View Details"
                                className="grid size-8 place-items-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
                              >
                                <Eye className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Toolbar */}
          {!isLoading && filteredClaims.length > 0 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-ink-muted bg-surface-muted tabular-nums">
              <div>
                Showing {(currentPage - 1) * pageSize + 1} to{' '}
                {Math.min(currentPage * pageSize, filteredClaims.length)} of {filteredClaims.length} claims
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={currentPage <= 1}
                  aria-label="Previous Page"
                  data-testid="btn-prev-page"
                  className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-ink-muted hover:text-ink disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="px-2 text-xs tabular-nums text-ink">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  disabled={currentPage >= totalPages}
                  aria-label="Next Page"
                  data-testid="btn-next-page"
                  className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-ink-muted hover:text-ink disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <ApproveClaimDialog
        claim={approvingClaim}
        onClose={() => setApprovingClaim(null)}
        onConfirm={(claim) => onApprove?.(claim)}
      />
      <RejectClaimDialog
        claim={rejectingClaim}
        onClose={() => setRejectingClaim(null)}
        onConfirm={(claim, reason) => onReject?.(claim, reason)}
      />
      <ReimburseClaimDialog
        claim={reimbursingClaim}
        onClose={() => setReimbursingClaim(null)}
        onConfirm={(claim) => onReimburse?.(claim)}
        accountName={reimbursementAccountName}
      />

      {/* Built-in Receipt Preview Dialog */}
      {previewReceiptClaim && (
        <Dialog
          open={Boolean(previewReceiptClaim)}
          onClose={() => setPreviewReceiptClaim(null)}
          title={`Receipt - ${previewReceiptClaim.claimNumber || previewReceiptClaim.id}`}
          size="lg"
        >
          <div className="p-1">
            <ReceiptPreviewCard
              receiptUrl={previewReceiptClaim.receiptUrl}
              merchantName={previewReceiptClaim.merchantName}
              amount={previewReceiptClaim.amount}
              currency={previewReceiptClaim.currency}
              expenseDate={previewReceiptClaim.expenseDate}
              category={previewReceiptClaim.category}
              claim={previewReceiptClaim}
            />
          </div>
        </Dialog>
      )}
    </div>
  );
}
