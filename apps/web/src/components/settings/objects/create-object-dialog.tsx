'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateCustomObjectPayload, CustomObjectDefinitionDto } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/field';
import { Button } from '@/components/ui/button';

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface CreateObjectDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (created: CustomObjectDefinitionDto) => void;
}

export function CreateObjectDialog({ open, onClose, onSuccess }: CreateObjectDialogProps) {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [singularName, setSingularName] = useState('');
  const [slug, setSlug] = useState('');
  const [primaryAttributeSlug, setPrimaryAttributeSlug] = useState('name');
  const [description, setDescription] = useState('');
  const [isSlugTouched, setIsSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setName('');
      setSingularName('');
      setSlug('');
      setPrimaryAttributeSlug('name');
      setDescription('');
      setIsSlugTouched(false);
      setErrors({});
    }
  }, [open]);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!isSlugTouched) {
      setSlug(slugify(val));
    }
  };

  const createMutation = useMutation({
    mutationFn: (payload: CreateCustomObjectPayload) => api.customObjects.create(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customObjects.all });
      toast.success('Custom object created');
      onSuccess?.(data);
      onClose();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to create custom object';
      toast.error(msg);
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Plural name is required';
    if (!singularName.trim()) newErrors.singularName = 'Singular name is required';
    if (!slug.trim()) {
      newErrors.slug = 'Slug is required';
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) {
      newErrors.slug = 'Slug must be lowercase alphanumeric with hyphens';
    }
    if (!primaryAttributeSlug.trim()) {
      newErrors.primaryAttributeSlug = 'Primary attribute slug is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    createMutation.mutate({
      name: name.trim(),
      singularName: singularName.trim(),
      slug: slug.trim(),
      primaryAttributeSlug: primaryAttributeSlug.trim(),
      description: description.trim() || undefined,
      icon: 'Box',
    });
  };

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create Custom Object"
      description="Define a new entity type in your system schema."
      footer={
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-object-form"
            loading={createMutation.isPending}
            disabled={createMutation.isPending}
          >
            Create Object
          </Button>
        </div>
      }
    >
      <form id="create-object-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          id="object-plural-name"
          label="Plural Name"
          placeholder="e.g. Vehicles"
          required
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          error={errors.name}
          hint="How this entity is labeled in collections"
        />

        <Input
          id="object-singular-name"
          label="Singular Name"
          placeholder="e.g. Vehicle"
          required
          value={singularName}
          onChange={(e) => setSingularName(e.target.value)}
          error={errors.singularName}
          hint="Label used when referring to a single record"
        />

        <Input
          id="object-slug"
          label="Slug"
          placeholder="e.g. vehicles"
          required
          value={slug}
          onChange={(e) => {
            setIsSlugTouched(true);
            setSlug(e.target.value);
          }}
          error={errors.slug}
          hint="URL and API identifier, lowercase and hyphen-separated"
        />

        <Input
          id="object-primary-attribute"
          label="Primary Title Attribute Slug"
          placeholder="e.g. name"
          required
          value={primaryAttributeSlug}
          onChange={(e) => setPrimaryAttributeSlug(e.target.value)}
          error={errors.primaryAttributeSlug}
          hint="The attribute that serves as the title/header for records"
        />

        <Textarea
          id="object-description"
          label="Description"
          placeholder="Optional explanation of what this object represents"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </form>
    </Dialog>
  );
}
