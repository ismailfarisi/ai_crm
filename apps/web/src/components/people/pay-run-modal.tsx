'use client';

import { useMemo, useState } from 'react';
import type { PaymentMethod } from '@saas/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { useFinanceAccounts } from '@/hooks/use-finance';
import { useOrganization } from '@/hooks/use-organization';
import { money } from './payroll-format';

export interface PayRunModalProps {
  open: boolean;
  onClose: () => void;
  method: PaymentMethod;
  amount: number;
  onSubmit: (input: { method: PaymentMethod; financeAccountId: string; paidAt?: Date }) => Promise<void> | void;
  isLoading?: boolean;
  /** Why recording is not possible yet (line edits still saving); submit stays disabled while set. */
  blockedReason?: string | null;
}

/** One call per method: the server refuses a method with nobody to pay. */
export function PayRunModal({ open, onClose, method, amount, onSubmit, isLoading = false, blockedReason = null }: PayRunModalProps) {
  const { data: accounts = [] } = useFinanceAccounts();
  const { data: org } = useOrganization();
  const baseCurrency = org?.baseCurrency;
  const [accountId, setAccountId] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [showError, setShowError] = useState(false);

  // Payroll posts in the organisation's currency, so only offer accounts held in it.
  const options = useMemo(
    () =>
      accounts
        .filter((a) => !baseCurrency || a.currency === baseCurrency)
        .map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })),
    [accounts, baseCurrency],
  );

  const label = method === 'BANK' ? 'bank' : 'cash';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={method === 'BANK' ? 'Pay by bank transfer' : 'Pay cash employees'}
      description={`Records ${money(amount)} paid to employees on ${label}.`}
    >
      <form
        data-testid="pay-run-form"
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (blockedReason) return;
          if (!accountId) {
            setShowError(true);
            return;
          }
          try {
            await onSubmit({ method, financeAccountId: accountId, paidAt: paidAt ? new Date(paidAt) : undefined });
          } catch {
            return;
          }
          onClose();
        }}
      >
        <Select
          label="Paid from"
          placeholder="Choose an account"
          options={options}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          error={showError && !accountId ? 'Choose the account it was paid from' : undefined}
        />
        <Input label="Date (optional)" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        {blockedReason && (
          <p className="text-sm text-ink-muted" role="status" data-testid="pay-blocked">
            {blockedReason}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isLoading} disabled={Boolean(blockedReason)}>
            Record payment
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
