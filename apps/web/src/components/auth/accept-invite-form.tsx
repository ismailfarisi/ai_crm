'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { acceptInviteSchema, type AcceptInviteInput } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/primitives';

export function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AcceptInviteInput>({
    resolver: zodResolver(acceptInviteSchema),
    defaultValues: { token: token ?? '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.auth.acceptInvite(values);
      // The session cookies are set by the API; refresh so server components
      // re-render with the session before navigating into the app.
      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof AcceptInviteInput, { message });
        }
        setFormError(error.message);
      } else {
        setFormError('Could not reach the server. Is the API running?');
      }
    }
  });

  if (!token) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invite link missing</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          This link needs an invite token. Ask the person who invited you to re-send it.
        </p>
        <p className="mt-6 text-sm text-ink-muted">
          <Link href="/login" className="font-medium text-brand hover:underline">
            Sign in instead
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re invited</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Set a password to join your team&apos;s workspace.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        {formError && <Alert>{formError}</Alert>}

        <input type="hidden" {...register('token')} />

        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••••"
          hint="At least 10 characters, with upper case, lower case and a number."
          error={errors.password?.message}
          {...register('password')}
        />

        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Set password &amp; sign in
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
