'use client';

import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  ArrowLeftRight,
  Landmark,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  FileText,
  Calendar,
  Layers,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { FinanceAccountDto, TransferFundsPayload } from '@saas/shared';
import { formatFinanceCurrency } from '../dashboard/treasury-stat-cards';
import { formatAccountNumber } from '../dashboard/account-balance-grid';

export interface TransferFundsModalProps {
  open: boolean;
  onClose: () => void;
  accounts: FinanceAccountDto[];
  defaultFromAccountId?: string;
  defaultToAccountId?: string;
  onSubmit: (payload: TransferFundsPayload) => Promise<void> | void;
  isLoading?: boolean;
}

export function TransferFundsModal({
  open,
  onClose,
  accounts = [],
  defaultFromAccountId,
  defaultToAccountId,
  onSubmit,
  isLoading = false,
}: TransferFundsModalProps) {
  const initialFrom = defaultFromAccountId || (accounts.length > 0 ? accounts[0].id : '');
  const initialTo =
    defaultToAccountId ||
    (accounts.length > 1
      ? accounts.find((a) => a.id !== initialFrom)?.id || ''
      : '');

  const [fromAccountId, setFromAccountId] = useState<string>(initialFrom);
  const [toAccountId, setToAccountId] = useState<string>(initialTo);
  const [amount, setAmount] = useState<string>('');
  const [transferDate, setTransferDate] = useState<string>(
    new Date().toISOString().split('T')[0],
  );
  const [description, setDescription] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const from = defaultFromAccountId || (accounts.length > 0 ? accounts[0].id : '');
      const to =
        defaultToAccountId ||
        (accounts.length > 1
          ? accounts.find((a) => a.id !== from)?.id || ''
          : '');
      setFromAccountId(from);
      setToAccountId(to);
      setAmount('');
      setTransferDate(new Date().toISOString().split('T')[0]);
      setDescription('');
      setError(null);
    }
  }, [open, defaultFromAccountId, defaultToAccountId, accounts]);

  const fromAccount = accounts.find((a) => a.id === fromAccountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);

  const numericAmount = parseFloat(amount) || 0;
  const isSameAccount = Boolean(fromAccountId && toAccountId && fromAccountId === toAccountId);
  const sourceBalance = fromAccount?.balance ?? 0;
  const isOverdrawn = fromAccount ? numericAmount > sourceBalance : false;

  const handleQuickPercent = (percent: number) => {
    if (!fromAccount) return;
    const balance = Math.max(0, fromAccount.balance);
    const calculated = (balance * percent) / 100;
    setAmount(calculated.toFixed(2));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fromAccountId) {
      setError('Please select a source account.');
      return;
    }
    if (!toAccountId) {
      setError('Please select a destination account.');
      return;
    }
    if (fromAccountId === toAccountId) {
      setError('Source and destination accounts must be different.');
      return;
    }
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError('Transfer amount must be greater than $0.00.');
      return;
    }

    try {
      await onSubmit({
        fromAccountId,
        toAccountId,
        amount: numericAmount,
        description: description.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to complete funds transfer.');
    }
  };

  const fromAccountOptions = accounts.map((acc) => ({
    value: acc.id,
    label: `${acc.name} (${formatFinanceCurrency(acc.balance, acc.currency)}) - ${formatAccountNumber(acc.accountNumber)}`,
  }));

  const toAccountOptions = accounts.map((acc) => ({
    value: acc.id,
    label: `${acc.name} (${formatFinanceCurrency(acc.balance, acc.currency)}) - ${formatAccountNumber(acc.accountNumber)}`,
  }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Transfer Funds Between Accounts"
      description="Record an internal inter-account liquidity rebalance with automated double-entry ledger journals."
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate data-testid="transfer-funds-form" className="space-y-4">
        {error && (
          <div
            data-testid="transfer-form-error"
            className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400"
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {isSameAccount && (
          <div
            data-testid="same-account-warning"
            className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs font-semibold text-amber-700 dark:text-amber-300"
          >
            <AlertTriangle className="size-4 shrink-0" />
            <span>Cannot transfer to the same account. Please choose a different destination.</span>
          </div>
        )}

        {/* Source & Destination Account Selectors */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* From Account */}
          <div className="space-y-1.5">
            <label htmlFor="select-from-account" className="block text-xs font-bold text-ink">
              From Source Account
            </label>
            <Select
              id="select-from-account"
              data-testid="select-from-account"
              value={fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value)}
              options={fromAccountOptions}
              placeholder="Select Source Account"
            />
            {fromAccount && (
              <div className="flex items-center justify-between text-[11px] text-ink-subtle px-1">
                <span>Available:</span>
                <span
                  data-testid="from-account-balance"
                  className="font-mono font-bold text-ink"
                >
                  {formatFinanceCurrency(fromAccount.balance, fromAccount.currency)}
                </span>
              </div>
            )}
          </div>

          {/* To Account */}
          <div className="space-y-1.5">
            <label htmlFor="select-to-account" className="block text-xs font-bold text-ink">
              To Destination Account
            </label>
            <Select
              id="select-to-account"
              data-testid="select-to-account"
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
              options={toAccountOptions}
              placeholder="Select Destination Account"
            />
            {toAccount && (
              <div className="flex items-center justify-between text-[11px] text-ink-subtle px-1">
                <span>Current:</span>
                <span
                  data-testid="to-account-balance"
                  className="font-mono font-bold text-ink"
                >
                  {formatFinanceCurrency(toAccount.balance, toAccount.currency)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Amount & Quick Percentage Chips */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="input-transfer-amount" className="block text-xs font-bold text-ink">
              Transfer Amount ($)
            </label>
            {fromAccount && fromAccount.balance > 0 && (
              <div className="flex items-center gap-1.5">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    data-testid={`quick-amount-${pct}`}
                    onClick={() => handleQuickPercent(pct)}
                    className="rounded-md border border-border/40 bg-surface px-2 py-0.5 text-[10px] font-semibold text-ink-muted hover:border-amber-500 hover:text-amber-600 transition-colors cursor-pointer"
                  >
                    {pct === 100 ? 'Max' : `${pct}%`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Input
            id="input-transfer-amount"
            data-testid="input-transfer-amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />

          {isOverdrawn && (
            <p
              data-testid="overdrawn-notice"
              className="text-[11px] font-semibold text-amber-600 dark:text-amber-400"
            >
              Note: Transfer exceeds available source balance ($
              {sourceBalance.toFixed(2)}).
            </p>
          )}
        </div>

        {/* Date & Description */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="input-transfer-date" className="block text-xs font-bold text-ink">
              Transfer Date
            </label>
            <Input
              id="input-transfer-date"
              data-testid="input-transfer-date"
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="input-transfer-description" className="block text-xs font-bold text-ink">
              Memo / Notes
            </label>
            <Input
              id="input-transfer-description"
              data-testid="input-transfer-description"
              placeholder="e.g. Treasury rebalance"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {/* Live Double-Entry Journal Preview Card */}
        <div
          data-testid="journal-preview-card"
          className="rounded-xl border border-border/40 bg-surface-muted/40 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <BookOpen className="size-4 text-amber-600 dark:text-amber-400" />
              <h4 className="text-xs font-bold text-ink">Double-Entry Journal Preview</h4>
            </div>
            <span
              data-testid="journal-balanced-badge"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
              Balanced Entry
            </span>
          </div>

          {/* Ledger Table */}
          <div className="overflow-hidden rounded-lg border border-border/30 bg-surface text-xs">
            <div className="grid grid-cols-12 border-b border-border/30 bg-surface-muted/60 px-3 py-2 font-bold text-ink-subtle text-[11px]">
              <span className="col-span-6">Account Ledger</span>
              <span className="col-span-3 text-right">Debit (+)</span>
              <span className="col-span-3 text-right">Credit (-)</span>
            </div>

            {/* Debit Row (Destination Account) */}
            <div
              data-testid="journal-debit-row"
              className="grid grid-cols-12 items-center px-3 py-2 border-b border-border/20"
            >
              <div className="col-span-6 truncate font-medium text-ink">
                <span>{toAccount ? toAccount.name : 'Destination Account'}</span>
                <span className="ml-1 text-[10px] text-ink-subtle font-mono">(Asset +)</span>
              </div>
              <div className="col-span-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {numericAmount > 0 ? formatFinanceCurrency(numericAmount) : '$0.00'}
              </div>
              <div className="col-span-3 text-right font-mono text-ink-subtle">—</div>
            </div>

            {/* Credit Row (Source Account) */}
            <div
              data-testid="journal-credit-row"
              className="grid grid-cols-12 items-center px-3 py-2"
            >
              <div className="col-span-6 truncate font-medium text-ink pl-3">
                <span>{fromAccount ? fromAccount.name : 'Source Account'}</span>
                <span className="ml-1 text-[10px] text-ink-subtle font-mono">(Asset -)</span>
              </div>
              <div className="col-span-3 text-right font-mono text-ink-subtle">—</div>
              <div className="col-span-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                {numericAmount > 0 ? formatFinanceCurrency(numericAmount) : '$0.00'}
              </div>
            </div>
          </div>

          {/* Post-Transfer Projected Balances */}
          {fromAccount && toAccount && numericAmount > 0 && !isSameAccount && (
            <div
              data-testid="post-transfer-preview"
              className="flex items-center justify-between text-[11px] text-ink-muted pt-1 border-t border-border/20"
            >
              <span>
                Source new balance:{' '}
                <strong className="font-mono text-ink">
                  {formatFinanceCurrency(fromAccount.balance - numericAmount, fromAccount.currency)}
                </strong>
              </span>
              <span>
                Dest new balance:{' '}
                <strong className="font-mono text-ink">
                  {formatFinanceCurrency(toAccount.balance + numericAmount, toAccount.currency)}
                </strong>
              </span>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/25">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="btn-cancel-transfer"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            data-testid="btn-submit-transfer"
            disabled={isLoading || isSameAccount}
            className="font-semibold shadow-xs"
          >
            <ArrowLeftRight className="size-3.5 mr-1" />
            {isLoading ? 'Transferring...' : 'Execute Transfer'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
