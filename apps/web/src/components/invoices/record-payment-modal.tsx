'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import type { FinanceAccountDto, InvoiceDto, RecordInvoicePaymentPayload } from '@saas/shared';
import { formatFinanceCurrency } from '../finance/dashboard/treasury-stat-cards';
import { formatAccountNumber } from '../finance/dashboard/account-balance-grid';

export interface RecordPaymentModalProps {
  open: boolean;
  onClose: () => void;
  invoice: InvoiceDto | null;
  accounts: FinanceAccountDto[];
  onSubmit: (payload: RecordInvoicePaymentPayload) => Promise<void> | void;
  isLoading?: boolean;
}

export function RecordPaymentModal({
  open,
  onClose,
  invoice,
  accounts,
  onSubmit,
  isLoading = false,
}: RecordPaymentModalProps) {
  const [accountId, setAccountId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [paidAt, setPaidAt] = useState<string>(new Date().toISOString().split('T')[0]);
  const [error, setError] = useState<string | null>(null);

  const remaining = invoice ? invoice.amount - (invoice.paidAmount ?? 0) : 0;

  // Resets the form fields each time the modal opens for a (possibly
  // different) invoice, mirroring `TransferFundsModal`'s reset-on-open effect.
  useEffect(() => {
    if (open && invoice) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAccountId(accounts[0]?.id || '');
      setAmount(String(invoice.amount - (invoice.paidAmount ?? 0)));
      setPaidAt(new Date().toISOString().split('T')[0]);
      setError(null);
    }
  }, [open, invoice, accounts]);

  if (!invoice) return null;

  const numericAmount = parseFloat(amount) || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!accountId) {
      setError(
        accounts.length === 0
          ? 'This organisation has no bank or cash account yet, so there is nowhere to deposit the money. Add one under Finance → Bank & Cash Accounts first.'
          : 'Please select an account to deposit the payment into.',
      );
      return;
    }
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError('Payment amount must be greater than $0.00.');
      return;
    }
    if (numericAmount > remaining + 0.01) {
      setError(`Payment cannot exceed the remaining balance of ${formatFinanceCurrency(remaining, invoice.currency)}.`);
      return;
    }

    try {
      await onSubmit({ accountId, amount: numericAmount, paidAt });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to record invoice payment.');
    }
  };

  const accountOptions = accounts.map((acc) => ({
    value: acc.id,
    label: `${acc.name} (${formatFinanceCurrency(acc.balance, acc.currency)}) - ${formatAccountNumber(acc.accountNumber)}`,
  }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Record Payment — Invoice ${invoice.invoiceNumber}`}
      description="Records a full or partial payment against a finance account and posts a journal entry."
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 rounded-xl border border-border/40 bg-surface-muted/40 p-3 text-xs">
          <div>
            <p className="text-ink-subtle">Total</p>
            <p className="font-mono font-semibold text-ink">
              {formatFinanceCurrency(invoice.amount, invoice.currency)}
            </p>
          </div>
          <div>
            <p className="text-ink-subtle">Already Paid</p>
            <p className="font-mono font-semibold text-ink">
              {formatFinanceCurrency(invoice.paidAmount ?? 0, invoice.currency)}
            </p>
          </div>
          <div>
            <p className="text-ink-subtle">Remaining</p>
            <p className="font-mono font-semibold text-ink">
              {formatFinanceCurrency(remaining, invoice.currency)}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="select-payment-account" className="block text-xs font-bold text-ink">
            Deposit Into
          </label>
          {accounts.length === 0 ? (
            /*
             * The dropdown used to render empty here and the form failed with
             * "Please select an account", naming a field that had nothing in
             * it. On a new tenant no cash account exists yet, so the first
             * payment anyone tries to record is a dead end until they find the
             * accounts page by exploring. Say what is missing, and link to it.
             */
            <div
              data-testid="record-payment-no-accounts"
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-xs text-ink"
            >
              <p className="font-semibold">No bank or cash account exists yet.</p>
              <p className="mt-1 text-ink-muted">
                A payment has to land somewhere the books can see. Add an account first, then
                come back to this invoice.
              </p>
              <Link
                href="/finance/accounts"
                className="mt-2 inline-flex items-center gap-1 font-semibold text-brand hover:underline"
              >
                Go to Finance &rarr; Bank &amp; Cash Accounts
                <ArrowRight className="size-3" />
              </Link>
            </div>
          ) : (
            <Select
              id="select-payment-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              options={accountOptions}
              placeholder="Select Account"
            />
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="input-payment-amount" className="block text-xs font-bold text-ink">
              Amount Paid ({invoice.currency})
            </label>
            <Input
              id="input-payment-amount"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="input-payment-date" className="block text-xs font-bold text-ink">
              Payment Date
            </label>
            <Input
              id="input-payment-date"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/25">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isLoading || accounts.length === 0}
          >
            {isLoading ? 'Recording...' : 'Record Payment'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
