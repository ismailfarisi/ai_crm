'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { useSession } from '@/lib/session-context';
import { EmptyState } from '@/components/ui/primitives';
import { PEOPLE_NAV_ITEMS } from './people-nav';

/** `/people` has no screen of its own: it sends each person to the first People page they can see. */
export function PeopleIndex() {
  const router = useRouter();
  const { check } = useSession();
  const first = PEOPLE_NAV_ITEMS.find((item) => check(item.rule));

  useEffect(() => {
    if (first) router.replace(first.href);
  }, [first, router]);

  if (first) return null;
  return (
    <EmptyState
      icon={<Users className="size-6" />}
      title="You don't have access to People"
      description="Ask an admin for employee or timesheet access."
    />
  );
}
