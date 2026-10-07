'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useCustomRecord } from '@/hooks/use-custom-objects';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';

export function CustomRecordDetailView({ slug, id }: { slug: string; id: string }) {
  const { data: record, isLoading } = useCustomRecord(slug, id);

  return (
    <div className="space-y-6">
      <Link
        href={`/objects/${slug}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-subtle hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Back to list
      </Link>

      <PageHeader title="Record Details" />

      {isLoading ? (
        <Card className="p-6 space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-24 w-full" />
        </Card>
      ) : !record ? (
        <EmptyState
          title="Record not found"
          description="The requested custom record could not be found or you lack permission to view it."
          action={
            <Link href={`/objects/${slug}`}>
              <Button variant="outline">Back to list</Button>
            </Link>
          }
        />
      ) : (
        <Card className="p-4 space-y-3">
          <h3 className="font-semibold text-sm text-ink">Attributes</h3>
          {record?.values && Object.keys(record.values).length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(record.values).map(([key, val]) => (
                <div key={key} className="border-b border-border/40 pb-2">
                  <span className="text-xs text-ink-muted uppercase">{key}</span>
                  <p className="font-medium text-sm text-ink">{String(val ?? '—')}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">No attributes recorded.</p>
          )}
        </Card>
      )}
    </div>
  );
}
