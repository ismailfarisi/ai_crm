'use client';

import React from 'react';
import {
  Landmark,
  Banknote,
  CreditCard,
  Layers,
  ArrowLeftRight,
  Plus,
  Star,
  CheckCircle2,
  ExternalLink,
  Shield,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import type { FinanceAccountDto, AccountType } from '@saas/shared';
import { formatFinanceCurrency } from './treasury-stat-cards';

export interface AccountBalanceGridProps {
  accounts?: FinanceAccountDto[];
  isLoading?: boolean;
  onTransfer?: (fromAccountId?: string) => void;
  onNewAccount?: () => void;
  onSelectAccount?: (account: FinanceAccountDto) => void;
  title?: string;
  description?: string;
  className?: string;
}

export function getAccountTypeMetadata(accountType: AccountType) {
  switch (accountType) {
    case 'BANK':
      return {
        label: 'Bank Account',
        icon: Landmark,
        badgeTone: 'info' as const,
        colorClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
      };
    case 'CASH':
      return {
        label: 'Petty Cash',
        icon: Banknote,
        badgeTone: 'success' as const,
        colorClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      };
    case 'CREDIT_CARD':
      return {
        label: 'Credit Card',
        icon: CreditCard,
        badgeTone: 'warning' as const,
        colorClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      };
    case 'CLEARING':
      return {
        label: 'Clearing / Gateway',
        icon: Layers,
        badgeTone: 'brand' as const,
        colorClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
      };
    default:
      return {
        label: 'Account',
        icon: Wallet,
        badgeTone: 'neutral' as const,
        colorClass: 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-500/20',
      };
  }
}

export function formatAccountNumber(accNum?: string | null): string {
  if (!accNum) return '•••• ----';
  const clean = accNum.replace(/\s+/g, '');
  if (clean.length <= 4) return `•••• ${clean}`;
  return `•••• ${clean.slice(-4)}`;
}

export function AccountBalanceGrid({
  accounts = [],
  isLoading = false,
  onTransfer,
  onNewAccount,
  onSelectAccount,
  title = 'Treasury & Bank Accounts',
  description = 'Real-time balances across connected corporate banks, petty cash reserves, and clearing gateways.',
  className,
}: AccountBalanceGridProps) {
  if (isLoading) {
    return (
      <div data-testid="account-grid-loading" className={cn('space-y-4', className)}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-80" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-28 rounded-full" />
            <Skeleton className="h-9 w-32 rounded-full" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="flex flex-col justify-between rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs"
            >
              <div className="flex items-center justify-between">
                <Skeleton className="size-9 rounded-xl" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="mt-4 space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="account-balance-grid" className={cn('space-y-4', className)}>
      {/* Header Section */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Landmark className="size-4" />
            </span>
            <h2 className="text-lg font-bold tracking-tight text-ink sm:text-xl">{title}</h2>
          </div>
          {description && (
            <p className="mt-1 text-xs text-ink-muted sm:text-sm">{description}</p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {onTransfer && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="transfer-funds-btn"
              onClick={() => onTransfer()}
              className="font-semibold shadow-2xs"
            >
              <ArrowLeftRight className="size-3.5" />
              Transfer Funds
            </Button>
          )}
          {onNewAccount && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="new-account-btn"
              onClick={() => onNewAccount()}
              className="font-semibold shadow-xs"
            >
              <Plus className="size-3.5" />
              New Account
            </Button>
          )}
        </div>
      </div>

      {/* Grid or Empty State */}
      {accounts.length === 0 ? (
        <div
          data-testid="account-grid-empty"
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-surface/40 px-6 py-12 text-center"
        >
          <div className="grid size-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Landmark className="size-6" />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-ink">No bank accounts registered</h3>
          <p className="mt-1 max-w-sm text-xs text-ink-muted">
            Add checking, savings, petty cash, or clearing accounts to start tracking your treasury.
          </p>
          {onNewAccount && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => onNewAccount()}
              className="mt-4 font-semibold"
            >
              <Plus className="size-3.5" />
              Create First Account
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {accounts.map((account) => {
            const meta = getAccountTypeMetadata(account.accountType);
            const Icon = meta.icon;
            const isPositive = (account.balance ?? 0) >= 0;

            return (
              <div
                key={account.id}
                data-testid={`account-card-${account.id}`}
                onClick={() => onSelectAccount?.(account)}
                className={cn(
                  'group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs backdrop-blur-xs transition-all hover:border-border hover:shadow-sm',
                  onSelectAccount ? 'cursor-pointer' : '',
                )}
              >
                {/* Top Badge & Icon */}
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={cn(
                      'grid size-10 place-items-center rounded-xl border transition-transform group-hover:scale-105',
                      meta.colorClass,
                    )}
                  >
                    <Icon className="size-5" />
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {account.isDefault && (
                      <span
                        data-testid={`default-badge-${account.id}`}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                      >
                        <Star className="size-2.5 fill-amber-500 text-amber-500" />
                        Default
                      </span>
                    )}
                    <Badge tone={meta.badgeTone} className="text-[10px] uppercase font-bold tracking-wider">
                      {account.accountType}
                    </Badge>
                  </div>
                </div>

                {/* Account Details & Balance */}
                <div className="mt-4">
                  <h3
                    data-testid={`account-name-${account.id}`}
                    className="truncate text-sm font-bold text-ink group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors"
                    title={account.name}
                  >
                    {account.name}
                  </h3>

                  <div className="mt-1 flex items-center justify-between text-xs text-ink-subtle font-mono">
                    <span>{formatAccountNumber(account.accountNumber)}</span>
                    <span className="font-sans font-medium">{account.currency || 'USD'}</span>
                  </div>

                  <div className="mt-3 flex items-baseline gap-1">
                    <span
                      data-testid={`account-balance-${account.id}`}
                      className={cn(
                        'text-xl font-extrabold tracking-tight tabular-nums sm:text-2xl',
                        isPositive ? 'text-ink' : 'text-rose-600 dark:text-rose-400',
                      )}
                    >
                      {formatFinanceCurrency(account.balance, account.currency || 'USD')}
                    </span>
                  </div>
                </div>

                {/* Footer Quick Action */}
                <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-3 text-xs text-ink-muted">
                  <span className="text-[11px] text-ink-subtle">{meta.label}</span>
                  {onTransfer && (
                    <button
                      type="button"
                      data-testid={`account-transfer-btn-${account.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTransfer(account.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink cursor-pointer"
                    >
                      <ArrowLeftRight className="size-3" />
                      Transfer
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
