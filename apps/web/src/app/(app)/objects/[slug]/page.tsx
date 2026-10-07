import { use } from 'react';
import { CustomObjectRecordsView } from '@/components/objects/custom-object-records-view';

export interface ObjectRecordsPageProps {
  params: Promise<{ slug: string }>;
}

export default function ObjectRecordsPage({ params }: ObjectRecordsPageProps) {
  const { slug } = use(params);
  return <CustomObjectRecordsView slug={slug} />;
}
