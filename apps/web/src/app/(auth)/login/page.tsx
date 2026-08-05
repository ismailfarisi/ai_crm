import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { Skeleton } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    // useSearchParams needs a Suspense boundary to keep the route static.
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <LoginForm />
    </Suspense>
  );
}
