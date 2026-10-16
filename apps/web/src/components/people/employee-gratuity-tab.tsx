'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { SlidersHorizontal } from 'lucide-react';
import { PERMISSIONS, gratuityAdjustmentSchema, type GratuityEntryKind } from '@saas/shared';
import { useAdjustGratuity, useEmployeeGratuity } from '@/hooks/use-payroll';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { Card, CardBody, EmptyState } from '@/components/ui/primitives';

type FormIn = z.input<typeof gratuityAdjustmentSchema>;
type FormOut = z.output<typeof gratuityAdjustmentSchema>;

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const KIND_LABELS: Record<GratuityEntryKind, string> = {
  OPENING: 'Opening balance',
  ACCRUAL: 'Payroll accrual',
  ADJUSTMENT: 'Adjustment',
  REVERSAL: 'Reversal',
};

const EMPTY: FormIn = { amount: '', note: '' };

export function EmployeeGratuityTab({ employeeId }: { employeeId: string }) {
  const { data, isPending, isError, error } = useEmployeeGratuity(employeeId);
  const adjust = useAdjustGratuity();
  const [open, setOpen] = useState(false);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(gratuityAdjustmentSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (open) form.reset(EMPTY);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isPending) return <p className="text-ink-muted">Loading…</p>;
  if (isError || !data) {
    return <EmptyState title="Couldn't load gratuity" description={error instanceof Error ? error.message : 'Please try again.'} />;
  }
  const errors = form.formState.errors;

  return (
    <div className="space-y-4" data-testid="gratuity-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="grid grid-cols-3 gap-6 text-sm">
          <div>
            <dt className="text-xs text-ink-subtle">Provision balance</dt>
            <dd className="text-lg font-semibold tabular-nums text-ink">{money(data.balance)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Entitled today</dt>
            <dd className="text-lg font-semibold tabular-nums text-ink-muted">{money(data.entitlementToday)}</dd>
            {data.statutoryEntitlementToday !== undefined &&
              data.statutoryEntitlementToday !== data.entitlementToday && (
                <p className="text-xs text-ink-subtle">
                  {money(data.statutoryEntitlementToday)} statutory, adjustments on top
                </p>
              )}
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Service days</dt>
            <dd className="text-lg font-semibold tabular-nums text-ink-muted">{data.serviceDaysToday}</dd>
          </div>
        </dl>
        <Can permission={PERMISSIONS.PAYROLL_APPROVE}>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <SlidersHorizontal className="size-4" />
            Adjust
          </Button>
        </Can>
      </div>

      <Card>
        <CardBody>
          {data.entries.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing has been provided for yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-subtle">
                  <th className="py-2 font-medium">As of</th>
                  <th className="py-2 font-medium">Movement</th>
                  <th className="py-2 font-medium">Note</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="py-2 whitespace-nowrap">{new Date(e.asOf).toLocaleDateString()}</td>
                    <td className="py-2">{KIND_LABELS[e.kind]}</td>
                    <td className="py-2 text-ink-muted">{e.note ?? '—'}</td>
                    <td className="py-2 text-right tabular-nums">{money(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Adjust gratuity provision"
        description="Use a negative amount to reduce the provision. The books are updated with it."
      >
        <form
          data-testid="gratuity-adjust-form"
          noValidate
          onSubmit={form.handleSubmit(async (values) => {
            try {
              await adjust.mutateAsync({ id: employeeId, input: values });
            } catch {
              return;
            }
            setOpen(false);
          })}
          className="space-y-4"
        >
          <Input label="Amount" type="number" step="0.01" {...form.register('amount')} error={errors.amount?.message} />
          <Input label="Reason" {...form.register('note')} error={errors.note?.message} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={adjust.isPending}>
              Adjust
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
