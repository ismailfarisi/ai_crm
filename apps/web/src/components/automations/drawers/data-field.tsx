'use client';

import React, { useId, useRef, useState } from 'react';
import { ListPlus, X } from 'lucide-react';
import clsx from 'clsx';
import { hasPlaceholder, previewText, type DataGroup } from '../step-wording';

export interface DataFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** What earlier steps make available; see `availableData`. */
  groups: DataGroup[];
  testId: string;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  /** Shown in place of the label, for a field whose name is itself a choice. */
  labelSlot?: React.ReactNode;
  /** Marks the field as needing attention; `describedBy` is the id of the message saying why. */
  invalid?: boolean;
  describedBy?: string;
}

const controlClass =
  'w-full rounded-lg border border-border px-3 py-2 text-xs text-ink focus:border-brand focus:outline-none';

/**
 * A text field that can take values from earlier steps. "Insert data" lists
 * them by their plain names and drops the chosen one in at the cursor as a
 * `{{ … }}` placeholder; the line underneath shows how the text will read
 * with sample values. Typing a placeholder by hand works exactly as before.
 */
export function DataField({
  label,
  value,
  onChange,
  groups,
  testId,
  multiline = false,
  rows = 4,
  placeholder,
  hint,
  icon,
  labelSlot,
  invalid = false,
  describedBy,
}: DataFieldProps) {
  const id = useId();
  const controlRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const touched = useRef(false);
  const [open, setOpen] = useState(false);
  const hasData = groups.some((g) => g.items.length > 0);

  const insert = (expression: string) => {
    const el = controlRef.current;
    const token = `{{ ${expression} }}`;
    // A field nobody has clicked into reports its caret at the start; the value belongs at the end.
    const placed = touched.current && el;
    const start = placed ? (el.selectionStart ?? value.length) : value.length;
    const end = placed ? (el.selectionEnd ?? value.length) : value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    // A space keeps the value apart from the word before it.
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const next = `${before}${lead}${token}${after}`;
    onChange(next);
    setOpen(false);
    const caret = before.length + lead.length + token.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const shared = {
    id,
    'data-testid': testId,
    value,
    placeholder,
    onFocus: () => {
      touched.current = true;
    },
    'aria-label': labelSlot ? label : undefined,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        {labelSlot ?? (
          <label htmlFor={id} className="text-[11px] font-medium text-ink flex items-center gap-1">
            {icon}
            {label}
          </label>
        )}
        {hasData && (
          <button
            type="button"
            data-testid={`${testId}-insert-data`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-ink hover:bg-surface-muted cursor-pointer"
          >
            {open ? <X aria-hidden className="h-3 w-3" /> : <ListPlus aria-hidden className="h-3 w-3" />}
            {open ? 'Close' : 'Insert data'}
          </button>
        )}
      </div>

      {multiline ? (
        <textarea
          {...shared}
          ref={controlRef as React.RefObject<HTMLTextAreaElement>}
          rows={rows}
          className={clsx(controlClass, 'resize-none leading-relaxed', invalid && 'border-danger focus:border-danger')}
        />
      ) : (
        <input {...shared} ref={controlRef as React.RefObject<HTMLInputElement>} type="text" className={controlClass} />
      )}

      {open && (
        <div
          data-testid={`${testId}-data-list`}
          className="max-h-56 overflow-y-auto rounded-lg border border-border bg-surface shadow-sm"
        >
          {groups
            .filter((g) => g.items.length > 0)
            .map((group) => (
              <div key={group.id}>
                <div className="sticky top-0 bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-ink-muted">
                  From: {group.title}
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.expression}
                    type="button"
                    data-testid={`${testId}-data-${item.expression}`}
                    onClick={() => insert(item.expression)}
                    className="flex w-full items-baseline justify-between gap-3 px-2.5 py-1.5 text-left text-xs hover:bg-brand-soft/60 cursor-pointer"
                  >
                    <span className="font-medium text-ink">{item.label}</span>
                    {item.sample !== undefined && (
                      <span className="truncate text-[11px] text-ink-subtle">e.g. {String(item.sample)}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}

      {hasPlaceholder(value) && (
        <p data-testid={`${testId}-preview`} className="text-[11px] text-ink-muted break-words">
          <span className="font-semibold">Example:</span> {previewText(value, groups)}
        </p>
      )}
      {hint && <p className="text-[11px] text-ink-subtle">{hint}</p>}
    </div>
  );
}
