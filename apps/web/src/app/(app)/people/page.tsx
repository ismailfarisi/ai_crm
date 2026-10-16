import type { Metadata } from 'next';
import { PeopleIndex } from '@/components/people/people-index';

export const metadata: Metadata = { title: 'People' };

export default function PeoplePage() {
  return <PeopleIndex />;
}
