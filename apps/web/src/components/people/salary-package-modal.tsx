'use client';

import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import type { z } from 'zod';
import { createSalaryPackageSchema, packageGross, type CreateSalaryPackagePayload } from '@saas/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';

type FormIn = z.input<typeof createSalaryPackageSchema>;
type FormOut = z.output<typeof createSalaryPackageSchema>;

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY: FormIn = { effectiveFrom: '', basic: '', housing: 0, transport: 0, otherAllowances: [] };

export interface SalaryPackageModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateSalaryPackagePayload) => Promise<void> | void;
  isLoading?: boolean;
}

export function SalaryPackageModal({ open, onClose, onSubmit, isLoading = false }: SalaryPackageModalProps) {
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(createSalaryPackageSchema),
    defaultValues: { ...EMPTY, effectiveFrom: today() },
  });
  const others = useFieldArray({ control: form.control, name: 'otherAllowances' });

  useEffect(() => {
    if (open) form.reset({ ...EMPTY, effectiveFrom: today(), otherAllowances: [] });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = form.formState.errors;
  const watched = form.watch();
  const gross = packageGross({
    basic: Number(watched.basic) || 0,
    housing: Number(watched.housing) || 0,
    transport: Number(watched.transport) || 0,
    otherAllowances: (watched.otherAllowances ?? []).map((a) => ({ label: a.label, amount: Number(a.amount) || 0 })),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record salary change"
      description="A new package applies from its date; earlier payroll runs keep the pay they were calculated with."
    >
      <form
        data-testid="salary-package-form"
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
        <Input label="Effective from" type="date" {...form.register('effectiveFrom')} error={errors.effectiveFrom?.message} />
        <div className="grid grid-cols-3 gap-3">
          <Input label="Basic" type="number" step="0.01" {...form.register('basic')} error={errors.basic?.message} />
          <Input label="Housing" type="number" step="0.01" {...form.register('housing')} error={errors.housing?.message} />
          <Input label="Transport" type="number" step="0.01" {...form.register('transport')} error={errors.transport?.message} />
        </div>

        <div className="space-y-2">
          {others.fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
              <Input
                label={index === 0 ? 'Other allowance' : undefined}
                placeholder="Label"
                {...form.register(`otherAllowances.${index}.label`)}
                error={errors.otherAllowances?.[index]?.label?.message}
              />
              <Input
                label={index === 0 ? 'Amount' : undefined}
                type="number"
                step="0.01"
                {...form.register(`otherAllowances.${index}.amount`)}
                error={errors.otherAllowances?.[index]?.amount?.message}
              />
              <Button type="button" variant="ghost" aria-label="Remove allowance" onClick={() => others.remove(index)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {others.fields.length < 10 && (
            <Button type="button" variant="secondary" onClick={() => others.append({ label: '', amount: 0 })}>
              <Plus className="size-4" />
              Add allowance
            </Button>
          )}
        </div>

        <p data-testid="package-gross" className="text-sm text-ink-muted">
          Gross per month: <span className="font-medium tabular-nums text-ink">{money(gross)}</span>
        </p>

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
