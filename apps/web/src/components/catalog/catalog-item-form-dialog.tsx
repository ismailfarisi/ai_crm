'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { createCatalogItemSchema, type CatalogItemDto } from '@saas/shared';
import { useSaveCatalogItem } from '@/hooks/use-catalog-admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/field';

interface CatalogItemFormDialogProps {
  open: boolean;
  onClose: () => void;
  item?: CatalogItemDto | null;
}

type FormValues = z.input<typeof createCatalogItemSchema>;
type SubmitValues = z.output<typeof createCatalogItemSchema>;

const EMPTY: FormValues = {
  sku: '',
  name: '',
  description: '',
  uom: 'Units',
  listPrice: 0,
  standardCost: 0,
  taxRate: 0,
  leadTimeDays: 0,
  isActive: true,
};

export function CatalogItemFormDialog({ open, onClose, item }: CatalogItemFormDialogProps) {
  const isEditing = Boolean(item);
  const save = useSaveCatalogItem();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(createCatalogItemSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;

    reset(
      item
        ? {
            sku: item.sku,
            name: item.name,
            description: item.description ?? '',
            uom: item.uom,
            listPrice: item.listPrice,
            standardCost: item.standardCost,
            taxRate: item.taxRate,
            leadTimeDays: item.leadTimeDays,
            isActive: item.isActive,
          }
        : EMPTY,
    );
  }, [open, item, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ id: item?.id, payload: values });
      onClose();
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
      title={isEditing ? 'Edit product' : 'New product'}
      description={
        isEditing
          ? undefined
          : 'Something you sell at a standing price. Its cost is what makes the margin on a quote real.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="catalog-item-form" loading={isSubmitting}>
            {isEditing ? 'Save changes' : 'Add product'}
          </Button>
        </>
      }
    >
      <form id="catalog-item-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <Input label="SKU" required error={errors.sku?.message} {...register('sku')} />
          <Input label="Name" required error={errors.name?.message} {...register('name')} />
        </div>

        <Textarea
          label="Description"
          rows={2}
          hint="Shown on the quote line when this product is picked."
          error={errors.description?.message}
          {...register('description')}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Sold by"
            placeholder="Units"
            error={errors.uom?.message}
            {...register('uom')}
          />
          <Input
            label="List price"
            type="number"
            step="0.01"
            min="0"
            required
            error={errors.listPrice?.message}
            {...register('listPrice')}
          />
          <Input
            label="Standard cost"
            type="number"
            step="0.01"
            min="0"
            hint="What it costs you."
            error={errors.standardCost?.message}
            {...register('standardCost')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Tax rate (%)"
            type="number"
            step="0.01"
            min="0"
            max="100"
            error={errors.taxRate?.message}
            {...register('taxRate')}
          />
          <Input
            label="Lead time (days)"
            type="number"
            step="1"
            min="0"
            error={errors.leadTimeDays?.message}
            {...register('leadTimeDays')}
          />
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4 rounded border-border"
              {...register('isActive')}
            />
            Available for new quotes
          </label>
        </div>
      </form>
    </Dialog>
  );
}
