'use client';

import React, { useState, useEffect } from 'react';
import {
  Landmark,
  Banknote,
  CreditCard,
  Layers,
  Star,
  CheckCircle2,
  AlertCircle,
  Shield,
  Wallet,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { CreateFinanceAccountPayload, AccountType } from '@saas/shared';
import { getAccountTypeMetadata, formatAccountNumber } from '../dashboard/account-balance-grid';
import { formatFinanceCurrency } from '../dashboard/treasury-stat-cards';

export interface CreateAccountModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateFinanceAccountPayload) => Promise<void> | void;
  isLoading?: boolean;
  initialData?: Partial<CreateFinanceAccountPayload>;
}

export const ACCOUNT_TYPE_OPTIONS: {
  value: AccountType;
  label: string;
  description: string;
  icon: typeof Landmark;
}[] = [
  {
    value: 'BANK',
    label: 'Corporate Bank Account',
    description: 'Checking, savings, or money market account with IBAN/routing number.',
    icon: Landmark,
  },
  {
    value: 'CASH',
    label: 'Petty Cash Reserve',
    description: 'Physical cash floats, office vault reserves, or on-hand cash registers.',
    icon: Banknote,
  },
  {
    value: 'CREDIT_CARD',
    label: 'Corporate Credit Card',
    description: 'Revolving credit facilities, corporate charge cards (Amex/Brex/Ramp).',
    icon: CreditCard,
  },
  {
    value: 'CLEARING',
    label: 'Clearing & Payment Gateway',
    description: 'Stripe, PayPal, Adyen merchant settlements, or transit escrow accounts.',
    icon: Layers,
  },
];

export const ACCOUNT_CURRENCIES = [
  { value: 'USD', label: 'USD ($) - US Dollar' },
  { value: 'EUR', label: 'EUR (€) - Euro' },
  { value: 'GBP', label: 'GBP (£) - British Pound' },
  { value: 'CAD', label: 'CAD ($) - Canadian Dollar' },
  { value: 'AUD', label: 'AUD ($) - Australian Dollar' },
  { value: 'SGD', label: 'SGD ($) - Singapore Dollar' },
  { value: 'JPY', label: 'JPY (¥) - Japanese Yen' },
  { value: 'CHF', label: 'CHF (Fr) - Swiss Franc' },
];

export function CreateAccountModal({
  open,
  onClose,
  onSubmit,
  isLoading = false,
  initialData,
}: CreateAccountModalProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [accountType, setAccountType] = useState<AccountType>(initialData?.accountType || 'BANK');
  const [currency, setCurrency] = useState(initialData?.currency || 'USD');
  const [balance, setBalance] = useState<string>(
    initialData?.balance !== undefined ? String(initialData.balance) : '0.00',
  );
  const [accountNumber, setAccountNumber] = useState(initialData?.accountNumber || '');
  const [isDefault, setIsDefault] = useState(Boolean(initialData?.isDefault));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initialData?.name || '');
      setAccountType(initialData?.accountType || 'BANK');
      setCurrency(initialData?.currency || 'USD');
      setBalance(initialData?.balance !== undefined ? String(initialData.balance) : '0.00');
      setAccountNumber(initialData?.accountNumber || '');
      setIsDefault(Boolean(initialData?.isDefault));
      setError(null);
    }
  }, [open, initialData]);

  const numericBalance = parseFloat(balance);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please provide a name for this account.');
      return;
    }

    if (isNaN(numericBalance)) {
      setError('Please provide a valid initial balance.');
      return;
    }

    try {
      await onSubmit({
        name: trimmedName,
        accountType,
        currency,
        balance: numericBalance,
        accountNumber: accountNumber.trim() || undefined,
        isDefault,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create financial account.');
    }
  };

  const meta = getAccountTypeMetadata(accountType);
  const SelectedIcon = meta.icon;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add Financial Account"
      description="Register a corporate bank, petty cash float, credit card, or clearing account."
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate data-testid="create-account-form" className="space-y-4">
        {error && (
          <div
            data-testid="account-form-error"
            className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400"
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Account Name */}
        <div>
          <label htmlFor="input-account-name" className="block text-xs font-bold text-ink">
            Account Name
          </label>
          <Input
            id="input-account-name"
            data-testid="input-account-name"
            placeholder="e.g. Silicon Valley Bank - Operating Checking"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>

        {/* Account Type Selector Grid */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-ink">Account Type</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ACCOUNT_TYPE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isSelected = accountType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-testid={`account-type-option-${opt.value}`}
                  onClick={() => setAccountType(opt.value)}
                  className={cn(
                    'flex flex-col items-center justify-center rounded-xl border p-3 text-center transition-all cursor-pointer',
                    isSelected
                      ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500 text-ink'
                      : 'border-border/40 bg-surface hover:bg-surface-muted text-ink-muted',
                  )}
                >
                  <Icon
                    className={cn(
                      'size-5',
                      isSelected ? 'text-amber-600 dark:text-amber-400' : 'text-ink-subtle',
                    )}
                  />
                  <span className="mt-1 text-[11px] font-bold tracking-tight">{opt.value}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Currency & Initial Balance */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="select-account-currency" className="block text-xs font-bold text-ink">
              Currency
            </label>
            <Select
              id="select-account-currency"
              data-testid="select-account-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              options={ACCOUNT_CURRENCIES}
            />
          </div>

          <div>
            <label htmlFor="input-initial-balance" className="block text-xs font-bold text-ink">
              Initial Balance
            </label>
            <Input
              id="input-initial-balance"
              data-testid="input-initial-balance"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Account Number / Masked Number */}
        <div>
          <label htmlFor="input-account-number" className="block text-xs font-bold text-ink">
            Account Number / Identifier (Optional)
          </label>
          <Input
            id="input-account-number"
            data-testid="input-account-number"
            placeholder="e.g. 4829384729 or last 4 digits"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-ink-subtle">
            Will be masked as {formatAccountNumber(accountNumber || '••••')} in public lists.
          </p>
        </div>

        {/* Default Account Checkbox */}
        <div className="flex items-center gap-2.5 rounded-xl border border-border/40 bg-surface-muted/30 p-3">
          <input
            id="input-is-default-account"
            data-testid="input-is-default-account"
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="size-4 rounded border-border text-amber-600 focus:ring-amber-500 cursor-pointer"
          />
          <label
            htmlFor="input-is-default-account"
            className="flex flex-col cursor-pointer select-none"
          >
            <span className="text-xs font-bold text-ink">Set as Default Operating Account</span>
            <span className="text-[11px] text-ink-subtle">
              Used as the primary source for expense disbursements and vendor subscription billings.
            </span>
          </label>
        </div>

        {/* Live Preview Card */}
        <div
          data-testid="account-preview-card"
          className="rounded-xl border border-border/30 bg-surface/90 p-3.5 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider text-ink-subtle">
              Live Card Preview
            </span>
            {isDefault && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                <Star className="size-2.5 fill-amber-500 text-amber-500" />
                Default
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn('grid size-8 place-items-center rounded-lg border', meta.colorClass)}>
                <SelectedIcon className="size-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-ink">{name || 'Account Name'}</p>
                <p className="font-mono text-[10px] text-ink-subtle">
                  {formatAccountNumber(accountNumber)} • {currency}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-bold text-sm text-ink tabular-nums">
                {formatFinanceCurrency(numericBalance || 0, currency)}
              </p>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/25">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="btn-cancel-account"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            data-testid="btn-submit-account"
            disabled={isLoading}
            className="font-semibold shadow-xs"
          >
            {isLoading ? 'Registering...' : 'Add Account'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
