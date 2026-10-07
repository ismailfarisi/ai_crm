'use client';

import { useState } from 'react';
import { Plus, Boxes, Database, Settings2, Sparkles, Layers } from 'lucide-react';
import type { CustomObjectDefinitionDto } from '@saas/shared';
import { useCustomObjects } from '@/hooks/use-custom-objects';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  Skeleton,
  Badge,
} from '@/components/ui/primitives';
import { CreateObjectDialog } from './create-object-dialog';
import { AttributeEditorDrawer } from './attribute-editor-drawer';

export function ObjectStudioView() {
  const { data: objects, isPending, isError, error } = useCustomObjects();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedObjectForFields, setSelectedObjectForFields] =
    useState<CustomObjectDefinitionDto | null>(null);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Object Studio"
        description="Design custom data structures, configure dynamic attributes, and extend your organization's schema."
        actions={
          <Button onClick={() => setIsCreateOpen(true)} className="gap-1.5">
            <Plus className="size-4" />
            New Object
          </Button>
        }
      />

      {/* Content Area */}
      {isPending ? (
        <div data-testid="object-studio-loading" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-danger/30 bg-danger-soft/40 p-6 text-sm text-danger">
          Failed to load custom objects: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      ) : !objects || objects.length === 0 ? (
        <EmptyState
          icon={<Boxes className="size-12 stroke-[1.25]" />}
          title="No custom objects yet"
          description="Create your first custom entity to model industry-specific data, assets, equipment, or records."
          action={
            <Button onClick={() => setIsCreateOpen(true)} className="gap-1.5">
              <Plus className="size-4" />
              New Object
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {objects.map((obj) => {
            const attrCount = obj.attributes?.length ?? 0;
            const relCount = obj.relationships?.length ?? 0;

            return (
              <Card
                key={obj.id || obj.slug}
                className="flex flex-col justify-between hover:border-border/80 transition-shadow hover:shadow-md"
              >
                <CardBody className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="text-base font-semibold tracking-tight text-ink">
                        {obj.name}
                      </h3>
                      <p className="font-mono text-xs text-ink-subtle">
                        /{obj.slug}
                      </p>
                    </div>

                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-dark">
                      <Database className="size-4" />
                    </div>
                  </div>

                  {obj.description && (
                    <p className="line-clamp-2 text-xs text-ink-muted">
                      {obj.description}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-ink-muted">
                    <Badge tone="neutral">
                      {attrCount} {attrCount === 1 ? 'attribute' : 'attributes'}
                    </Badge>
                    <Badge tone="neutral">
                      {relCount} {relCount === 1 ? 'relationship' : 'relationships'}
                    </Badge>
                  </div>
                </CardBody>

                <div className="border-t border-border/25 bg-surface-muted/30 px-6 py-3.5 flex items-center justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedObjectForFields(obj)}
                    className="gap-1.5 text-xs font-medium"
                  >
                    <Settings2 className="size-3.5" />
                    Configure Fields
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <CreateObjectDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />

      {/* Attribute Drawer */}
      <AttributeEditorDrawer
        object={selectedObjectForFields}
        onClose={() => setSelectedObjectForFields(null)}
      />
    </div>
  );
}
