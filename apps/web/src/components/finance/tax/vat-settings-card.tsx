'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  isIsoDate,
  nextPeriodStart,
  PERMISSIONS,
  todayInDubai,
  vatSettingsSchema,
  type VatFrequency,
} from '@saas/shared';
import { useSaveVatSettings, useUaeVatStatus } from '@/hooks/use-credits';
import { ApiError } from '@/lib/api/client';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/primitives';

type FormValues = z.input<typeof vatSettingsSchema>;
type SubmitValues = z.output<typeof vatSettingsSchema>;

const FREQUENCIES = [
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'MONTHLY', label: 'Monthly' },
];

/**
 * The VAT start date to offer: the start of the next period after today in
 * Dubai, counted from the first period. Empty until the first period is a
 * real date on the 1st of a month.
 */
function suggestedStart(firstPeriodStart: string | undefined, frequency: VatFrequency | undefined): string {
  if (!firstPeriodStart || !frequency || !isIsoDate(firstPeriodStart) || !firstPeriodStart.endsWith('-01')) return '';
  const next = nextPeriodStart(firstPeriodStart, frequency, todayInDubai());
  // A first period still in the future tiles backwards from it; VAT cannot
  // start before the first period, so offer the first period itself.
  return next < firstPeriodStart ? firstPeriodStart : next;
}

/** What still stands in the way, with where to fix it. */
function Problems({ problems, intro }: { problems: string[]; intro: string }) {
  return (
    <div className="space-y-2 px-4 py-3 text-sm">
      <p className="text-ink-muted">{intro}</p>
      <ul className="list-disc space-y-1 pl-5 text-ink">
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
      <p className="text-ink-muted">
        Fix these under{' '}
        <Link href="/settings/company" className="text-accent underline">
          Company settings
        </Link>{' '}
        and{' '}
        <Link href="/settings/branches" className="text-accent underline">
          Branches
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * UAE VAT setup at the top of Finance → Tax. While the organisation is not in
 * UAE VAT mode it says what is missing; once it is, it holds the return
 * settings. Only rendered for UAE organisations.
 */
export function VatSettingsCard() {
  const { data: status } = useUaeVatStatus();
  const canManage = useCan({ permission: PERMISSIONS.TAX_MANAGE });
  const save = useSaveVatSettings();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({ resolver: zodResolver(vatSettingsSchema) });

  const settings = status?.settings ?? null;
  useEffect(() => {
    reset({
      periodFrequency: settings?.periodFrequency ?? 'QUARTERLY',
      firstPeriodStart: settings?.firstPeriodStart ?? '',
      registrationDate: settings?.registrationDate ?? '',
      vatStartDate: settings?.vatStartDate ?? '',
      taxAgentName: settings?.taxAgentName ?? '',
      taxAgencyName: settings?.taxAgencyName ?? '',
      tan: settings?.tan ?? '',
      taan: settings?.taan ?? '',
    });
  }, [settings, reset]);

  // First-time setup: the API cannot suggest a start date before it knows the
  // periods, so it is worked out here from what is typed — and kept in step
  // until the user picks a date of their own.
  const firstPeriodStart = watch('firstPeriodStart');
  const periodFrequency = watch('periodFrequency');
  // Set by the field's own onChange, not RHF's dirty state: a suggested value
  // differs from the empty default, so RHF would count it as an edit.
  const [vatStartEdited, setVatStartEdited] = useState(false);
  useEffect(() => {
    if (settings || vatStartEdited) return;
    setValue('vatStartDate', suggestedStart(firstPeriodStart, periodFrequency));
  }, [settings, vatStartEdited, firstPeriodStart, periodFrequency, setValue]);

  if (!status) return null;

  if (!status.enabled) {
    return (
      <section aria-labelledby="vat-setup-heading" className="rounded border border-line bg-surface">
        <h2 id="vat-setup-heading" className="border-b border-line px-4 py-3 text-sm font-medium text-ink">
          UAE VAT
        </h2>
        <Problems problems={status.problems} intro="UAE VAT is not switched on yet. To turn it on:" />
      </section>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await save.mutateAsync(values);
    } catch (error) {
      setServerError(error instanceof ApiError && error.message ? error.message : 'Could not save VAT settings');
    }
  });

  return (
    <section aria-labelledby="vat-settings-heading" className="rounded border border-line bg-surface">
      <h2 id="vat-settings-heading" className="border-b border-line px-4 py-3 text-sm font-medium text-ink">
        VAT settings
      </h2>
      {status.problems.length > 0 && (
        <div className="border-b border-line">
          <Problems problems={status.problems} intro="UAE VAT is on, but some things still need attention:" />
        </div>
      )}
      <form onSubmit={onSubmit} noValidate className="space-y-4 p-4">
        <fieldset disabled={!canManage} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Return frequency"
              options={FREQUENCIES}
              error={errors.periodFrequency?.message}
              {...register('periodFrequency')}
            />
            <Input
              label="First tax period starts"
              type="date"
              error={errors.firstPeriodStart?.message}
              {...register('firstPeriodStart')}
            />
            <Input
              label="VAT registration date"
              type="date"
              error={errors.registrationDate?.message}
              {...register('registrationDate')}
            />
            <Input
              label="VAT start date"
              type="date"
              error={errors.vatStartDate?.message}
              {...register('vatStartDate', { onChange: () => setVatStartEdited(true) })}
            />
          </div>
          <p className="text-xs text-ink-subtle">
            Kerf prepares returns from this period on. Earlier periods are treated as filed outside Kerf.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="Tax agent name" error={errors.taxAgentName?.message} {...register('taxAgentName')} />
            <Input label="Tax agency name" error={errors.taxAgencyName?.message} {...register('taxAgencyName')} />
            <Input label="TAN" error={errors.tan?.message} {...register('tan')} />
            <Input label="TAAN" error={errors.taan?.message} {...register('taan')} />
          </div>
        </fieldset>
        {serverError && <Alert>{serverError}</Alert>}
        {canManage && (
          <div className="flex justify-end">
            <Button type="submit" loading={isSubmitting}>
              Save VAT settings
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
