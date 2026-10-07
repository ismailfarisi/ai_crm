'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CUSTOM_ATTRIBUTE_TYPES,
  type CustomAttributeType,
  type CustomObjectDefinitionDto,
  type CreateCustomAttributePayload,
} from '@saas/shared';
import { X, Trash2, Plus } from 'lucide-react';
import { api, queryKeys } from '@/lib/api/endpoints';
import { useCustomObject } from '@/hooks/use-custom-objects';
import { Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { slugify } from './create-object-dialog';

export interface AttributeEditorDrawerProps {
  object: CustomObjectDefinitionDto | null;
  open?: boolean;
  onClose: () => void;
}

export function AttributeEditorDrawer({
  object,
  open: controlledOpen,
  onClose,
}: AttributeEditorDrawerProps) {
  const queryClient = useQueryClient();
  const isOpen = controlledOpen !== undefined ? controlledOpen : Boolean(object);

  // Fetch live object details if available
  const { data: liveObject } = useCustomObject(object?.slug ?? '');
  const currentObject = liveObject ?? object;

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState<CustomAttributeType>('text');
  const [isRequired, setIsRequired] = useState(false);
  const [isUnique, setIsUnique] = useState(false);
  const [optionsStr, setOptionsStr] = useState('');
  const [isSlugTouched, setIsSlugTouched] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const resetNewAttributeForm = () => {
    setName('');
    setSlug('');
    setType('text');
    setIsRequired(false);
    setIsUnique(false);
    setOptionsStr('');
    setIsSlugTouched(false);
    setFormErrors({});
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!isSlugTouched) {
      setSlug(slugify(val));
    }
  };

  const addAttributeMutation = useMutation({
    mutationFn: (payload: CreateCustomAttributePayload) => {
      if (!currentObject) throw new Error('No object selected');
      return api.customObjects.addAttribute(currentObject.slug, payload);
    },
    onSuccess: () => {
      if (!currentObject) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.customObjects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.customObjects.bySlug(currentObject.slug) });
      toast.success('Attribute added');
      resetNewAttributeForm();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to add attribute';
      toast.error(msg);
    },
  });

  const deleteAttributeMutation = useMutation({
    mutationFn: (attrSlug: string) => {
      if (!currentObject) throw new Error('No object selected');
      return api.customObjects.deleteAttribute(currentObject.slug, attrSlug);
    },
    onSuccess: () => {
      if (!currentObject) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.customObjects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.customObjects.bySlug(currentObject.slug) });
      toast.success('Attribute deleted');
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to delete attribute';
      toast.error(msg);
    },
  });

  if (!isOpen || !currentObject) return null;

  const attributes = currentObject.attributes ?? [];

  const handleAddAttribute = (e: FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};

    if (!name.trim()) errors.name = 'Attribute name is required';
    if (!slug.trim()) {
      errors.slug = 'Slug is required';
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) {
      errors.slug = 'Slug must be lowercase alphanumeric with hyphens';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setFormErrors({});

    let options: { label: string; value: string }[] | undefined;
    if (type === 'select' || type === 'multiselect') {
      options = optionsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((opt) => ({
          label: opt,
          value: slugify(opt) || opt.toLowerCase(),
        }));
    }

    addAttributeMutation.mutate({
      name: name.trim(),
      slug: slug.trim(),
      type,
      isRequired,
      isUnique,
      isSearchable: true,
      options,
      sortOrder: attributes.length,
    });
  };

  const typeOptions = CUSTOM_ATTRIBUTE_TYPES.map((t) => ({
    value: t,
    label: t.charAt(0).toUpperCase() + t.slice(1),
  }));

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <aside className="flex w-screen max-w-lg flex-col border-l border-border/30 bg-surface shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/25 px-6 py-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-ink">
                {currentObject.name} Fields
              </h2>
              <p className="mt-0.5 font-mono text-xs text-ink-subtle">
                /{currentObject.slug}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="rounded-full p-1.5 text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Existing attributes list */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-ink">
                  Configured Attributes ({attributes.length})
                </h3>
              </div>

              {attributes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/50 p-4 text-center text-xs text-ink-muted">
                  No attributes configured yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {attributes.map((attr) => {
                    const isPrimary = attr.slug === currentObject.primaryAttributeSlug;
                    return (
                      <div
                        key={attr.id || attr.slug}
                        className="flex items-center justify-between rounded-xl border border-border/40 bg-surface-muted/30 p-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-ink">{attr.name}</span>
                            <span className="font-mono text-xs text-ink-subtle">
                              ({attr.slug})
                            </span>
                            {isPrimary && (
                              <Badge tone="brand" className="text-[10px]">
                                Primary
                              </Badge>
                            )}
                            {attr.isRequired && (
                              <Badge tone="neutral" className="text-[10px]">
                                Required
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-ink-muted">
                            <span className="inline-block rounded bg-surface px-1.5 py-0.5 border border-border/40 text-[11px] font-mono">
                              {attr.type}
                            </span>
                            {attr.options && attr.options.length > 0 && (
                              <span>{attr.options.length} options</span>
                            )}
                          </div>
                        </div>

                        {!isPrimary && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete attribute ${attr.name}`}
                            data-testid={`delete-attribute-${attr.slug}`}
                            disabled={deleteAttributeMutation.isPending}
                            onClick={() => deleteAttributeMutation.mutate(attr.slug)}
                            className="text-danger hover:text-danger-hover"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Add new attribute form */}
            <div className="rounded-2xl border border-border/40 bg-surface-muted/20 p-4 space-y-4">
              <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                <Plus className="size-4 text-brand" />
                Add New Attribute
              </h3>

              <form onSubmit={handleAddAttribute} className="space-y-3.5">
                <Input
                  id="attribute-name"
                  label="Attribute Name"
                  placeholder="e.g. Fuel Type"
                  required
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  error={formErrors.name}
                />

                <Input
                  id="attribute-slug"
                  label="Attribute Slug"
                  placeholder="e.g. fuel-type"
                  required
                  value={slug}
                  onChange={(e) => {
                    setIsSlugTouched(true);
                    setSlug(e.target.value);
                  }}
                  error={formErrors.slug}
                  hint="Lowercase, hyphen-separated field key"
                />

                <Select
                  id="attribute-type"
                  label="Attribute Type"
                  value={type}
                  onChange={(e) => setType(e.target.value as CustomAttributeType)}
                  options={typeOptions}
                />

                {(type === 'select' || type === 'multiselect') && (
                  <Input
                    id="attribute-options"
                    label="Options (comma-separated)"
                    placeholder="e.g. Electric, Hybrid, Petrol, Diesel"
                    value={optionsStr}
                    onChange={(e) => setOptionsStr(e.target.value)}
                    hint="Values will be automatically generated from labels"
                  />
                )}

                <div className="flex items-center gap-4 pt-1">
                  <label className="flex items-center gap-2 text-xs font-medium text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isRequired}
                      onChange={(e) => setIsRequired(e.target.checked)}
                      className="rounded border-border/80 text-brand focus:ring-brand"
                    />
                    Required field
                  </label>

                  <label className="flex items-center gap-2 text-xs font-medium text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isUnique}
                      onChange={(e) => setIsUnique(e.target.checked)}
                      className="rounded border-border/80 text-brand focus:ring-brand"
                    />
                    Unique value
                  </label>
                </div>

                <div className="pt-2">
                  <Button
                    type="submit"
                    size="sm"
                    loading={addAttributeMutation.isPending}
                    disabled={addAttributeMutation.isPending}
                    className="w-full"
                  >
                    Add Attribute
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
