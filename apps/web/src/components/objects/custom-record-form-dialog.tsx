'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { CustomAttributeDefinitionDto } from '@saas/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/primitives';

export interface CustomRecordFormDialogProps {
  open: boolean;
  onClose: () => void;
  attributes: CustomAttributeDefinitionDto[];
  onSubmit: (values: Record<string, any>) => Promise<void>;
}

export function CustomRecordFormDialog({
  open,
  onClose,
  attributes,
  onSubmit,
}: CustomRecordFormDialogProps) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setValues({});
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await onSubmit(values);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save record';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="New Record">
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        {error && <Alert tone="danger">{error}</Alert>}

        {attributes.map((attr) => {
          const fieldId = `attr-${attr.slug}`;
          const labelText = `${attr.name}${attr.isRequired ? ' *' : ''}`;

          if (attr.type === 'number' || attr.type === 'currency') {
            return (
              <Input
                key={attr.id}
                id={fieldId}
                label={labelText}
                type="number"
                value={values[attr.slug] ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setValues((prev) => ({
                    ...prev,
                    [attr.slug]: val === '' ? undefined : Number(val),
                  }));
                }}
                required={attr.isRequired}
              />
            );
          }

          if (attr.type === 'boolean') {
            return (
              <div key={attr.id} className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id={fieldId}
                  checked={Boolean(values[attr.slug])}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [attr.slug]: e.target.checked }))
                  }
                  className="size-4 rounded border-border/80 text-brand focus:ring-brand"
                />
                <label htmlFor={fieldId} className="text-sm font-medium text-ink cursor-pointer">
                  {labelText}
                </label>
              </div>
            );
          }

          if (attr.type === 'select' && attr.options && attr.options.length > 0) {
            return (
              <Select
                key={attr.id}
                id={fieldId}
                label={labelText}
                placeholder={`Select ${attr.name}`}
                value={values[attr.slug] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [attr.slug]: e.target.value }))
                }
                required={attr.isRequired}
                options={attr.options}
              />
            );
          }

          if (attr.type === 'multiselect' && attr.options && attr.options.length > 0) {
            return (
              <div key={attr.id} className="space-y-1.5">
                <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
                  {labelText}
                </label>
                <select
                  id={fieldId}
                  multiple
                  value={values[attr.slug] ?? []}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, (opt) => opt.value);
                    setValues((prev) => ({ ...prev, [attr.slug]: selected }));
                  }}
                  className="w-full rounded-xl border border-border/80 bg-surface px-3 py-2 text-sm text-ink"
                  required={attr.isRequired}
                >
                  {attr.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          return (
            <Input
              key={attr.id}
              id={fieldId}
              type={attr.type === 'email' ? 'email' : attr.type === 'date' ? 'date' : 'text'}
              label={labelText}
              value={values[attr.slug] ?? ''}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [attr.slug]: e.target.value }))
              }
              required={attr.isRequired}
            />
          );
        })}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={loading} disabled={loading}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
