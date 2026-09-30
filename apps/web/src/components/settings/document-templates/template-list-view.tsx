'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  FileText,
  Plus,
  Trash2,
  Edit3,
  Star,
  CheckCircle2,
  Palette,
  Loader2,
} from 'lucide-react';
import type { DocumentType } from '@saas/shared';
import { useDocumentTemplates, type DocumentTemplateDto } from '@/hooks/use-document-templates';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/dialog';

const ALL_DOCUMENT_TYPES: { type: DocumentType; label: string }[] = [
  { type: 'INVOICE', label: 'Invoice' },
  { type: 'QUOTE', label: 'Quote' },
  { type: 'STATEMENT', label: 'Statement' },
  { type: 'DELIVERY_NOTE', label: 'Delivery Note' },
  { type: 'PURCHASE_ORDER', label: 'Purchase Order' },
];

export function TemplateListView() {
  const { templates, isLoading, deleteTemplate, setDefaultTemplate } = useDocumentTemplates();

  // Set default modal state
  const [defaultModalTemplate, setDefaultModalTemplate] = useState<DocumentTemplateDto | null>(null);
  const [selectedDefaultTypes, setSelectedDefaultTypes] = useState<DocumentType[]>([]);
  const [isSettingDefault, setIsSettingDefault] = useState(false);

  // Delete modal state
  const [deleteModalTemplate, setDeleteModalTemplate] = useState<DocumentTemplateDto | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const openSetDefaultDialog = (tmpl: DocumentTemplateDto) => {
    setDefaultModalTemplate(tmpl);
    setSelectedDefaultTypes(tmpl.appliesTo && tmpl.appliesTo.length > 0 ? [...tmpl.appliesTo] : ['INVOICE', 'QUOTE']);
  };

  const handleConfirmDefault = async () => {
    if (!defaultModalTemplate) return;
    setIsSettingDefault(true);
    try {
      await setDefaultTemplate(defaultModalTemplate.id, selectedDefaultTypes);
      setDefaultModalTemplate(null);
    } finally {
      setIsSettingDefault(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalTemplate) return;
    setIsDeleting(true);
    try {
      await deleteTemplate(deleteModalTemplate.id);
      setDeleteModalTemplate(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleDefaultType = (type: DocumentType) => {
    setSelectedDefaultTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document Templates"
        description="Design and manage visual layouts, branding colors, and typography across invoices, quotes, customer statements, and purchase orders."
        actions={
          <Link href="/settings/document-templates/new">
            <Button variant="primary" size="md">
              <Plus className="size-4 mr-1.5" />
              New Template
            </Button>
          </Link>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="size-8 animate-spin text-ink-muted" />
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-12 text-ink-muted/40" />}
          title="No document templates created yet"
          description="Create your first document template with our AI-powered studio to customize invoice and quote branding."
          action={
            <Link href="/settings/document-templates/new">
              <Button variant="primary">
                <Plus className="size-4 mr-1.5" />
                Create First Template
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((tmpl) => {
            const primaryColor = tmpl.config?.branding?.primaryColor || '#1e3a8a';
            const secondaryColor = tmpl.config?.branding?.secondaryColor || '#64748b';
            const fontFamily = tmpl.config?.branding?.fontFamily || 'Helvetica';
            const density = tmpl.config?.branding?.layoutDensity || 'normal';

            return (
              <Card key={tmpl.id} className="flex flex-col justify-between hover:border-border transition-all shadow-xs">
                <div>
                  <CardHeader className="flex items-start justify-between gap-3 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/settings/document-templates/${tmpl.id}`}
                          className="font-bold text-ink hover:text-brand transition-colors text-base"
                        >
                          {tmpl.name}
                        </Link>
                      </div>
                      {tmpl.description && (
                        <p className="text-xs text-ink-muted mt-1 line-clamp-2">{tmpl.description}</p>
                      )}
                    </div>
                    {tmpl.isDefault && (
                      <Badge tone="brand" className="shrink-0 flex items-center gap-1">
                        <CheckCircle2 className="size-3" />
                        Default
                      </Badge>
                    )}
                  </CardHeader>

                  <CardBody className="py-3 space-y-4">
                    {/* Visual Styling Indicators */}
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-surface-muted/30 border border-border/30">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center -space-x-1">
                          <span
                            className="size-5 rounded-full border border-white shadow-xs inline-block"
                            style={{ backgroundColor: primaryColor }}
                            title={`Primary: ${primaryColor}`}
                          />
                          <span
                            className="size-5 rounded-full border border-white shadow-xs inline-block"
                            style={{ backgroundColor: secondaryColor }}
                            title={`Secondary: ${secondaryColor}`}
                          />
                        </div>
                        <div className="text-[11px] font-mono text-ink-muted">
                          <span>{primaryColor}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-ink-muted font-medium">
                        <span>{fontFamily}</span>
                        <span>•</span>
                        <span className="capitalize">{density}</span>
                      </div>
                    </div>

                    {/* Applies To Document Badges */}
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle mb-1.5">
                        Applies To:
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {tmpl.appliesTo && tmpl.appliesTo.length > 0 ? (
                          tmpl.appliesTo.map((type) => (
                            <span
                              key={type}
                              className="rounded-md bg-surface-muted/60 px-2 py-0.5 text-[10px] font-medium text-ink-muted border border-border/20"
                            >
                              {type.replace('_', ' ')}
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-ink-subtle italic">None specified</span>
                        )}
                      </div>
                    </div>
                  </CardBody>
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-between border-t border-border/25 px-6 py-3 bg-surface-muted/10 rounded-b-2xl">
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openSetDefaultDialog(tmpl)}
                      title="Set as default template"
                      className="text-xs h-8 px-2"
                    >
                      <Star className="size-3.5 mr-1" />
                      Make Default
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteModalTemplate(tmpl)}
                      className="text-xs h-8 w-8 p-0 text-danger hover:text-danger hover:bg-danger-soft/20"
                      title="Delete template"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>

                    <Link href={`/settings/document-templates/${tmpl.id}`}>
                      <Button variant="outline" size="sm" className="text-xs h-8">
                        <Edit3 className="size-3.5 mr-1" />
                        Edit Studio
                      </Button>
                    </Link>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Set Default Dialog */}
      <Dialog
        open={Boolean(defaultModalTemplate)}
        onClose={() => setDefaultModalTemplate(null)}
        title="Set as Default Template"
        description={`Choose which document types "${defaultModalTemplate?.name}" should be used for by default:`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDefaultModalTemplate(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmDefault}
              loading={isSettingDefault}
              disabled={selectedDefaultTypes.length === 0}
            >
              Confirm Default
            </Button>
          </div>
        }
      >
        <div className="space-y-2 py-2">
          {ALL_DOCUMENT_TYPES.map(({ type, label }) => {
            const isChecked = selectedDefaultTypes.includes(type);
            return (
              <label
                key={type}
                className="flex items-center justify-between p-2.5 rounded-xl border border-border/30 hover:bg-surface-muted/30 cursor-pointer transition-colors"
              >
                <span className="text-xs font-medium text-ink">{label}</span>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleDefaultType(type)}
                  className="rounded border-border text-brand focus:ring-brand size-4 cursor-pointer"
                />
              </label>
            );
          })}
        </div>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteModalTemplate)}
        onClose={() => setDeleteModalTemplate(null)}
        title="Delete Document Template"
        description={`Are you sure you want to delete template "${deleteModalTemplate?.name}"? Any documents using this template will fall back to default styling.`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteModalTemplate(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmDelete}
              loading={isDeleting}
            >
              Delete Template
            </Button>
          </div>
        }
      >
        <p className="text-xs text-ink-muted py-2">
          This action cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}
