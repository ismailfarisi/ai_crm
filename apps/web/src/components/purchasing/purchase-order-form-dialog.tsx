'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { createPurchaseOrderSchema } from '@saas/shared';
import { useSuppliers } from '@/hooks/use-suppliers';
import { useMaterials } from '@/hooks/use-catalog-admin';
import { useCreatePurchaseOrder } from '@/hooks/use-purchase-orders';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';

interface PurchaseOrderFormDialogProps {
  open: boolean;
  onClose: () => void;
}

type FormValues = z.input<typeof createPurchaseOrderSchema>;
type SubmitValues = z.output<typeof createPurchaseOrderSchema>;

const EMPTY_LINE = {
  materialId: null,
  description: '',
  qtyOrdered: 1,
  uom: 'EACH' as const,
  unitCost: 0,
};

const EMPTY: FormValues = {
  supplierId: '',
  expectedDate: null,
  notes: '',
  lines: [{ ...EMPTY_LINE }],
  sourceQuoteId: null,
};

const UOM_OPTIONS = [
  { value: 'EACH', label: 'Each' },
  { value: 'SHEET', label: 'Sheet' },
  { value: 'METRE', label: 'Metre' },
  { value: 'KG', label: 'Kilogram' },
];

/**
 * Raises a draft purchase order.
 *
 * `useCreatePurchaseOrder` and the endpoint behind it have existed since
 * purchasing landed, but nothing ever rendered a form for them, so the only
 * documented routes to a PO were "from a quote" or "from a chat message" —
 * neither open to a business that has not set up the costing catalog or a
 * messaging channel. Everything downstream (goods receipt, supplier bill,
 * payables, stock) was unreachable with it.
 */
export function PurchaseOrderFormDialog({ open, onClose }: PurchaseOrderFormDialogProps) {
  const router = useRouter();
  const create = useCreatePurchaseOrder();

  const { data: supplierPage } = useSuppliers({ page: 1, limit: 200 });
  const { data: materials } = useMaterials();

  const suppliers = supplierPage?.items ?? [];

  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(createPurchaseOrderSchema),
    defaultValues: EMPTY,
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const lines = watch('lines');

  useEffect(() => {
    if (open) reset(EMPTY);
  }, [open, reset]);

  /**
   * Picking a material fills in the line from the catalog, because the buyer
   * should not have to retype what the material record already knows. Every
   * field stays editable — a supplier's price on the day is what goes on the
   * order, not the standing cost.
   */
  function applyMaterial(index: number, materialId: string) {
    const material = (materials ?? []).find((m) => m.id === materialId);
    setValue(`lines.${index}.materialId`, materialId || null);
    if (!material) return;
    setValue(`lines.${index}.description`, material.name);
    setValue(`lines.${index}.uom`, material.uom);
    setValue(`lines.${index}.unitCost`, material.costPerUom);
  }

  const total = (lines ?? []).reduce(
    (sum, line) => sum + (Number(line?.qtyOrdered) || 0) * (Number(line?.unitCost) || 0),
    0,
  );

  const onSubmit = handleSubmit(async (values) => {
    try {
      const order = await create.mutateAsync(values);
      onClose();
      router.push(`/purchasing/orders/${order.id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof FormValues, { message });
        }
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="New purchase order"
      description="Raised as a draft. Nothing is sent to the supplier until you submit and approve it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="purchase-order-form" loading={isSubmitting}>
            Create draft
          </Button>
        </>
      }
    >
      <form id="purchase-order-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Supplier"
            required
            error={errors.supplierId?.message}
            placeholder={suppliers.length ? 'Choose a supplier…' : 'No suppliers yet'}
            options={suppliers.map((s) => ({ value: s.id, label: s.companyName }))}
            {...register('supplierId')}
          />
          {/*
            An empty date input reads as '', and `z.coerce.date()` turns that
            into an Invalid Date rather than treating it as absent — so without
            normalising here, leaving the date blank fails the whole form with
            an error pointing at a field the user never touched.
          */}
          <Input
            label="Expected date"
            type="date"
            error={errors.expectedDate?.message}
            {...register('expectedDate', {
              setValueAs: (value) => (value === '' ? null : value),
            })}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink">What you are ordering</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => append({ ...EMPTY_LINE })}
            >
              <Plus className="size-4" />
              Add line
            </Button>
          </div>

          {errors.lines?.message ? (
            <p className="text-xs text-danger">{errors.lines.message}</p>
          ) : null}

          <div className="space-y-3">
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="grid gap-3 rounded-xl border border-border/60 bg-surface-muted/20 p-3 sm:grid-cols-12"
              >
                <div className="sm:col-span-4">
                  <Select
                    label={index === 0 ? 'Material' : undefined}
                    placeholder="Not from the catalog"
                    options={(materials ?? []).map((m) => ({
                      value: m.id,
                      label: m.sku ? `${m.name} (${m.sku})` : m.name,
                    }))}
                    value={lines?.[index]?.materialId ?? ''}
                    onChange={(event) => applyMaterial(index, event.target.value)}
                  />
                </div>

                <div className="sm:col-span-8">
                  <Input
                    label={index === 0 ? 'Description' : undefined}
                    required
                    error={errors.lines?.[index]?.description?.message}
                    {...register(`lines.${index}.description`)}
                  />
                </div>

                <div className="sm:col-span-3">
                  <Input
                    label={index === 0 ? 'Quantity' : undefined}
                    type="number"
                    step="0.001"
                    min="0"
                    error={errors.lines?.[index]?.qtyOrdered?.message}
                    {...register(`lines.${index}.qtyOrdered`)}
                  />
                </div>

                <div className="sm:col-span-3">
                  <Select
                    label={index === 0 ? 'Unit' : undefined}
                    options={UOM_OPTIONS}
                    error={errors.lines?.[index]?.uom?.message}
                    {...register(`lines.${index}.uom`)}
                  />
                </div>

                <div className="sm:col-span-3">
                  <Input
                    label={index === 0 ? 'Unit cost' : undefined}
                    type="number"
                    step="0.0001"
                    min="0"
                    error={errors.lines?.[index]?.unitCost?.message}
                    {...register(`lines.${index}.unitCost`)}
                  />
                </div>

                <div className="flex items-end justify-between gap-2 sm:col-span-3">
                  <span className="pb-2 text-sm font-medium tabular-nums text-ink">
                    {new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: 'USD',
                    }).format(
                      (Number(lines?.[index]?.qtyOrdered) || 0) *
                        (Number(lines?.[index]?.unitCost) || 0),
                    )}
                  </span>
                  {fields.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end border-t border-border/60 pt-2 text-sm">
            <span className="text-ink-muted">
              Order total{' '}
              <strong className="ml-2 tabular-nums text-ink">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: 'USD',
                }).format(total)}
              </strong>
            </span>
          </div>
        </div>

        <Textarea
          label="Notes for the supplier"
          rows={2}
          error={errors.notes?.message}
          {...register('notes')}
        />
      </form>
    </Dialog>
  );
}
