'use client';

import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';

// Mirrors CrmMutateConfig in apps/api/src/modules/automations/workflows/interfaces.ts
// and the keys createContactSchema accepts.
const ENTITIES = [
  { value: 'contact', label: 'Contact' },
  { value: 'quote', label: 'Quote' },
] as const;

const ACTIONS: Record<string, { value: string; label: string }[]> = {
  contact: [
    { value: 'create', label: 'Create' },
    { value: 'update', label: 'Update' },
  ],
  quote: [
    { value: 'approve', label: 'Approve' },
    { value: 'reject', label: 'Reject' },
  ],
};

export const CONTACT_FIELD_KEYS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'company',
  'jobTitle',
  'notes',
  'status',
  'source',
  'ownerId',
] as const;

const selectClass =
  'w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink font-semibold bg-surface-muted';
const inputClass =
  'w-full rounded-lg border border-border px-3 py-1.5 text-xs font-mono text-ink focus:border-brand focus:outline-none';

type FieldRow = [key: string, value: string];

function rowsOf(fields: unknown): FieldRow[] {
  return fields && typeof fields === 'object'
    ? Object.entries(fields as Record<string, string>).map(([k, v]) => [k, v ?? ''])
    : [];
}

/**
 * Only filled-in rows reach config.fields: a blank value would otherwise be
 * sent as "" and clear that field on the contact.
 */
function fieldsOf(rows: FieldRow[]): Record<string, string> {
  return Object.fromEntries(rows.filter(([, v]) => v !== ''));
}

function sameFields(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
}

export interface CrmStepFieldsProps {
  config: Record<string, any>;
  onChange: (config: Record<string, any>) => void;
}

export function CrmStepFields({ config, onChange }: CrmStepFieldsProps) {
  const entity: string = ENTITIES.some((e) => e.value === config.entity) ? config.entity : '';
  const actions = ACTIONS[entity] ?? [];
  const action: string = actions.some((a) => a.value === config.action) ? config.action : '';

  // Rows live here so a blank row can stay on screen without being written.
  const [rows, setRows] = useState<FieldRow[]>(() => rowsOf(config.fields));
  // Picks up a change made elsewhere (an undo, say); our own writes match the
  // filled-in rows and leave blank rows alone.
  const [syncedFields, setSyncedFields] = useState<unknown>(config.fields);
  if (config.fields !== syncedFields) {
    setSyncedFields(config.fields);
    const incoming = rowsOf(config.fields);
    if (!sameFields(fieldsOf(rows), Object.fromEntries(incoming))) setRows(incoming);
  }

  const usedKeys = new Set(rows.map(([k]) => k));
  const unusedKeys = CONTACT_FIELD_KEYS.filter((k) => !usedKeys.has(k));

  const needsRecordId = action === 'update' || entity === 'quote';
  const usesFields = entity === 'contact' && (action === 'create' || action === 'update');

  const setFieldRows = (next: FieldRow[]) => {
    setRows(next);
    onChange({ ...config, fields: fieldsOf(next) });
  };

  const handleEntity = (value: string) => {
    // Fields and reason belong to a specific entity/action; carry neither over.
    const { fields: _f, reason: _r, ...rest } = config;
    setRows([]);
    onChange({ ...rest, entity: value, action: '' });
  };

  const handleAction = (value: string) => {
    const next: Record<string, any> = { ...config, action: value };
    if (value !== 'reject') delete next.reason;
    if (!(value === 'update' || entity === 'quote')) delete next.recordId;
    onChange(next);
  };

  return (
    <div className="space-y-3 pt-2 border-t border-border/40">
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-ink">Entity</label>
        <select
          data-testid="crm-entity-select"
          value={entity}
          onChange={(e) => handleEntity(e.target.value)}
          className={selectClass}
        >
          <option value="">Choose…</option>
          {ENTITIES.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-ink">Action</label>
        <select
          data-testid="crm-action-select"
          value={action}
          onChange={(e) => handleAction(e.target.value)}
          className={selectClass}
        >
          <option value="">Choose…</option>
          {actions.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      {needsRecordId && (
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-ink">Record ID</label>
          <input
            type="text"
            data-testid="crm-record-id-input"
            value={config.recordId || ''}
            onChange={(e) => onChange({ ...config, recordId: e.target.value })}
            placeholder="{{ $trigger.payload.id }}"
            className={inputClass}
          />
        </div>
      )}

      {entity === 'quote' && action === 'reject' && (
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-ink">Reason</label>
          <input
            type="text"
            data-testid="crm-reason-input"
            value={config.reason || ''}
            onChange={(e) => onChange({ ...config, reason: e.target.value })}
            placeholder="Why the quote is being rejected"
            className={inputClass}
          />
        </div>
      )}

      {usesFields && (
        <div className="space-y-2">
          <label className="text-[11px] font-medium text-ink">Contact fields</label>
          {rows.map(([key, value], i) => (
            <div key={key} className="flex items-center gap-1.5">
              <select
                data-testid={`crm-field-key-${i}`}
                value={key}
                onChange={(e) =>
                  setFieldRows(rows.map(([k, v], j): FieldRow => (j === i ? [e.target.value, v] : [k, v])))
                }
                className="w-28 shrink-0 rounded-lg border border-border px-2 py-1.5 text-xs text-ink bg-surface-muted"
              >
                {[key, ...unusedKeys].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <input
                type="text"
                data-testid={`crm-field-value-${i}`}
                value={value ?? ''}
                onChange={(e) =>
                  setFieldRows(rows.map(([k, v], j): FieldRow => (j === i ? [k, e.target.value] : [k, v])))
                }
                placeholder="Value or {{ expression }}"
                className={inputClass}
              />
              <button
                type="button"
                data-testid={`crm-remove-field-${i}`}
                onClick={() => setFieldRows(rows.filter((_, j) => j !== i))}
                className="p-1 rounded text-ink-subtle hover:text-danger cursor-pointer"
                title="Remove field"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {unusedKeys.length > 0 && (
            <button
              type="button"
              data-testid="crm-add-field-btn"
              onClick={() => setFieldRows([...rows, [unusedKeys[0], '']])}
              className="flex items-center gap-1 text-[11px] font-semibold text-ink hover:underline cursor-pointer"
            >
              <Plus className="h-3 w-3" />
              Add field
            </button>
          )}
        </div>
      )}
    </div>
  );
}
