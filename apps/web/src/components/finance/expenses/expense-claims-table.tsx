'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Plus,
  Receipt,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  Eye,
  FileEdit,
  MoreHorizontal,
  ArrowUpDown,
  Building2,
  Calendar,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import type { ExpenseClaimDto, ExpenseStatus } from '@saas/shared';
import { cn } from '@/lib/utils';
import { Badge, Card, CardBody, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';
import { ExpenseStatusBadge } from './expense-status-ribbon';
import { ReceiptPreviewCard, formatExpenseCurrency } from './receipt-preview-card';
import { EXPENSE_CATEGORIES } from './submit-expense-modal';

export interface ExpenseClaimsTableProps {
  claims: ExpenseClaimDto[];
  isLoading?: boolean;
  onSelectClaim?: (claim: ExpenseClaimDto) => void;
  onApprove?: (claim: ExpenseClaimDto) => Promise<void> | void;
  onReject?: (claim: ExpenseClaimDto, reason?: string) => Promise<void> | void;
  onReimburse?: (claim: ExpenseClaimDto) => Promise<void> | void;
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
  const [rejectingClaim, setRejectingClaim] = useState<ExpenseClaimDto | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

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

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const totalAmount = claims.reduce((s, c) => s + (c.amount || 0), 0);
    const pendingReview = claims.filter((c) => c.status === 'SUBMITTED');
    const pendingAmount = pendingReview.reduce((s, c) => s + (c.amount || 0), 0);
    const paidAmount = claims
      .filter((c) => c.status === 'PAID')
      .reduce((s, c) => s + (c.amount || 0), 0);

    return {
      totalCount: claims.length,
      totalAmount,
      pendingCount: pendingReview.length,
      pendingAmount,
      paidAmount,
    };
  }, [claims]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredClaims.length / pageSize) || 1;
  const paginatedClaims = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredClaims.slice(start, start + pageSize);
  }, [filteredClaims, currentPage, pageSize]);

  // Handlers for quick actions
  const handleApprove = async (claim: ExpenseClaimDto) => {
    if (!onApprove) return;
    try {
      setActionLoadingId(claim.id);
      await onApprove(claim);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenReject = (claim: ExpenseClaimDto) => {
    setRejectingClaim(claim);
    setRejectionReason('');
  };

  const handleConfirmReject = async () => {
    if (!rejectingClaim || !onReject) return;
    try {
      setActionLoadingId(rejectingClaim.id);
      await onReject(rejectingClaim, rejectionReason);
      setRejectingClaim(null);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReimburse = async (claim: ExpenseClaimDto) => {
    if (!onReimburse) return;
    try {
      setActionLoadingId(claim.id);
      await onReimburse(claim);
    } finally {
      setActionLoadingId(null);
    }
  };

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
      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-border/30 bg-surface/80 p-3.5 shadow-xs">
          <p className="text-xs font-medium text-ink-muted">Total Expense Claims</p>
          <div className="mt-1 flex items-baseline justify-between">
            <span data-testid="kpi-total-claims" className="text-xl font-bold text-ink">
              {summaryMetrics.totalCount}
            </span>
            <span className="text-xs font-mono text-ink-muted">
              {formatExpenseCurrency(summaryMetrics.totalAmount)}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3.5 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Pending Review</p>
            <Clock className="size-3.5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span data-testid="kpi-pending-count" className="text-xl font-bold text-amber-900 dark:text-amber-100">
              {summaryMetrics.pendingCount}
            </span>
            <span className="text-xs font-mono font-semibold text-amber-700 dark:text-amber-300">
              {formatExpenseCurrency(summaryMetrics.pendingAmount)}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Reimbursed & Settled</p>
            <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span data-testid="kpi-paid-amount" className="text-xl font-bold text-emerald-900 dark:text-emerald-100">
              {formatExpenseCurrency(summaryMetrics.paidAmount)}
            </span>
            <Badge tone="success" className="text-[10px]">Settled</Badge>
          </div>
        </div>

        <div className="rounded-2xl border border-border/30 bg-surface/80 p-3.5 shadow-xs flex flex-col justify-between">
          <p className="text-xs font-medium text-ink-muted">Quick Actions</p>
          <div className="mt-1 flex items-center gap-2">
            {onNewClaim && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="btn-new-claim"
                onClick={onNewClaim}
                className="w-full gap-1.5 text-xs shadow-xs"
              >
                <Plus className="size-3.5" />
                Submit Claim
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <Card className="border border-border/40 bg-surface/90 shadow-xs">
        <CardHeader className="flex flex-col gap-3 p-4 border-b border-border/25">
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
                    onClick={() => {
                      setStatusFilter(tab.value);
                      setCurrentPage(1);
                    }}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer',
                      isActive
                        ? 'bg-brand text-ink font-semibold shadow-xs'
                        : 'bg-surface-muted/40 text-ink-muted hover:bg-surface-muted hover:text-ink',
                    )}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.2 text-[10px] font-mono',
                        isActive ? 'bg-ink/10 text-ink' : 'bg-surface text-ink-muted',
                      )}
                    >
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-subtle" />
              <input
                type="text"
                placeholder="Search claim #, merchant, employee..."
                data-testid="input-search-claims"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-xl border border-border/70 bg-surface pl-9 pr-3 py-1.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-hidden focus:border-brand"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                <Filter className="size-3.5 text-ink-subtle" />
                <span>Category:</span>
              </div>
              <select
                data-testid="select-filter-category"
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="rounded-xl border border-border/70 bg-surface px-2.5 py-1.5 text-xs text-ink focus:outline-hidden focus:border-brand"
              >
                <option value="ALL">All Categories</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
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
              <div className="rounded-2xl bg-surface-muted/50 p-4 text-ink-subtle border border-border/30">
                <Receipt className="size-8 stroke-[1.5]" />
              </div>
              <h4 className="mt-3 text-sm font-semibold text-ink">No Expense Claims Found</h4>
              <p className="mt-1 text-xs text-ink-muted max-w-sm">
                {searchTerm || categoryFilter !== 'ALL' || statusFilter !== 'ALL'
                  ? 'No expense claims match your search filters. Try clearing or changing your filters.'
                  : 'No expense claims have been submitted yet. Submit a new expense claim to get started.'}
              </p>
              {onNewClaim && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="btn-empty-new-claim"
                  onClick={onNewClaim}
                  className="mt-4 gap-1.5 text-xs"
                >
                  <Plus className="size-3.5" />
                  Submit New Claim
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table
                data-testid="expense-claims-table"
                className="w-full text-left text-xs text-ink divide-y divide-border/25"
              >
                <thead className="bg-surface-muted/30 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
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
                      className="px-4 py-3 cursor-pointer select-none hover:text-ink text-right"
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
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-border/20 bg-surface/50">
                  {paginatedClaims.map((claim) => {
                    const isActionLoading = actionLoadingId === claim.id;
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
                        className="transition-colors hover:bg-surface-muted/30 group"
                      >
                        {/* Claim Number */}
                        <td className="px-4 py-3 font-mono font-medium text-ink">
                          <button
                            type="button"
                            onClick={() => onSelectClaim?.(claim)}
                            className="hover:text-brand hover:underline cursor-pointer text-left"
                          >
                            {claim.claimNumber || `#${claim.id.slice(0, 7)}`}
                          </button>
                        </td>

                        {/* Submitter */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex size-6 items-center justify-center rounded-full bg-brand-soft/80 text-[10px] font-bold text-ink border border-brand/20">
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
                          <span className="inline-flex rounded-lg bg-surface-muted/60 px-2 py-0.5 text-[11px] font-medium text-ink-muted border border-border/30">
                            {claim.category || 'General'}
                          </span>
                        </td>

                        {/* Date */}
                        <td className="px-4 py-3 text-ink-muted whitespace-nowrap">
                          {dateStr}
                        </td>

                        {/* Amount */}
                        <td className="px-4 py-3 text-right font-mono font-semibold text-ink whitespace-nowrap">
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
                              className="inline-flex items-center gap-1 rounded-lg border border-brand/30 bg-brand-soft/50 px-2 py-1 text-[11px] font-medium text-ink hover:bg-brand-soft transition-colors cursor-pointer"
                            >
                              <Receipt className="size-3 text-brand" />
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
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Workflow Quick Action Buttons */}
                            {claim.status === 'SUBMITTED' && (
                              <>
                                <button
                                  type="button"
                                  disabled={isActionLoading}
                                  onClick={() => handleApprove(claim)}
                                  aria-label={`Approve claim ${claim.claimNumber || claim.id}`}
                                  data-testid={`btn-approve-claim-${claim.id}`}
                                  title="Approve Claim"
                                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                                >
                                  <CheckCircle2 className="size-3 text-emerald-600" />
                                  <span>Approve</span>
                                </button>

                                <button
                                  type="button"
                                  disabled={isActionLoading}
                                  onClick={() => handleOpenReject(claim)}
                                  aria-label={`Reject claim ${claim.claimNumber || claim.id}`}
                                  data-testid={`btn-reject-claim-${claim.id}`}
                                  title="Reject Claim"
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer"
                                >
                                  <XCircle className="size-3 text-rose-600" />
                                  <span>Reject</span>
                                </button>
                              </>
                            )}

                            {claim.status === 'APPROVED' && (
                              <button
                                type="button"
                                disabled={isActionLoading}
                                onClick={() => handleReimburse(claim)}
                                aria-label={`Reimburse claim ${claim.claimNumber || claim.id}`}
                                data-testid={`btn-reimburse-claim-${claim.id}`}
                                title="Disburse Reimbursement"
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                              >
                                <DollarSign className="size-3 text-emerald-600" />
                                <span>Reimburse</span>
                              </button>
                            )}

                            {(claim.status === 'DRAFT' || claim.status === 'REJECTED') && onEditClaim && (
                              <button
                                type="button"
                                onClick={() => onEditClaim(claim)}
                                aria-label={`Edit claim ${claim.claimNumber || claim.id}`}
                                data-testid={`btn-edit-claim-${claim.id}`}
                                title="Edit Claim"
                                className="rounded-lg p-1 text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
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
                                className="rounded-lg p-1 text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
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
            <div className="flex items-center justify-between border-t border-border/25 px-4 py-3 text-xs text-ink-muted bg-surface-muted/20">
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
                  className="rounded-lg border border-border/40 p-1.5 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="px-2 text-xs font-mono text-ink">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  disabled={currentPage >= totalPages}
                  aria-label="Next Page"
                  data-testid="btn-next-page"
                  className="rounded-lg border border-border/40 p-1.5 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Reject Confirmation Dialog */}
      {rejectingClaim && (
        <Dialog
          open={Boolean(rejectingClaim)}
          onClose={() => setRejectingClaim(null)}
          title={`Reject Expense Claim #${rejectingClaim.claimNumber || rejectingClaim.id.slice(0, 7)}`}
          description="Provide a reason for rejection so the employee can review and adjust."
          size="md"
        >
          <div className="space-y-4 pt-1">
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-800 dark:text-rose-300">
              Claim Amount:{' '}
              <strong className="font-semibold">
                {formatExpenseCurrency(rejectingClaim.amount, rejectingClaim.currency)}
              </strong>{' '}
              for <strong>{rejectingClaim.merchantName || 'Expenses'}</strong>
            </div>

            <Textarea
              label="Rejection Reason"
              required
              data-testid="input-rejection-reason"
              placeholder="e.g. Missing detailed itemized invoice, or exceeds meal policy limit..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />

            <div className="flex justify-end gap-2 pt-2 border-t border-border/20">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRejectingClaim(null)}
                data-testid="btn-cancel-reject"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                data-testid="btn-confirm-reject"
                onClick={handleConfirmReject}
              >
                Confirm Rejection
              </Button>
            </div>
          </div>
        </Dialog>
      )}

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
