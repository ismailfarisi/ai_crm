'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  formatOrganizationAddress,
  updateOrganizationSchema,
} from '@saas/shared';
import { useOrganization, useUpdateOrganization } from '@/hooks/use-organization';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/field';
import { Card, CardBody, CardHeader, CardTitle, PageHeader, Skeleton } from '@/components/ui/primitives';
import { CompanyLogoCard } from './company-logo-card';

type FormValues = z.input<typeof updateOrganizationSchema>;
type SubmitValues = z.output<typeof updateOrganizationSchema>;

/**
 * The company behind the documents.
 *
 * Until this existed the organization row held a name, a slug and a base
 * currency; there was no screen and no API, so a quote reached a customer with
 * no address, no registration number and no tax id — details most
 * jurisdictions require on an invoice.
 */
export function CompanyView() {
  const { data: organization, isPending } = useOrganization();
  const update = useUpdateOrganization();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(updateOrganizationSchema),
  });

  useEffect(() => {
    if (!organization) return;
    reset({
      name: organization.name,
      legalName: organization.legalName ?? '',
      taxId: organization.taxId ?? '',
      registrationNumber: organization.registrationNumber ?? '',
      email: organization.email ?? '',
      phone: organization.phone ?? '',
      website: organization.website ?? '',
      addressLine1: organization.addressLine1 ?? '',
      addressLine2: organization.addressLine2 ?? '',
      city: organization.city ?? '',
      region: organization.region ?? '',
      postalCode: organization.postalCode ?? '',
      country: organization.country ?? '',
      documentFooter: organization.documentFooter ?? '',
    });
  }, [organization, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await update.mutateAsync(values);
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof FormValues, { message });
        }
      }
    }
  });

  // A live preview of the letterhead, so it is obvious what is missing before
  // a customer is the one who notices.
  const preview = watch();
  const addressLines = formatOrganizationAddress({
    addressLine1: preview?.addressLine1 ?? null,
    addressLine2: preview?.addressLine2 ?? null,
    city: preview?.city ?? null,
    region: preview?.region ?? null,
    postalCode: preview?.postalCode ?? null,
    country: preview?.country ?? null,
  });

  if (isPending) {
    return (
      <>
        <PageHeader title="Company" description="How your business appears on the documents you send." />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Company"
        description="How your business appears on the quotes and invoices you send."
      />

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-ink">Identity</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Trading name"
                  required
                  hint="What you are known as day to day."
                  error={errors.name?.message}
                  {...register('name')}
                />
                <Input
                  label="Registered name"
                  hint="Only if it differs from the trading name."
                  error={errors.legalName?.message}
                  {...register('legalName')}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Tax / VAT registration"
                  hint="Printed on every tax document."
                  error={errors.taxId?.message}
                  {...register('taxId')}
                />
                <Input
                  label="Company registration number"
                  error={errors.registrationNumber?.message}
                  {...register('registrationNumber')}
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-ink">Address</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
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
                  label="State / region"
                  error={errors.region?.message}
                  {...register('region')}
                />
                <Input
                  label="Postal code"
                  error={errors.postalCode?.message}
                  {...register('postalCode')}
                />
              </div>
              <Input
                label="Country"
                hint="Two-letter code, such as US or GB. Tax rules match on it."
                maxLength={2}
                className="uppercase"
                error={errors.country?.message}
                {...register('country')}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-ink">Contact</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Email"
                  type="email"
                  error={errors.email?.message}
                  {...register('email')}
                />
                <Input label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
              </div>
              <Input label="Website" error={errors.website?.message} {...register('website')} />
              <Textarea
                label="Document footer"
                rows={3}
                hint="Printed under the totals — payment instructions, bank details, anything a customer needs."
                error={errors.documentFooter?.message}
                {...register('documentFooter')}
              />
            </CardBody>
          </Card>

          <div className="flex items-center justify-end gap-3">
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              Save changes
            </Button>
          </div>
        </form>

        {/*
          Outside the form: the logo is multipart and saves on its own, and
          nobody expects to press "Save changes" after picking an image.
        */}
        <div className="lg:col-start-1">
          <CompanyLogoCard logoUrl={organization?.logoUrl ?? null} />
        </div>

        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-ink">
              How a document will read
            </CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-1 rounded-xl border border-border/60 bg-surface-muted/30 p-4 text-sm">
              <p className="font-semibold text-ink">
                {preview?.name || organization?.name || 'Your company'}
              </p>
              {preview?.legalName ? (
                <p className="text-xs text-ink-muted">{preview.legalName}</p>
              ) : null}

              {addressLines.length > 0 ? (
                <div className="pt-2 text-ink-muted">
                  {addressLines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              ) : (
                <p className="pt-2 text-xs text-warning">
                  No address yet. Most jurisdictions require one on an invoice.
                </p>
              )}

              <div className="pt-2 text-xs text-ink-muted">
                {preview?.taxId ? (
                  <p>Tax registration: {preview.taxId}</p>
                ) : (
                  <p className="text-warning">No tax registration number yet.</p>
                )}
                {preview?.registrationNumber ? (
                  <p>Company number: {preview.registrationNumber}</p>
                ) : null}
                {preview?.email ? <p>{preview.email}</p> : null}
                {preview?.phone ? <p>{preview.phone}</p> : null}
              </div>

              {preview?.documentFooter ? (
                <p className="border-t border-border/60 pt-2 text-xs whitespace-pre-line text-ink-muted">
                  {preview.documentFooter}
                </p>
              ) : null}
            </div>

            <p className="mt-3 text-xs text-ink-subtle">
              The ledger is kept in {organization?.baseCurrency}. That is changed under
              Finance → Currencies, and only before anything is posted.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
