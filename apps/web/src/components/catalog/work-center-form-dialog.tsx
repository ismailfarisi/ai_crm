'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { createWorkCenterSchema, type WorkCenterDto } from '@saas/shared';
import { useSaveWorkCenter } from '@/hooks/use-catalog-admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';

interface WorkCenterFormDialogProps {
  open: boolean;
  onClose: () => void;
  workCenter?: WorkCenterDto | null;
}

type FormValues = z.input<typeof createWorkCenterSchema>;
type SubmitValues = z.output<typeof createWorkCenterSchema>;

const EMPTY: FormValues = {
  name: '',
  setupMinutes: 0,
  machineCostPerHour: 0,
  laborCostPerHour: 0,
  scrapPct: 0,
  minChargeMinutes: 0,
  dailyCapacityMinutes: 480,
  isActive: true,
};

export function WorkCenterFormDialog({ open, onClose, workCenter }: WorkCenterFormDialogProps) {
  const isEditing = Boolean(workCenter);
  const save = useSaveWorkCenter();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(createWorkCenterSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;

    reset(
      workCenter
        ? {
            name: workCenter.name,
            setupMinutes: workCenter.setupMinutes,
            machineCostPerHour: workCenter.machineCostPerHour,
            laborCostPerHour: workCenter.laborCostPerHour,
            scrapPct: workCenter.scrapPct,
            minChargeMinutes: workCenter.minChargeMinutes,
            dailyCapacityMinutes: workCenter.dailyCapacityMinutes,
            isActive: workCenter.isActive,
          }
        : EMPTY,
    );
  }, [open, workCenter, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ id: workCenter?.id, payload: values });
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
      title={isEditing ? 'Edit work centre' : 'New work centre'}
      description={
        isEditing
          ? undefined
          : 'A machine or bench. Its rates are what an operation on a job costs, and its capacity is what production schedules against.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="work-center-form" loading={isSubmitting}>
            {isEditing ? 'Save changes' : 'Add work centre'}
          </Button>
        </>
      }
    >
      <form id="work-center-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <Input
          label="Name"
          required
          placeholder="e.g. Heidelberg SM 74 — 5 colour"
          error={errors.name?.message}
          {...register('name')}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Machine cost per hour"
            type="number"
            step="0.01"
            min="0"
            error={errors.machineCostPerHour?.message}
            {...register('machineCostPerHour')}
          />
          <Input
            label="Labour cost per hour"
            type="number"
            step="0.01"
            min="0"
            error={errors.laborCostPerHour?.message}
            {...register('laborCostPerHour')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Setup time (minutes)"
            type="number"
            step="1"
            min="0"
            hint="Charged once per run, however long the run is."
            error={errors.setupMinutes?.message}
            {...register('setupMinutes')}
          />
          <Input
            label="Minimum charge (minutes)"
            type="number"
            step="1"
            min="0"
            hint="A short job is never billed for less than this."
            error={errors.minChargeMinutes?.message}
            {...register('minChargeMinutes')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Scrap rate"
            type="number"
            step="0.01"
            min="0"
            max="1"
            hint="A fraction: 0.02 means 2% of output is lost here."
            error={errors.scrapPct?.message}
            {...register('scrapPct')}
          />
          <Input
            label="Capacity per day (minutes)"
            type="number"
            step="1"
            min="1"
            hint="480 is one eight-hour shift."
            error={errors.dailyCapacityMinutes?.message}
            {...register('dailyCapacityMinutes')}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="size-4 rounded border-border" {...register('isActive')} />
          Available for new quotes and jobs
        </label>
      </form>
    </Dialog>
  );
}
