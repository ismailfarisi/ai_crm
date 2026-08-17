'use client';

import React, { useState, useEffect } from 'react';
import {
  Layers,
  DollarSign,
  Calendar,
  Building2,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  CreditCard,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Badge } from '@/components/ui/primitives';
import type {
  CreateRecurringExpensePayload,
  FinanceAccountDto,
} from '@saas/shared';
import { formatFinanceCurrency } from '../dashboard/treasury-stat-cards';

export interface CreateSubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  accounts?: FinanceAccountDto[];
  onSubmit: (payload: CreateRecurringExpensePayload) => Promise<void> | void;
  isLoading?: boolean;
  initialData?: Partial<CreateRecurringExpensePayload>;
}

export const SUBSCRIPTION_CATEGORIES = [
  { value: 'Software & SaaS', label: 'Software & SaaS' },
  { value: 'Cloud Infrastructure', label: 'Cloud Infrastructure & Hosting' },
  { value: 'Marketing Tools', label: 'Marketing & SEO Tools' },
  { value: 'Security & Compliance', label: 'Security & Compliance' },
  { value: 'Communication & Collaboration', label: 'Communication & Collaboration' },
  { value: 'Customer Support', label: 'Customer Support Desk' },
  { value: 'Design & Creative', label: 'Design & Creative' },
  { value: 'Office Utilities', label: 'Office Utilities & Internet' },
  { value: 'Other', label: 'Other Recurring Bill' },
];

export const BILLING_INTERVALS: { value: 'MONTHLY' | 'ANNUAL'; label: string }[] = [
  { value: 'MONTHLY', label: 'Monthly Billing' },
  { value: 'ANNUAL', label: 'Annual Billing (Billed Yearly)' },
];

export function getDefaultNextBillingDate(): string {
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  return nextMonth.toISOString().split('T')[0];
}

export function CreateSubscriptionModal({
  open,
  onClose,
  accounts = [],
  onSubmit,
  isLoading = false,
  initialData,
}: CreateSubscriptionModalProps) {
  const [vendorName, setVendorName] = useState(initialData?.vendorName || '');
  const [category, setCategory] = useState(initialData?.category || 'Software & SaaS');
  const [amount, setAmount] = useState<string>(
    initialData?.amount !== undefined ? String(initialData.amount) : '',
  );
  const [billingInterval, setBillingInterval] = useState<'MONTHLY' | 'ANNUAL'>(
    initialData?.billingInterval || 'MONTHLY',
  );
  const [nextBillingDate, setNextBillingDate] = useState<string>(
    initialData?.nextBillingDate || getDefaultNextBillingDate(),
  );
  const [financeAccountId, setFinanceAccountId] = useState<string>(
    initialData?.financeAccountId || '',
  );
  const [status, setStatus] = useState<'ACTIVE' | 'PAUSED' | 'CANCELLED'>(
    initialData?.status || 'ACTIVE',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setVendorName(initialData?.vendorName || '');
      setCategory(initialData?.category || 'Software & SaaS');
      setAmount(initialData?.amount !== undefined ? String(initialData.amount) : '');
      setBillingInterval(initialData?.billingInterval || 'MONTHLY');
      setNextBillingDate(initialData?.nextBillingDate || getDefaultNextBillingDate());
      setFinanceAccountId(initialData?.financeAccountId || '');
      setStatus(initialData?.status || 'ACTIVE');
      setError(null);
    }
  }, [open, initialData]);

  const numericAmount = parseFloat(amount) || 0;
  const normalizedMonthly =
    billingInterval === 'ANNUAL' ? numericAmount / 12 : numericAmount;
  const projectedAnnual =
    billingInterval === 'MONTHLY' ? numericAmount * 12 : numericAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedVendor = vendorName.trim();
    if (!trimmedVendor) {
      setError('Please provide a vendor or service name.');
      return;
    }

    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError('Please provide a valid recurring billing amount greater than $0.00.');
      return;
    }

    if (!nextBillingDate) {
      setError('Please select a valid next renewal/billing date.');
      return;
    }

    try {
      await onSubmit({
        vendorName: trimmedVendor,
        category,
        amount: numericAmount,
        billingInterval,
        nextBillingDate,
        financeAccountId: financeAccountId || null,
        status,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to register subscription.');
    }
  };

  const accountOptions = [
    { value: '', label: 'Unassigned / Direct Invoice' },
    ...accounts.map((acc) => ({
      value: acc.id,
      label: `${acc.name} (${formatFinanceCurrency(acc.balance, acc.currency)})`,
    })),
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add Recurring Subscription"
      description="Register a SaaS vendor or recurring expense to forecast burn rate and monitor renewals."
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate data-testid="create-subscription-form" className="space-y-4">
        {error && (
          <div
            data-testid="subscription-form-error"
            className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400"
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Vendor Name */}
        <div>
          <label htmlFor="input-vendor-name" className="block text-xs font-bold text-ink">
            Vendor / Service Name
          </label>
          <Input
            id="input-vendor-name"
            data-testid="input-vendor-name"
            placeholder="e.g. AWS Cloud, GitHub, Slack, Figma"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            required
            autoFocus
          />
        </div>

        {/* Category & Interval */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="select-sub-category" className="block text-xs font-bold text-ink">
              Category
            </label>
            <Select
              id="select-sub-category"
              data-testid="select-sub-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={SUBSCRIPTION_CATEGORIES}
            />
          </div>

          <div>
            <label htmlFor="select-sub-interval" className="block text-xs font-bold text-ink">
              Billing Interval
            </label>
            <Select
              id="select-sub-interval"
              data-testid="select-sub-interval"
              value={billingInterval}
              onChange={(e) => setBillingInterval(e.target.value as 'MONTHLY' | 'ANNUAL')}
              options={BILLING_INTERVALS}
            />
          </div>
        </div>

        {/* Amount & Next Billing Date */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="input-sub-amount" className="block text-xs font-bold text-ink">
              Recurring Amount ($)
            </label>
            <Input
              id="input-sub-amount"
              data-testid="input-sub-amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="e.g. 49.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="input-sub-next-date" className="block text-xs font-bold text-ink">
              Next Renewal / Billing Date
            </label>
            <Input
              id="input-sub-next-date"
              data-testid="input-sub-next-date"
              type="date"
              value={nextBillingDate}
              onChange={(e) => setNextBillingDate(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Linked Finance Account */}
        <div>
          <label htmlFor="select-sub-account" className="block text-xs font-bold text-ink">
            Payment Account / Card
          </label>
          <Select
            id="select-sub-account"
            data-testid="select-sub-account"
            value={financeAccountId}
            onChange={(e) => setFinanceAccountId(e.target.value)}
            options={accountOptions}
          />
        </div>

        {/* Dynamic Cost Projection Card */}
        {numericAmount > 0 && (
          <div
            data-testid="subscription-cost-summary"
            className="rounded-xl border border-border/40 bg-surface-muted/40 p-3.5 space-y-2 text-xs"
          >
            <div className="flex items-center justify-between text-ink-muted">
              <span>Normalized Monthly Impact:</span>
              <strong
                data-testid="summary-monthly-cost"
                className="font-mono text-ink text-sm font-bold"
              >
                {formatFinanceCurrency(normalizedMonthly)} / mo
              </strong>
            </div>
            <div className="flex items-center justify-between text-ink-subtle text-[11px] pt-1 border-t border-border/20">
              <span>Projected Annual Expenditure:</span>
              <span
                data-testid="summary-annual-cost"
                className="font-mono font-medium text-ink"
              >
                {formatFinanceCurrency(projectedAnnual)} / yr
              </span>
            </div>
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/25">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="btn-cancel-subscription"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            data-testid="btn-submit-subscription"
            disabled={isLoading}
            className="font-semibold shadow-xs"
          >
            {isLoading ? 'Registering...' : 'Add Subscription'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
