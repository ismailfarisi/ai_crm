'use client';

import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  createCustomerSchema,
  defaultVatStatus,
  EMIRATE_NAMES,
  EMIRATES,
  isUaeCountry,
  type CustomerDto,
} from '@saas/shared';
import { useCreateCustomer, useUpdateCustomer } from '@/hooks/use-customers';
import { useOrganization } from '@/hooks/use-organization';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';
import { CountrySelect } from '@/components/ui/country-select';

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
  emirate: null,
  vatStatus: 'NOT_REGISTERED',
  currency: 'USD',
  paymentTermsDays: 30,
  notes: '',
};

const VAT_STATUS_OPTIONS = [
  { value: 'REGISTERED', label: 'Registered in the UAE' },
  { value: 'NOT_REGISTERED', label: 'Not registered' },
  { value: 'OUTSIDE_UAE', label: 'Outside the UAE' },
];

const EMIRATE_OPTIONS = EMIRATES.map((code) => ({ value: code, label: EMIRATE_NAMES[code] }));

export function CustomerFormDialog({ open, onClose, customer }: CustomerFormDialogProps) {
  const isEditing = Boolean(customer);

  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  // VAT status, emirate and TRN are UAE VAT ideas; elsewhere the form is the
  // plain one, and the API picks the status.
  const orgIsUae = useOrganization().data?.country === 'AE';

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: EMPTY,
  });

  // Once the user picks a status themselves, country and TRN stop steering it.
  const statusTouched = useRef(false);
  const followDefaultStatus = () => {
    if (statusTouched.current) return;
    const { country, taxId } = getValues();
    setValue('vatStatus', defaultVatStatus(country ?? null, taxId ?? null));
  };

  // Repopulate whenever the dialog opens for a different customer.
  useEffect(() => {
    if (!open) return;
    statusTouched.current = false;

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
            emirate: customer.emirate,
            // The stored status, not a recomputed one: opening a record must not change it.
            vatStatus: customer.vatStatus ?? defaultVatStatus(customer.country, customer.taxId),
            currency: customer.currency ?? 'USD',
            paymentTermsDays: customer.paymentTermsDays ?? 30,
            notes: customer.notes ?? '',
          }
        : EMPTY,
    );
  }, [open, customer, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (orgIsUae) {
        if (customer) await update.mutateAsync({ id: customer.id, input: values });
        else await create.mutateAsync(values);
      } else {
        // Outside the UAE, or while the organisation is loading or cannot be
        // read (the fields stay hidden then): an update never sends the VAT
        // status or emirate, so the API keeps what is stored, re-deriving the
        // status only when the country or tax ID changes. A new customer
        // sends null and the API picks the status.
        const { vatStatus: _vatStatus, emirate: _emirate, ...rest } = values;
        if (customer) await update.mutateAsync({ id: customer.id, input: rest });
        else await create.mutateAsync({ ...rest, vatStatus: null, emirate: null });
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

  const isUae = orgIsUae && isUaeCountry(watch('country'));
  const vatStatus = watch('vatStatus');
  const taxId = watch('taxId');

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
            label={isUae ? 'TRN' : orgIsUae ? 'Tax ID' : 'Tax ID / VAT'}
            hint={isUae ? '15 digits, as on the FTA certificate' : undefined}
            error={errors.taxId?.message}
            {...register('taxId', { onChange: followDefaultStatus })}
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
            {...register('country', { onChange: followDefaultStatus })}
          />
        </div>

        {orgIsUae && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="VAT status"
              options={VAT_STATUS_OPTIONS}
              error={errors.vatStatus?.message}
              {...register('vatStatus', {
                onChange: () => {
                  statusTouched.current = true;
                },
              })}
            />
            {isUae && (
              <Select
                label="Emirate"
                placeholder="Select an emirate"
                options={EMIRATE_OPTIONS}
                error={errors.emirate?.message}
                {...register('emirate', { setValueAs: (v) => v || null })}
              />
            )}
          </div>
        )}
        {orgIsUae && vatStatus === 'REGISTERED' && !(taxId ?? '').trim() && (
          <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
            Invoices to this customer cannot be issued until a TRN is added.
          </p>
        )}

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
