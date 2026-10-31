'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CURRENCY_OPTIONS,
  currencyLongLabel,
  registerSchema,
  type RegisterInput,
} from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { CountrySelect } from '@/components/ui/country-select';
import { Alert } from '@/components/ui/primitives';
import { UNREACHABLE_MESSAGE } from '@/components/auth/messages';

// The market is the UAE first, so the dirham leads and is the default.
const BASE_CURRENCY = 'AED';
const BASE_CURRENCY_OPTIONS = [
  ...CURRENCY_OPTIONS.filter((currency) => currency.code === BASE_CURRENCY),
  ...CURRENCY_OPTIONS.filter((currency) => currency.code !== BASE_CURRENCY),
].map((currency) => ({ value: currency.code, label: currencyLongLabel(currency.code) }));

export function RegisterForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof registerSchema>, unknown, RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      organizationName: '',
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      baseCurrency: BASE_CURRENCY,
      country: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.auth.register(values);
      window.location.href = '/dashboard';
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof z.input<typeof registerSchema>, { message });
        }
        setFormError(error.message);
      } else {
        setFormError(UNREACHABLE_MESSAGE);
      }
    }
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        You&apos;ll be the owner, with full access to everything.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        {formError && <Alert>{formError}</Alert>}

        <Input
          label="Company name"
          placeholder="Harbour Box Works"
          error={errors.organizationName?.message}
          {...register('organizationName')}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First name"
            autoComplete="given-name"
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <Input
            label="Last name"
            autoComplete="family-name"
            error={errors.lastName?.message}
            {...register('lastName')}
          />
        </div>

        <Input
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          error={errors.email?.message}
          {...register('email')}
        />

        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters, with upper case, lower case and a number."
          error={errors.password?.message}
          {...register('password')}
        />

        {/*
          Asked here because this is the last moment either is free. The base
          currency can never be changed once anything has been posted, and it
          used to be set to USD without anyone being told; the country is what
          tax rules match on, and nothing else ever asked for it.
        */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Base currency"
            hint="The currency your books are kept in. It cannot be changed later."
            options={BASE_CURRENCY_OPTIONS}
            error={errors.baseCurrency?.message}
            {...register('baseCurrency')}
          />
          <CountrySelect
            label="Country"
            hint="Used to work out the tax on what you sell."
            value={watch('country') ?? ''}
            error={errors.country?.message}
            {...register('country')}
          />
        </div>

        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Create workspace
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-ink underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  );
}
