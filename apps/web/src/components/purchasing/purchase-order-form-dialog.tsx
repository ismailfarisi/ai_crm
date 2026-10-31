'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { createPurchaseOrderSchema, type SupplierDto } from '@saas/shared';
import { useSuppliers } from '@/hooks/use-suppliers';
import { useMaterials } from '@/hooks/use-catalog-admin';
import { useDebounced } from '@/hooks/use-catalog';
import { useCreatePurchaseOrder } from '@/hooks/use-purchase-orders';
import { useOrganization } from '@/hooks/use-organization';
import { ApiError } from '@/lib/api/client';
import { formatMoney } from '@/lib/utils';
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

/** The API's list schema caps a page at 100; asking for more is a 400. */
const SUPPLIER_PAGE_SIZE = 100;

/**
 * Lines after the first sit in the same columns as the first, so their labels
 * are hidden on wider screens. They stay in the markup for screen readers, and
 * stay visible on a phone, where the fields stack and have no column heading.
 */
const LATER_LINE_LABEL = 'sm:[&>label]:sr-only';

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

  const [supplierSearch, setSupplierSearch] = useState('');
  const search = useDebounced(supplierSearch.trim());
  const supplierQuery = useSuppliers({
    page: 1,
    limit: SUPPLIER_PAGE_SIZE,
    sortBy: 'companyName',
    sortOrder: 'ASC',
    ...(search ? { search } : {}),
  });
  const { data: materials } = useMaterials();
  const baseCurrency = useOrganization().data?.baseCurrency ?? null;

  // Kept apart from the list, so narrowing the search does not drop the
  // supplier already picked, or the currency the order is priced in.
  const [chosen, setChosen] = useState<SupplierDto | null>(null);

  const found = supplierQuery.data?.items ?? [];
  const suppliers =
    chosen && !found.some((s) => s.id === chosen.id) ? [chosen, ...found] : found;
  // The API prices the order in the supplier's currency.
  const currency = chosen?.currency || baseCurrency;

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
    if (!open) return;
    reset(EMPTY);
    setChosen(null);
    setSupplierSearch('');
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
          <Input
            label="Find a supplier"
            type="search"
            placeholder="Type part of a name"
            autoComplete="off"
            value={supplierSearch}
            onChange={(event) => setSupplierSearch(event.target.value)}
          />
          <div className="space-y-1.5">
            <Select
              label="Supplier"
              required
              error={errors.supplierId?.message}
              placeholder={supplierPlaceholder(supplierQuery, found.length, search)}
              options={suppliers.map((s) => ({ value: s.id, label: s.companyName }))}
              {...register('supplierId', {
                onChange: (event) => {
                  const id = event.target.value as string;
                  setChosen(suppliers.find((s) => s.id === id) ?? null);
                },
              })}
            />
            {supplierQuery.isError ? (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-danger">
                <span>
                  {supplierQuery.error instanceof Error && supplierQuery.error.message
                    ? `Suppliers did not load: ${supplierQuery.error.message}`
                    : 'Suppliers did not load.'}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={supplierQuery.isFetching}
                  onClick={() => void supplierQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : (supplierQuery.data?.meta?.total ?? 0) > found.length ? (
              <p className="text-xs text-ink-subtle">
                Showing the first {found.length} of {supplierQuery.data?.meta?.total}. Type a name
                to find the rest.
              </p>
            ) : null}
          </div>
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
                role="group"
                aria-label={`Line ${index + 1}`}
                className="grid gap-3 rounded-xl border border-border/60 bg-surface-muted/20 p-3 sm:grid-cols-12"
              >
                <div className="sm:col-span-4">
                  <Select
                    label="Material"
                    containerClassName={index === 0 ? undefined : LATER_LINE_LABEL}
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
                    label="Description"
                    containerClassName={index === 0 ? undefined : LATER_LINE_LABEL}
                    required
                    error={errors.lines?.[index]?.description?.message}
                    {...register(`lines.${index}.description`)}
                  />
                </div>

                <div className="sm:col-span-3">
                  <Input
                    label="Quantity"
                    containerClassName={index === 0 ? undefined : LATER_LINE_LABEL}
                    type="number"
                    step="0.001"
                    min="0"
                    error={errors.lines?.[index]?.qtyOrdered?.message}
                    {...register(`lines.${index}.qtyOrdered`)}
                  />
                </div>

                <div className="sm:col-span-3">
                  <Select
                    label="Unit"
                    containerClassName={index === 0 ? undefined : LATER_LINE_LABEL}
                    options={UOM_OPTIONS}
                    error={errors.lines?.[index]?.uom?.message}
                    {...register(`lines.${index}.uom`)}
                  />
                </div>

                <div className="sm:col-span-3">
                  <Input
                    label={currency ? `Unit cost (${currency})` : 'Unit cost'}
                    containerClassName={index === 0 ? undefined : LATER_LINE_LABEL}
                    type="number"
                    step="0.0001"
                    min="0"
                    error={errors.lines?.[index]?.unitCost?.message}
                    {...register(`lines.${index}.unitCost`)}
                  />
                </div>

                <div className="flex items-end justify-between gap-2 sm:col-span-3">
                  <span className="pb-2 text-sm font-medium tabular-nums text-ink">
                    {formatMoney(
                      (Number(lines?.[index]?.qtyOrdered) || 0) *
                        (Number(lines?.[index]?.unitCost) || 0),
                      currency,
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
                {formatMoney(total, currency)}
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

/** Says why the list is empty, rather than claiming there are no suppliers when the request failed. */
function supplierPlaceholder(
  query: { isPending: boolean; isError: boolean },
  count: number,
  search: string,
): string {
  if (query.isError) return 'Suppliers did not load';
  if (query.isPending) return 'Loading suppliers…';
  if (count > 0) return 'Choose a supplier…';
  return search ? `No supplier matches "${search}"` : 'No suppliers yet';
}
