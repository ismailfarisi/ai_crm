'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  LEAVE_TYPES,
  leaveRecordSchema,
  type LeaveRecordDto,
  type LeaveRecordFormInput,
  type LeaveRecordPayload,
  type LeaveType,
} from '@saas/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/primitives';
import { describeServer } from '@/lib/api/describe';

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  ANNUAL: 'Annual',
  SICK: 'Sick',
  UNPAID: 'Unpaid',
  MATERNITY: 'Maternity',
  OTHER_PAID: 'Other paid',
};

const EMPTY: LeaveRecordFormInput = { type: 'ANNUAL', startDate: '', endDate: '', days: null, note: '' };

function toDefaults(r?: LeaveRecordDto | null): LeaveRecordFormInput {
  if (!r) return EMPTY;
  return { type: r.type, startDate: r.startDate, endDate: r.endDate, days: r.days, note: r.note ?? '' };
}

export interface LeaveRecordModalProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing. */
  existing?: LeaveRecordDto | null;
  isLoading?: boolean;
  onSubmit: (payload: LeaveRecordPayload) => Promise<unknown> | void;
}

export function LeaveRecordModal({ open, onClose, existing, isLoading = false, onSubmit }: LeaveRecordModalProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<LeaveRecordFormInput, unknown, LeaveRecordPayload>({
    resolver: zodResolver(leaveRecordSchema),
    defaultValues: toDefaults(existing),
  });

  useEffect(() => {
    if (open) {
      form.reset(toDefaults(existing));
      setServerError(null);
    }
  }, [open, existing]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? 'Edit leave' : 'Record leave'}
      description="Leave reduces the balance and, for unpaid and half-pay days, the next payroll run."
    >
      <form
        data-testid="leave-record-form"
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(async (values) => {
          setServerError(null);
          try {
            await onSubmit(values);
          } catch (error) {
            // 400/409 carry the reason (overlap, settled leaver, locked run): keep the form open.
            setServerError(describeServer(error, 'Could not save the leave record'));
            return;
          }
          onClose();
        })}
      >
        {serverError && (
          <div data-testid="leave-server-error">
            <Alert tone="danger">{serverError}</Alert>
          </div>
        )}
        <Select
          label="Type"
          options={LEAVE_TYPES.map((t) => ({ value: t, label: LEAVE_TYPE_LABELS[t] }))}
          {...form.register('type')}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label="From" type="date" {...form.register('startDate')} error={errors.startDate?.message} />
          <Input label="To" type="date" {...form.register('endDate')} error={errors.endDate?.message} />
        </div>
        <Input
          label="Days (optional)"
          type="number"
          step="0.5"
          hint="Leave blank to count every calendar day; use fewer for half days."
          {...form.register('days', { setValueAs: (v: string) => (v === '' || v == null ? null : Number(v)) })}
          error={errors.days?.message}
        />
        <Input label="Note (optional)" {...form.register('note')} error={errors.note?.message} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isLoading}>
            {existing ? 'Save' : 'Record'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
