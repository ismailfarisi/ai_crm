'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { recordAdvanceSchema, type RecordAdvancePayload } from '@saas/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { useFinanceAccounts } from '@/hooks/use-finance';
import { useOrganization } from '@/hooks/use-organization';

type FormIn = z.input<typeof recordAdvanceSchema>;
type FormOut = z.output<typeof recordAdvanceSchema>;

const EMPTY: FormIn = { amount: '', financeAccountId: '', issuedAt: '', note: '' };

export interface RecordAdvanceModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: RecordAdvancePayload) => Promise<void> | void;
  isLoading?: boolean;
}

export function RecordAdvanceModal({ open, onClose, onSubmit, isLoading = false }: RecordAdvanceModalProps) {
  const { data: accounts = [] } = useFinanceAccounts();
  const { data: org } = useOrganization();
  const baseCurrency = org?.baseCurrency;

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(recordAdvanceSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (open) form.reset(EMPTY);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Advances post to the ledger in the organisation's currency, so only offer accounts held in it.
  const options = useMemo(
    () =>
      accounts
        .filter((a) => !baseCurrency || a.currency === baseCurrency)
        .map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })),
    [accounts, baseCurrency],
  );

  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record salary advance"
      description="Money paid out now and recovered from later payroll runs."
    >
      <form
        data-testid="advance-form"
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          try {
            await onSubmit(values);
          } catch {
            return;
          }
          onClose();
        })}
        className="space-y-4"
      >
        <Input label="Amount" type="number" step="0.01" {...form.register('amount')} error={errors.amount?.message} />
        <Select
          label="Paid from"
          placeholder="Choose an account"
          options={options}
          {...form.register('financeAccountId')}
          error={errors.financeAccountId ? 'Choose the account it was paid from' : undefined}
        />
        <Input label="Date (optional)" type="date" {...form.register('issuedAt', { setValueAs: (v: string) => v || undefined })} error={errors.issuedAt?.message} />
        <Input label="Note (optional)" {...form.register('note')} error={errors.note?.message} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isLoading}>
            Record
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
