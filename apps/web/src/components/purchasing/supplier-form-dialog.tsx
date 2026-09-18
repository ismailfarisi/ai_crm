'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { createSupplierSchema, type SupplierDto } from '@saas/shared';
import { useCreateSupplier, useUpdateSupplier } from '@/hooks/use-suppliers';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/field';
import { CountrySelect } from '@/components/ui/country-select';

interface SupplierFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when creating. */
  supplier?: SupplierDto | null;
}

/**
 * The schema normalises as it validates (`''` → `null`, defaults filled in), so
 * what the fields hold and what the API receives are different shapes. React
 * Hook Form models that with a third generic for the transformed output.
 */
type FormValues = z.input<typeof createSupplierSchema>;
type SubmitValues = z.output<typeof createSupplierSchema>;

const EMPTY: FormValues = {
  companyName: '',
  contactName: '',
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  postalCode: '',
  country: '',
  taxId: '',
  currency: 'USD',
  paymentTermsDays: 30,
  leadTimeDays: 7,
  isActive: true,
  notes: '',
};

export function SupplierFormDialog({ open, onClose, supplier }: SupplierFormDialogProps) {
  const isEditing = Boolean(supplier);

  const create = useCreateSupplier();
  const update = useUpdateSupplier();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: EMPTY,
  });

  // Repopulate whenever the dialog opens for a different supplier.
  useEffect(() => {
    if (!open) return;

    reset(
      supplier
        ? {
            companyName: supplier.companyName,
            contactName: supplier.contactName ?? '',
            email: supplier.email ?? '',
            phone: supplier.phone ?? '',
            addressLine1: supplier.addressLine1 ?? '',
            addressLine2: supplier.addressLine2 ?? '',
            city: supplier.city ?? '',
            postalCode: supplier.postalCode ?? '',
            country: supplier.country ?? '',
            taxId: supplier.taxId ?? '',
            currency: supplier.currency ?? 'USD',
            paymentTermsDays: supplier.paymentTermsDays ?? 30,
            leadTimeDays: supplier.leadTimeDays ?? 7,
            isActive: supplier.isActive,
            notes: supplier.notes ?? '',
          }
        : EMPTY,
    );
  }, [open, supplier, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (supplier) {
        await update.mutateAsync({ id: supplier.id, input: values });
      } else {
        await create.mutateAsync(values);
      }
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
      title={isEditing ? 'Edit supplier' : 'New supplier'}
      description={
        isEditing ? undefined : 'Add a company you buy from. Only a company name is required.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="supplier-form" loading={isSubmitting}>
            {isEditing ? 'Save changes' : 'Create supplier'}
          </Button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <Input
          label="Company name"
          required
          error={errors.companyName?.message}
          {...register('companyName')}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Contact name"
            error={errors.contactName?.message}
            {...register('contactName')}
          />
          <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
          <Input label="Tax ID / VAT" error={errors.taxId?.message} {...register('taxId')} />
        </div>

        <Input
          label="Address line 1"
          error={errors.addressLine1?.message}
          {...register('addressLine1')}
        />
        <Input
          label="Address line 2"
          error={errors.addressLine2?.message}
          {...register('addressLine2')}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="City" error={errors.city?.message} {...register('city')} />
          <Input
            label="Postal code"
            error={errors.postalCode?.message}
            {...register('postalCode')}
          />
          {/*
            `value` is watched rather than left to `register`, so a country
            typed before this was a picker stays visible instead of reading as
            blank the next time the record is opened.
          */}
          <CountrySelect
            label="Country"
            value={watch('country') ?? ''}
            hint="Tax rules match on the country code, so this is a list rather than a box."
            error={errors.country?.message}
            {...register('country')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Currency"
            placeholder="USD"
            hint="3-letter ISO code, used when ordering from this supplier."
            error={errors.currency?.message}
            {...register('currency')}
          />
          <Input
            label="Payment terms"
            type="number"
            hint="Days until their bill is due."
            error={errors.paymentTermsDays?.message}
            {...register('paymentTermsDays')}
          />
          <Input
            label="Lead time"
            type="number"
            hint="Days from order to delivery. Sets the expected date on a purchase order."
            error={errors.leadTimeDays?.message}
            {...register('leadTimeDays')}
          />
        </div>

        <Textarea
          label="Notes"
          placeholder="Account numbers, delivery quirks, who to chase."
          error={errors.notes?.message}
          {...register('notes')}
        />
      </form>
    </Dialog>
  );
}
