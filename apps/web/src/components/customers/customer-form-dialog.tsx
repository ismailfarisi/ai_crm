'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { createCustomerSchema, type CustomerDto } from '@saas/shared';
import { useCreateCustomer, useUpdateCustomer } from '@/hooks/use-customers';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/field';

interface CustomerFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when creating. */
  customer?: CustomerDto | null;
}

/**
 * The schema normalises as it validates (`''` → `null`, defaults filled in), so
 * what the fields hold and what the API receives are different shapes. React
 * Hook Form models that with a third generic for the transformed output.
 */
type FormValues = z.input<typeof createCustomerSchema>;
type SubmitValues = z.output<typeof createCustomerSchema>;

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
  notes: '',
};

export function CustomerFormDialog({ open, onClose, customer }: CustomerFormDialogProps) {
  const isEditing = Boolean(customer);

  const create = useCreateCustomer();
  const update = useUpdateCustomer();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: EMPTY,
  });

  // Repopulate whenever the dialog opens for a different customer.
  useEffect(() => {
    if (!open) return;

    reset(
      customer
        ? {
            companyName: customer.companyName,
            contactName: customer.contactName ?? '',
            email: customer.email ?? '',
            phone: customer.phone ?? '',
            addressLine1: customer.addressLine1 ?? '',
            addressLine2: customer.addressLine2 ?? '',
            city: customer.city ?? '',
            postalCode: customer.postalCode ?? '',
            country: customer.country ?? '',
            taxId: customer.taxId ?? '',
            currency: customer.currency ?? 'USD',
            paymentTermsDays: customer.paymentTermsDays ?? 30,
            notes: customer.notes ?? '',
          }
        : EMPTY,
    );
  }, [open, customer, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (customer) {
        await update.mutateAsync({ id: customer.id, input: values });
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
      title={isEditing ? 'Edit customer' : 'New customer'}
      description={
        isEditing ? undefined : 'Add a company you sell to. Only a company name is required.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="customer-form" loading={isSubmitting}>
            {isEditing ? 'Save changes' : 'Create customer'}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={onSubmit} className="space-y-4" noValidate>
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
          <Input
            label="Tax ID / VAT"
            error={errors.taxId?.message}
            {...register('taxId')}
          />
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
          <Input label="Country" error={errors.country?.message} {...register('country')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Currency"
            placeholder="USD"
            hint="3-letter ISO code, used when invoicing this customer."
            error={errors.currency?.message}
            {...register('currency')}
          />
          <Input
            label="Payment terms"
            type="number"
            hint="Days until payment is due. Used when invoicing."
            error={errors.paymentTermsDays?.message}
            {...register('paymentTermsDays')}
          />
        </div>

        <Textarea
          label="Notes"
          placeholder="Context, contact details, anything worth remembering."
          error={errors.notes?.message}
          {...register('notes')}
        />
      </form>
    </Dialog>
  );
}
