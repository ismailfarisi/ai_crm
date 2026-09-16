'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { createMaterialSchema, type MaterialDto } from '@saas/shared';
import { useSaveMaterial } from '@/hooks/use-catalog-admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';

interface MaterialFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when creating. */
  material?: MaterialDto | null;
}

/** See `supplier-form-dialog` — the schema transforms, so input ≠ output. */
type FormValues = z.input<typeof createMaterialSchema>;
type SubmitValues = z.output<typeof createMaterialSchema>;

const EMPTY: FormValues = {
  name: '',
  sku: '',
  uom: 'SHEET',
  costPerUom: 0,
  sheetWidthMm: undefined,
  sheetHeightMm: undefined,
  grain: 'NONE',
  wastePct: 0,
  isActive: true,
};

export function MaterialFormDialog({ open, onClose, material }: MaterialFormDialogProps) {
  const isEditing = Boolean(material);
  const save = useSaveMaterial();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(createMaterialSchema),
    defaultValues: EMPTY,
  });

  // Sheet dimensions only mean anything for sheet stock, and the schema only
  // demands them there, so the fields follow the unit of measure.
  const uom = watch('uom');

  useEffect(() => {
    if (!open) return;

    reset(
      material
        ? {
            name: material.name,
            sku: material.sku ?? '',
            uom: material.uom,
            costPerUom: material.costPerUom,
            sheetWidthMm: material.sheetWidthMm ?? undefined,
            sheetHeightMm: material.sheetHeightMm ?? undefined,
            grain: material.grain,
            // Stored as a fraction, shown as a percentage.
            wastePct: material.wastePct,
            isActive: material.isActive,
          }
        : EMPTY,
    );
  }, [open, material, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ id: material?.id, payload: values });
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
      title={isEditing ? 'Edit material' : 'New material'}
      description={
        isEditing
          ? undefined
          : 'Stock you buy and make things from. Its cost is what the costing engine charges a job.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="material-form" loading={isSubmitting}>
            {isEditing ? 'Save changes' : 'Add material'}
          </Button>
        </>
      }
    >
      <form id="material-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Input
            label="Name"
            required
            placeholder="e.g. 350gsm folding boxboard"
            error={errors.name?.message}
            {...register('name')}
          />
          <Input label="Code" placeholder="Optional" error={errors.sku?.message} {...register('sku')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Bought by"
            error={errors.uom?.message}
            options={[
              { value: 'SHEET', label: 'Sheet' },
              { value: 'METRE', label: 'Metre' },
              { value: 'KG', label: 'Kilogram' },
              { value: 'EACH', label: 'Each' },
            ]}
            {...register('uom')}
          />
          <Input
            label="Cost per unit"
            type="number"
            step="0.0001"
            min="0"
            required
            error={errors.costPerUom?.message}
            {...register('costPerUom')}
          />
        </div>

        {uom === 'SHEET' ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Sheet width (mm)"
              type="number"
              step="0.01"
              min="0"
              required
              error={errors.sheetWidthMm?.message}
              {...register('sheetWidthMm')}
            />
            <Input
              label="Sheet height (mm)"
              type="number"
              step="0.01"
              min="0"
              required
              error={errors.sheetHeightMm?.message}
              {...register('sheetHeightMm')}
            />
            <Select
              label="Grain"
              error={errors.grain?.message}
              options={[
                { value: 'NONE', label: 'No grain' },
                { value: 'LENGTH', label: 'Runs along length' },
                { value: 'WIDTH', label: 'Runs across width' },
              ]}
              {...register('grain')}
            />
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Waste allowance"
            type="number"
            step="0.01"
            min="0"
            max="1"
            hint="A fraction: 0.05 adds 5% to every calculated quantity."
            error={errors.wastePct?.message}
            {...register('wastePct')}
          />
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
            <input type="checkbox" className="size-4 rounded border-border" {...register('isActive')} />
            Available for new quotes
          </label>
        </div>
      </form>
    </Dialog>
  );
}
