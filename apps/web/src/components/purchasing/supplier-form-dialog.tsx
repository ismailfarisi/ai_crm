'use client';

import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  createSupplierSchema,
  defaultVatStatus,
  EMIRATE_NAMES,
  EMIRATES,
  isUaeCountry,
  type SupplierDto,
} from '@saas/shared';
import { useCreateSupplier, useUpdateSupplier } from '@/hooks/use-suppliers';
import { useOrganization } from '@/hooks/use-organization';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';
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
  emirate: null,
  vatStatus: 'NOT_REGISTERED',
  // Filled with the organisation's base currency when the dialog opens.
  currency: '',
  paymentTermsDays: 30,
  leadTimeDays: 7,
  isActive: true,
  notes: '',
};

const VAT_STATUS_OPTIONS = [
  { value: 'REGISTERED', label: 'Registered in the UAE' },
  { value: 'NOT_REGISTERED', label: 'Not registered' },
  { value: 'OUTSIDE_UAE', label: 'Outside the UAE' },
];

const EMIRATE_OPTIONS = EMIRATES.map((code) => ({ value: code, label: EMIRATE_NAMES[code] }));

export function SupplierFormDialog({ open, onClose, supplier }: SupplierFormDialogProps) {
  const isEditing = Boolean(supplier);

  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  // VAT status, emirate and TRN are UAE VAT ideas; elsewhere the form is the
  // plain one, and the API picks the status.
  const organization = useOrganization().data;
  const orgIsUae = organization?.country === 'AE';
  // Most suppliers bill in the currency the business keeps its books in.
  const baseCurrency = organization?.baseCurrency ?? '';

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
    resolver: zodResolver(createSupplierSchema),
    defaultValues: EMPTY,
  });

  // Once the user picks a status themselves, country and TRN stop steering it.
  const statusTouched = useRef(false);
  const followDefaultStatus = () => {
    if (statusTouched.current) return;
    const { country, taxId } = getValues();
    setValue('vatStatus', defaultVatStatus(country ?? null, taxId ?? null));
  };

  // Repopulate whenever the dialog opens for a different supplier.
  useEffect(() => {
    if (!open) return;
    statusTouched.current = false;

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
            emirate: supplier.emirate,
            // The stored status, not a recomputed one: opening a record must not change it.
            vatStatus: supplier.vatStatus ?? defaultVatStatus(supplier.country, supplier.taxId),
            currency: supplier.currency ?? baseCurrency,
            paymentTermsDays: supplier.paymentTermsDays ?? 30,
            leadTimeDays: supplier.leadTimeDays ?? 7,
            isActive: supplier.isActive,
            notes: supplier.notes ?? '',
          }
        : { ...EMPTY, currency: baseCurrency },
    );
    // The base currency is read once per opening; it arriving late is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier, reset]);

  // The organisation can still be loading when the dialog opens. Fill the
  // currency once it arrives, unless someone has already typed one.
  useEffect(() => {
    if (open && baseCurrency && !getValues('currency')) setValue('currency', baseCurrency);
  }, [open, baseCurrency, getValues, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (orgIsUae) {
        if (supplier) await update.mutateAsync({ id: supplier.id, input: values });
        else await create.mutateAsync(values);
      } else {
        // Outside the UAE, or while the organisation is loading or cannot be
        // read (the fields stay hidden then): an update never sends the VAT
        // status or emirate, so the API keeps what is stored, re-deriving the
        // status only when the country or tax ID changes. A new supplier
        // sends null and the API picks the status.
        const { vatStatus: _vatStatus, emirate: _emirate, ...rest } = values;
        if (supplier) await update.mutateAsync({ id: supplier.id, input: rest });
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
          <p role="alert" className="text-sm text-warning">
            VAT on this supplier&apos;s bills cannot be recovered until a TRN is added.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Currency"
            placeholder={baseCurrency || undefined}
            hint="3-letter code. Orders and bills from this supplier are priced in it."
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
