'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { createToolingSchema, type ToolingDto } from '@saas/shared';
import { useSaveTooling } from '@/hooks/use-catalog-admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';

interface ToolingFormDialogProps {
  open: boolean;
  onClose: () => void;
  tooling?: ToolingDto | null;
}

type FormValues = z.input<typeof createToolingSchema>;
type SubmitValues = z.output<typeof createToolingSchema>;

const EMPTY: FormValues = {
  name: '',
  cost: 0,
  amortize: true,
  reusable: true,
  isActive: true,
};

export function ToolingFormDialog({ open, onClose, tooling }: ToolingFormDialogProps) {
  const isEditing = Boolean(tooling);
  const save = useSaveTooling();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(createToolingSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;

    reset(
      tooling
        ? {
            name: tooling.name,
            cost: tooling.cost,
            amortize: tooling.amortize,
            reusable: tooling.reusable,
            isActive: tooling.isActive,
          }
        : EMPTY,
    );
  }, [open, tooling, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ id: tooling?.id, payload: values });
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
      size="md"
      title={isEditing ? 'Edit tooling' : 'New tooling'}
      description={
        isEditing
          ? undefined
          : 'A one-off cost such as a cutting forme, die or print plate.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="tooling-form" loading={isSubmitting}>
            {isEditing ? 'Save changes' : 'Add tooling'}
          </Button>
        </>
      }
    >
      <form id="tooling-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <Input
          label="Name"
          required
          placeholder="e.g. Cutting forme — 200×150×80 rigid box"
          error={errors.name?.message}
          {...register('name')}
        />

        <Input
          label="Cost"
          type="number"
          step="0.01"
          min="0"
          required
          error={errors.cost?.message}
          {...register('cost')}
        />

        <div className="space-y-2 rounded-xl border border-border/60 bg-surface-muted/30 p-3">
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-border"
              {...register('amortize')}
            />
            <span>
              Spread across the run
              <span className="block text-xs text-ink-muted">
                Off charges the whole cost to the first order instead.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-border"
              {...register('reusable')}
            />
            <span>
              Kept for repeat orders
              <span className="block text-xs text-ink-muted">
                Off remakes and recharges it every time.
              </span>
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm text-ink">
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
