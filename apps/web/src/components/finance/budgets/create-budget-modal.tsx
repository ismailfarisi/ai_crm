'use client';

import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  Calendar,
  AlertTriangle,
  Layers,
  Sparkles,
  Percent,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Badge } from '@/components/ui/primitives';
import type { CreateCategoryBudgetPayload, BudgetPeriod } from '@saas/shared';

export interface CreateBudgetModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateCategoryBudgetPayload) => Promise<void> | void;
  isLoading?: boolean;
  initialData?: Partial<CreateCategoryBudgetPayload>;
}

export const BUDGET_CATEGORIES = [
  { value: 'Marketing', label: 'Marketing & Advertising' },
  { value: 'Software & SaaS', label: 'Software & SaaS' },
  { value: 'Travel & Lodging', label: 'Travel & Lodging' },
  { value: 'Office Supplies', label: 'Office Supplies' },
  { value: 'Payroll & Contractors', label: 'Payroll & Contractors' },
  { value: 'Professional Services', label: 'Professional Services' },
  { value: 'Hardware & Equipment', label: 'Hardware & Equipment' },
  { value: 'Utilities & Telecom', label: 'Utilities & Telecom' },
  { value: 'Other', label: 'Other' },
];

export const BUDGET_PERIOD_OPTIONS: { value: BudgetPeriod; label: string }[] = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'ANNUAL', label: 'Annual' },
];

export function getDefaultDatesForPeriod(period: BudgetPeriod, referenceDate: Date = new Date()) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth(); // 0-indexed

  if (period === 'MONTHLY') {
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 0));
    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
    };
  }

  if (period === 'QUARTERLY') {
    const qIndex = Math.floor(month / 3);
    const start = new Date(Date.UTC(year, qIndex * 3, 1));
    const end = new Date(Date.UTC(year, (qIndex + 1) * 3, 0));
    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
    };
  }

  // ANNUAL
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

export function CreateBudgetModal({
  open,
  onClose,
  onSubmit,
  isLoading = false,
  initialData,
}: CreateBudgetModalProps) {
  const initialPeriod = initialData?.period || 'MONTHLY';
  const defaultDates = getDefaultDatesForPeriod(initialPeriod);

  const [category, setCategory] = useState<string>(initialData?.category || 'Marketing');
  const [customCategory, setCustomCategory] = useState<string>('');
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [period, setPeriod] = useState<BudgetPeriod>(initialPeriod);
  const [budgetAmount, setBudgetAmount] = useState<string>(
    initialData?.budgetAmount !== undefined ? String(initialData.budgetAmount) : '',
  );
  const [spentAmount, setSpentAmount] = useState<string>(
    initialData?.spentAmount !== undefined ? String(initialData.spentAmount) : '0',
  );
  const [alertThresholdPercent, setAlertThresholdPercent] = useState<number>(
    initialData?.alertThresholdPercent !== undefined ? initialData.alertThresholdPercent : 85,
  );
  const [startDate, setStartDate] = useState<string>(initialData?.startDate || defaultDates.startDate);
  const [endDate, setEndDate] = useState<string>(initialData?.endDate || defaultDates.endDate);
  const [error, setError] = useState<string | null>(null);

  // Sync with initialData or period changes
  useEffect(() => {
    if (open) {
      const p = initialData?.period || 'MONTHLY';
      const d = getDefaultDatesForPeriod(p);
      setCategory(initialData?.category || 'Marketing');
      setPeriod(p);
      setBudgetAmount(initialData?.budgetAmount !== undefined ? String(initialData.budgetAmount) : '');
      setSpentAmount(initialData?.spentAmount !== undefined ? String(initialData.spentAmount) : '0');
      setAlertThresholdPercent(initialData?.alertThresholdPercent !== undefined ? initialData.alertThresholdPercent : 85);
      setStartDate(initialData?.startDate || d.startDate);
      setEndDate(initialData?.endDate || d.endDate);
      setError(null);
      setIsCustomCategory(false);
      setCustomCategory('');
    }
  }, [open, initialData]);

  const handlePeriodChange = (newPeriod: BudgetPeriod) => {
    setPeriod(newPeriod);
    const d = getDefaultDatesForPeriod(newPeriod);
    setStartDate(d.startDate);
    setEndDate(d.endDate);
  };

  const numericBudget = parseFloat(budgetAmount);
  const numericSpent = parseFloat(spentAmount) || 0;
  const thresholdValue = !isNaN(numericBudget) && numericBudget > 0
    ? (numericBudget * alertThresholdPercent) / 100
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const chosenCategory = isCustomCategory ? customCategory.trim() : category;

    if (!chosenCategory) {
      setError('Please select or specify a category.');
      return;
    }

    if (isNaN(numericBudget) || numericBudget <= 0) {
      setError('Please enter a valid budget amount greater than $0.');
      return;
    }

    if (!startDate || !endDate) {
      setError('Please provide valid start and end dates.');
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      setError('Start date cannot be after end date.');
      return;
    }

    if (alertThresholdPercent < 1 || alertThresholdPercent > 100) {
      setError('Alert threshold must be between 1% and 100%.');
      return;
    }

    try {
      await onSubmit({
        category: chosenCategory,
        period,
        budgetAmount: numericBudget,
        spentAmount: numericSpent,
        alertThresholdPercent,
        startDate,
        endDate,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create budget cap.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create Category Budget Cap"
      description="Define departmental spending allocations and threshold alert triggers."
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate data-testid="create-budget-form" className="space-y-4">
        {error && (
          <div
            data-testid="budget-form-error"
            className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400"
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Category Picker */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-ink">Expense Category</label>
          <div className="space-y-2">
            <Select
              id="select-budget-category"
              data-testid="select-budget-category"
              value={isCustomCategory ? '__CUSTOM__' : category}
              onChange={(e) => {
                if (e.target.value === '__CUSTOM__') {
                  setIsCustomCategory(true);
                } else {
                  setIsCustomCategory(false);
                  setCategory(e.target.value);
                }
              }}
              options={[
                ...BUDGET_CATEGORIES,
                { value: '__CUSTOM__', label: '+ Custom Category' },
              ]}
            />

            {isCustomCategory && (
              <Input
                id="input-custom-category"
                data-testid="input-custom-category"
                placeholder="Enter custom category name"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                required
              />
            )}
          </div>
        </div>

        {/* Period & Amount Row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-bold text-ink">Budget Period</label>
            <Select
              id="select-budget-period"
              data-testid="select-budget-period"
              value={period}
              onChange={(e) => handlePeriodChange(e.target.value as BudgetPeriod)}
              options={BUDGET_PERIOD_OPTIONS}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink">Budget Cap Amount ($)</label>
            <div className="relative">
              <Input
                id="input-budget-amount"
                data-testid="input-budget-amount"
                type="number"
                step="0.01"
                min="1"
                placeholder="e.g. 5000.00"
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
                required
              />
            </div>
          </div>
        </div>

        {/* Alert Threshold Slider / Input */}
        <div className="rounded-xl border border-border/40 bg-surface-muted/30 p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />
              <label htmlFor="input-alert-threshold" className="text-xs font-bold text-ink">
                Alert Threshold Trigger
              </label>
            </div>
            <span
              data-testid="threshold-percent-display"
              className="rounded-md bg-amber-500/10 px-2 py-0.5 font-mono text-xs font-bold text-amber-700 dark:text-amber-300"
            >
              {alertThresholdPercent}%
            </span>
          </div>

          <div className="space-y-2">
            <input
              id="input-alert-threshold"
              data-testid="input-alert-threshold"
              type="range"
              min="50"
              max="100"
              step="5"
              value={alertThresholdPercent}
              onChange={(e) => setAlertThresholdPercent(parseInt(e.target.value, 10))}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-surface-muted accent-amber-500"
            />

            <div className="flex items-center justify-between text-[11px] text-ink-subtle">
              <span>50%</span>
              <div className="flex gap-2">
                {[75, 85, 90, 95].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    data-testid={`preset-threshold-${preset}`}
                    onClick={() => setAlertThresholdPercent(preset)}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors cursor-pointer ${
                      alertThresholdPercent === preset
                        ? 'bg-amber-500 text-white dark:bg-amber-600'
                        : 'bg-surface hover:bg-surface-muted text-ink-muted'
                    }`}
                  >
                    {preset}%
                  </button>
                ))}
              </div>
              <span>100%</span>
            </div>
          </div>

          {numericBudget > 0 && (
            <div
              data-testid="threshold-preview-summary"
              className="flex items-center gap-2 text-[11px] text-ink-muted font-medium pt-1 border-t border-border/20"
            >
              <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                Early warning trigger at{' '}
                <strong className="text-ink">
                  ${thresholdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>{' '}
                spending.
              </span>
            </div>
          )}
        </div>

        {/* Date Range Row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="input-budget-start-date" className="block text-xs font-bold text-ink">
              Start Date
            </label>
            <Input
              id="input-budget-start-date"
              data-testid="input-budget-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="input-budget-end-date" className="block text-xs font-bold text-ink">
              End Date
            </label>
            <Input
              id="input-budget-end-date"
              data-testid="input-budget-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/25">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="btn-cancel-budget"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            data-testid="btn-submit-budget"
            disabled={isLoading}
            className="font-semibold shadow-xs"
          >
            {isLoading ? 'Creating...' : 'Create Budget Cap'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
