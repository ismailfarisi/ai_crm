'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import type { CustomRecordDto } from '@saas/shared';
import {
  useCustomRecords,
  useCreateCustomRecord,
  useUpdateCustomRecord,
} from '@/hooks/use-custom-objects';
import { DataViewContainer } from '@/components/views/data-view-container';
import { InlineEditableTable } from '@/components/views/inline-editable-table';
import { KanbanBoard, type KanbanColumnDef } from '@/components/views/kanban-board';
import { PageHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { CustomRecordFormDialog } from './custom-record-form-dialog';

export interface CustomObjectRecordsViewProps {
  slug: string;
}

export function CustomObjectRecordsView({ slug }: CustomObjectRecordsViewProps) {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const { data } = useCustomRecords(slug, { search });
  const createRecord = useCreateCustomRecord(slug);
  const updateRecord = useUpdateCustomRecord(slug);

  const object = data?.object;
  const records = data?.items ?? [];
  const attributes = object?.attributes ?? [];
  const singularName = object?.singularName ?? 'Record';
  const title = object?.name ?? 'Records';

  // Find first select attribute to act as Kanban pipeline status
  const selectAttribute = attributes.find((a) => a.type === 'select');

  const kanbanColumns: KanbanColumnDef[] = useMemo(() => {
    if (!selectAttribute?.options || selectAttribute.options.length === 0) {
      return [{ key: 'all', label: 'All Records' }];
    }
    return selectAttribute.options.map((opt) => ({
      key: opt.value,
      label: opt.label,
    }));
  }, [selectAttribute]);

  const columns: (ColumnDef<CustomRecordDto, any> & { isEditable?: boolean })[] = useMemo(() => {
    return attributes.map((attr) => ({
      accessorKey: `values.${attr.slug}`,
      id: attr.slug,
      header: attr.name,
      isEditable: true,
      cell: ({ row }) => {
        const val = row.original.values?.[attr.slug];
        if (attr.slug === object?.primaryAttributeSlug) {
          return (
            <Link
              href={`/objects/${slug}/${row.original.id}`}
              className="font-medium text-ink hover:text-brand transition-colors"
            >
              {val != null ? String(val) : '—'}
            </Link>
          );
        }
        return <span>{val != null ? String(val) : '—'}</span>;
      },
    }));
  }, [attributes, object?.primaryAttributeSlug, slug]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={`Manage ${singularName.toLowerCase()} instances and dynamic attributes.`}
        actions={
          <Button
            variant="primary"
            onClick={() => setCreateOpen(true)}
            className="gap-1.5"
          >
            <Plus className="size-4" />
            <span>New {singularName}</span>
          </Button>
        }
      />

      <DataViewContainer
        entityType={`custom_object:${slug}`}
        search={search}
        onSearchChange={setSearch}
      >
        {({ viewType }) =>
          viewType === 'kanban' ? (
            <KanbanBoard<CustomRecordDto>
              columns={kanbanColumns}
              items={records}
              getItemId={(r) => r.id}
              getStageKey={(r) =>
                selectAttribute
                  ? String(r.values?.[selectAttribute.slug] ?? 'all')
                  : 'all'
              }
              onMoveStage={async (itemId, nextStageKey) => {
                if (selectAttribute) {
                  await updateRecord.mutateAsync({
                    id: itemId,
                    data: { values: { [selectAttribute.slug]: nextStageKey } },
                  });
                }
              }}
              renderCard={(r) => (
                <div className="flex flex-col gap-1">
                  <Link
                    href={`/objects/${slug}/${r.id}`}
                    className="font-medium text-xs text-ink hover:text-brand line-clamp-1"
                  >
                    {String(
                      r.values?.[object?.primaryAttributeSlug ?? ''] ?? 'Untitled'
                    )}
                  </Link>
                </div>
              )}
            />
          ) : (
            <InlineEditableTable
              data={records}
              columns={columns}
              onCellUpdate={async (rowId, field, nextValue) => {
                await updateRecord.mutateAsync({
                  id: rowId,
                  data: { values: { [field.replace('values.', '')]: nextValue } },
                });
              }}
            />
          )
        }
      </DataViewContainer>

      <CustomRecordFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        attributes={attributes}
        onSubmit={async (values) => {
          await createRecord.mutateAsync({ values });
        }}
      />
    </div>
  );
}
