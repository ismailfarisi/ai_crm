'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  PERMISSIONS,
  createEmployeeSchema,
  type CreateEmployeePayload,
  type EmployeeDto,
  type UpdateEmployeePayload,
} from '@saas/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { CountrySelect } from '@/components/ui/country-select';
import { useCan } from '@/lib/session-context';

type FormIn = z.input<typeof createEmployeeSchema>;
type FormOut = z.output<typeof createEmployeeSchema>;

const DIFF_KEYS = [
  'firstName',
  'lastName',
  'jobTitle',
  'department',
  'userId',
  'joiningDate',
  'leavingDate',
  'status',
  'nationality',
  'isNational',
  'paymentMethod',
  'bankName',
  'iban',
  'email',
  'phone',
] as const;

/** Only what changed, so an edit never asks the server to touch what the user left alone. */
export function diffEmployee(existing: EmployeeDto, next: CreateEmployeePayload): UpdateEmployeePayload {
  const changed: Record<string, unknown> = {};
  for (const key of DIFF_KEYS) {
    // `iban` is absent from the DTO for anyone without employee:manage; never send it blind.
    if (key === 'iban' && existing.iban === undefined) continue;
    if ((next[key] ?? null) !== (existing[key] ?? null)) changed[key] = next[key];
  }
  return changed as UpdateEmployeePayload;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDefaults(e?: EmployeeDto | null): FormIn {
  if (!e) {
    return {
      firstName: '',
      lastName: '',
      jobTitle: '',
      department: '',
      joiningDate: today(),
      leavingDate: null,
      status: 'ACTIVE',
      nationality: '',
      isNational: false,
      paymentMethod: 'BANK',
      bankName: '',
      iban: '',
      email: '',
      phone: '',
    };
  }
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    jobTitle: e.jobTitle ?? '',
    department: e.department ?? '',
    userId: e.userId,
    joiningDate: e.joiningDate,
    leavingDate: e.leavingDate,
    status: e.status,
    nationality: e.nationality ?? '',
    isNational: e.isNational,
    paymentMethod: e.paymentMethod,
    bankName: e.bankName ?? '',
    iban: e.iban ?? '',
    email: e.email ?? '',
    phone: e.phone ?? '',
  };
}

export interface EmployeeFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing. */
  existing?: EmployeeDto | null;
  onSubmit: (payload: CreateEmployeePayload) => Promise<void> | void;
  isLoading?: boolean;
}

export function EmployeeFormModal({ open, onClose, existing, onSubmit, isLoading = false }: EmployeeFormModalProps) {
  const canManage = useCan({ permission: PERMISSIONS.EMPLOYEE_MANAGE });
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: toDefaults(existing),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(existing));
  }, [existing, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = form.formState.errors;
  const method = form.watch('paymentMethod');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? 'Edit employee' : 'Add employee'}
      description="Pay is set separately, on the Salary tab, so every change keeps its history."
    >
      <form
        data-testid="employee-form"
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
        <div className="grid grid-cols-2 gap-3">
          <Input label="First name" {...form.register('firstName')} error={errors.firstName?.message} />
          <Input label="Last name" {...form.register('lastName')} error={errors.lastName?.message} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Job title" {...form.register('jobTitle')} error={errors.jobTitle?.message} />
          <Input label="Department" {...form.register('department')} error={errors.department?.message} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Email" type="email" {...form.register('email')} error={errors.email?.message} />
          <Input label="Phone" {...form.register('phone')} error={errors.phone?.message} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Joined" type="date" {...form.register('joiningDate')} error={errors.joiningDate?.message} />
          <Input
            label="Left (optional)"
            type="date"
            {...form.register('leavingDate', { setValueAs: (v: string) => (v ? v : null) })}
            error={errors.leavingDate?.message}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Status"
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'ON_HOLD', label: 'On hold' },
              { value: 'LEFT', label: 'Left' },
            ]}
            {...form.register('status')}
          />
          <CountrySelect label="Nationality" {...form.register('nationality')} error={errors.nationality?.message} />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" {...form.register('isNational')} />
          <span>
            UAE national
          </span>
        </label>

        <Select
          label="Paid by"
          options={[
            { value: 'BANK', label: 'Bank transfer' },
            { value: 'CASH', label: 'Cash' },
          ]}
          {...form.register('paymentMethod')}
        />
        {method === 'BANK' && (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Bank" {...form.register('bankName')} error={errors.bankName?.message} />
            {canManage && (
              <Input
                label="IBAN"
                data-testid="input-employee-iban"
                autoComplete="off"
                {...form.register('iban')}
                error={errors.iban?.message}
              />
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="btn-submit-employee" loading={isLoading}>
            {existing ? 'Save' : 'Add'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
