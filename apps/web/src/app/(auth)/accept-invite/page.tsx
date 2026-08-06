import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AcceptInviteForm } from '@/components/auth/accept-invite-form';
import { Skeleton } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Accept invite' };

export default function AcceptInvitePage() {
  // useSearchParams needs a Suspense boundary to keep the route static.
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AcceptInviteForm />
    </Suspense>
  );
}
