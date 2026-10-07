'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { CustomObjectDefinitionDto, CustomRecordDto, CustomRecordLinkDto } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { Card, Badge, Skeleton } from '@/components/ui/primitives';

export interface ReverseLinkDto extends CustomRecordLinkDto {
  sourceRecord?: CustomRecordDto & { object?: CustomObjectDefinitionDto };
}

export function RelatedCustomRecords({
  targetType,
  targetId,
}: {
  targetType: string;
  targetId: string;
}) {
  const { data: links = [], isLoading } = useQuery({
    queryKey: queryKeys.customObjects.reverseLinks(targetType, targetId),
    queryFn: () => api.customObjects.getReverseLinks(targetType, targetId) as Promise<ReverseLinkDto[]>,
    enabled: Boolean(targetType && targetId),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (links.length === 0) {
    return <div className="p-4 text-xs text-ink-muted">No linked custom records.</div>;
  }

  return (
    <div className="space-y-2">
      {links.map((link) => {
        const record = link.sourceRecord;
        const object = record?.object;
        const title = record?.values?.[object?.primaryAttributeSlug ?? ''] ?? 'Untitled Record';

        return (
          <Card key={link.id} className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge tone="brand">{object?.name ?? 'Record'}</Badge>
              <Link
                href={`/objects/${object?.slug}/${record?.id}`}
                className="font-medium text-xs text-ink hover:text-brand"
              >
                {title}
              </Link>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
