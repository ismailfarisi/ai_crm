'use client';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  EXPENSE_CATEGORIES,
  PERMISSIONS,
  RECURRING_INTERVALS,
  createRecurringExpenseSchema,
  monthlyEquivalent,
  type CreateRecurringExpensePayload,
  type RecurringExpenseDto,
  type RecurringInterval,
} from '@saas/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { useCan } from '@/lib/session-context';
import { useSuppliers } from '@/hooks/use-suppliers';
import { formatFinanceCurrency } from '../dashboard/treasury-stat-cards';

type FormIn = z.input<typeof createRecurringExpenseSchema>;
type FormOut = z.output<typeof createRecurringExpenseSchema>;

export const INTERVAL_LABEL: Record<RecurringInterval, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly (4 a year)',
  SEMI_ANNUAL: 'Every 6 months',
  ANNUAL: 'Annually',
};

export interface SubscriptionFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing. */
  existing?: RecurringExpenseDto | null;
  /** True once a bill has been generated: start date and interval lock. */
  hasOccurrences?: boolean;
  onSubmit: (payload: CreateRecurringExpensePayload) => Promise<void> | void;
  isLoading?: boolean;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDefaults(e?: RecurringExpenseDto | null): FormIn {
  if (!e) {
    return {
      supplierId: null,
      vendorName: '',
      category: 'Rent & premises',
      amount: '',
      billingInterval: 'MONTHLY',
      startDate: today(),
      endDate: null,
      taxCodeId: null,
      autoApprove: false,
      spreadOverPeriod: true,
    };
  }
  return {
    supplierId: e.supplierId,
    vendorName: e.vendorName,
    category: e.category,
    amount: e.amount,
    billingInterval: e.billingInterval,
    startDate: e.startDate,
    endDate: e.endDate,
    taxCodeId: e.taxCodeId,
    autoApprove: e.autoApprove,
    spreadOverPeriod: e.spreadOverPeriod,
  };
}

export function SubscriptionFormModal({
  open,
  onClose,
  existing,
  hasOccurrences = false,
  onSubmit,
  isLoading = false,
}: SubscriptionFormModalProps) {
  const canApproveBills = useCan({ permission: PERMISSIONS.BILL_APPROVE });
  const { data: suppliers } = useSuppliers({ limit: 100 });

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(createRecurringExpenseSchema),
    defaultValues: toDefaults(existing),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(existing));
  }, [existing, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const interval = form.watch('billingInterval') as RecurringInterval;
  const amount = Number(form.watch('amount') || 0);
  const supplierId = form.watch('supplierId');
  const errors = form.formState.errors;

  // The server refuses these edits without bill:approve while auto-approve is on,
  // so say so up front rather than after a round trip.
  const sensitiveLocked = Boolean(existing?.autoApprove) && !canApproveBills;

  const supplierOptions = useMemo(() => {
    const rows = (suppliers?.items ?? []).map((s) => ({ value: s.id, label: s.companyName }));
    if (existing?.supplierId && !rows.some((r) => r.value === existing.supplierId)) {
      rows.unshift({ value: existing.supplierId, label: existing.supplierName ?? 'Current supplier' });
    }
    return [{ value: '', label: 'No supplier (forecast only)' }, ...rows];
  }, [suppliers, existing]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? 'Edit recurring expense' : 'New recurring expense'}
      description="Bills are created for you on each billing date, so rent, licences and utilities reach the books without being keyed in."
    >
      <form
        data-testid="subscription-form"
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          try {
            await onSubmit(values);
          } catch {
            // The mutation has already toasted the server's reason; keep the form open to retry.
            return;
          }
          onClose();
        })}
        className="space-y-4"
      >
        {sensitiveLocked && (
          <p data-testid="sensitive-locked-note" className="text-xs text-warning">
            This schedule approves its own bills, so changing the amount, supplier, category or spreading needs the
            bill approval permission.
          </p>
        )}

        <Controller
          control={form.control}
          name="supplierId"
          render={({ field }) => (
            <Select
              label="Supplier"
              data-testid="select-sub-supplier"
              options={supplierOptions}
              disabled={sensitiveLocked}
              value={field.value ?? ''}
              onChange={(e) => {
                const id = e.target.value || null;
                field.onChange(id);
                const picked = suppliers?.items.find((s) => s.id === id);
                if (picked && !form.getValues('vendorName')) form.setValue('vendorName', picked.companyName);
              }}
              error={errors.supplierId?.message}
            />
          )}
        />
        {!supplierId && (
          <p data-testid="no-supplier-note" className="text-xs text-warning">
            Without a supplier this stays in the forecast but no bills are created.
          </p>
        )}

        <Input
          label="Name"
          data-testid="input-sub-name"
          placeholder="e.g. Office rent, DEWA, Microsoft 365"
          {...form.register('vendorName')}
          error={errors.vendorName?.message}
        />

        <div>
          <Input
            label="Category"
            data-testid="input-sub-category"
            list="subscription-categories"
            disabled={sensitiveLocked}
            {...form.register('category')}
            error={errors.category?.message}
          />
          <datalist id="subscription-categories">
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <Input
          label="Amount per bill"
          data-testid="input-sub-amount"
          type="number"
          step="0.01"
          disabled={sensitiveLocked}
          {...form.register('amount')}
          error={errors.amount?.message}
        />

        <Select
          label="Billed"
          data-testid="select-sub-interval"
          disabled={hasOccurrences}
          hint={hasOccurrences ? 'Locked once a bill has been created.' : undefined}
          options={RECURRING_INTERVALS.map((i) => ({ value: i, label: INTERVAL_LABEL[i] }))}
          {...form.register('billingInterval')}
        />
        {interval !== 'MONTHLY' && amount > 0 && (
          <p data-testid="monthly-equivalent" className="text-xs text-ink-muted">
            About {formatFinanceCurrency(monthlyEquivalent(amount, interval))} a month
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First bill on"
            data-testid="input-sub-start"
            type="date"
            disabled={hasOccurrences}
            {...form.register('startDate')}
            error={errors.startDate?.message}
          />
          <Input
            label="Ends (optional)"
            data-testid="input-sub-end"
            type="date"
            {...form.register('endDate', { setValueAs: (v: string) => (v ? v : null) })}
            error={errors.endDate?.message}
          />
        </div>

        {interval !== 'MONTHLY' && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="check-sub-spread"
              disabled={sensitiveLocked}
              {...form.register('spreadOverPeriod')}
            />
            <span>
              Spread over the period
              <br />
              <span className="text-xs text-ink-muted">
                Book to prepaid and expense an equal amount each month, so each month&apos;s profit carries its share.
              </span>
            </span>
          </label>
        )}

        <label
          className="flex items-start gap-2 text-sm"
          title={canApproveBills ? undefined : 'Only someone who can approve bills can turn this on'}
        >
          <input
            type="checkbox"
            data-testid="check-sub-auto-approve"
            disabled={!canApproveBills}
            {...form.register('autoApprove')}
          />
          <span>
            Approve bills automatically
            <br />
            <span className="text-xs text-ink-muted">For fixed amounts like rent. Leave off for bills that vary, like DEWA.</span>
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" data-testid="btn-cancel-subscription" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="btn-submit-subscription" loading={isLoading}>
            {existing ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
