'use client';

import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { ListPlus, X } from 'lucide-react';
import clsx from 'clsx';
import { codeText, dataChips, friendlyText, hasPlaceholder, previewText, type DataGroup } from '../step-wording';

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

// The field and the layer that draws its text must lay their text out identically.
const textClass = 'w-full rounded-lg border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words';

/**
 * A text field that can take values from earlier steps. "Insert data" lists
 * them by their plain names and drops the chosen one in at the cursor, where
 * it shows as a chip with that name: "Quote total". What is stored is still
 * the `{{ … }}` placeholder the run fills in; the field holds `{{Quote
 * total}}` and a layer under it draws the chip, so it stays an ordinary text
 * box to type in. The line underneath shows how the text will read with
 * sample values. A placeholder typed by hand works exactly as before.
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
  const controlRef = useRef<HTMLTextAreaElement | null>(null);
  const touched = useRef(false);
  const lastCaret = useRef(0);
  const [open, setOpen] = useState(false);
  const hasData = groups.some((g) => g.items.length > 0);

  // What the box holds: the stored text with chip names in place of code.
  const shown = friendlyText(value, groups);
  const chips = dataChips(shown, groups);

  const update = (next: string, caret?: number) => {
    const code = codeText(next, groups);
    onChange(code);
    const el = controlRef.current;
    // A placeholder typed out by hand turns into its chip, which is shorter; keep the caret after it.
    const shorter = next.length - friendlyText(code, groups).length;
    if (caret === undefined && shorter > 0 && el) caret = Math.max(0, el.selectionStart - shorter);
    if (caret === undefined) return;
    lastCaret.current = caret;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const insert = (expression: string) => {
    const el = controlRef.current;
    const named = friendlyText(`{{ ${expression} }}`, groups);
    // A field nobody has clicked into reports its caret at the start; the value belongs at the end.
    const placed = touched.current && el;
    const start = placed ? (el.selectionStart ?? shown.length) : shown.length;
    const end = placed ? (el.selectionEnd ?? shown.length) : shown.length;
    const before = shown.slice(0, start);
    const after = shown.slice(end);
    // A space keeps the value apart from the word before it.
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    setOpen(false);
    update(`${before}${lead}${named}${after}`, before.length + lead.length + named.length);
  };

  // A chip is one thing: Backspace or Delete beside or inside it removes all of it.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!multiline && e.key === 'Enter') {
      e.preventDefault();
      return;
    }
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const caret = el.selectionStart;
    const chip = chips.find((c) =>
      e.key === 'Backspace' ? caret > c.start && caret <= c.end : caret >= c.start && caret < c.end,
    );
    if (!chip) return;
    e.preventDefault();
    update(shown.slice(0, chip.start) + shown.slice(chip.end), chip.start);
  };

  // The caret never rests inside a chip: it steps over it, or lands on the nearer side.
  const onSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const caret = el.selectionStart;
    if (caret !== el.selectionEnd) return;
    const chip = chips.find((c) => caret > c.start && caret < c.end);
    const from = lastCaret.current;
    let to = caret;
    if (chip) {
      if (from >= chip.end) to = chip.start;
      else if (from <= chip.start) to = chip.end;
      else to = caret - chip.start < chip.end - caret ? chip.start : chip.end;
      el.setSelectionRange(to, to);
    }
    lastCaret.current = to;
  };

  // The box grows with its text, so the chip layer never has to scroll with it.
  useLayoutEffect(() => {
    const el = controlRef.current;
    if (!el || !el.scrollHeight) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [shown]);

  const pieces: React.ReactNode[] = [];
  let at = 0;
  chips.forEach((chip) => {
    pieces.push(shown.slice(at, chip.start));
    pieces.push(
      <span
        key={chip.start}
        data-testid={`${testId}-chip`}
        className="rounded bg-brand-soft box-decoration-clone ring-1 ring-inset ring-border"
      >
        <span className="text-transparent">{'{{'}</span>
        {chip.name}
        <span className="text-transparent">{'}}'}</span>
      </span>,
    );
    at = chip.end;
  });
  pieces.push(shown.slice(at));

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

      <div className="relative">
        <div
          aria-hidden
          data-testid={`${testId}-shown`}
          className={clsx(textClass, 'absolute inset-0 overflow-hidden border-transparent text-ink pointer-events-none')}
        >
          {pieces}
        </div>
        <textarea
          id={id}
          ref={controlRef}
          data-testid={testId}
          value={shown}
          placeholder={placeholder}
          rows={multiline ? rows : 1}
          onFocus={() => {
            touched.current = true;
          }}
          aria-label={labelSlot ? label : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => update(multiline ? e.target.value : e.target.value.replace(/[\r\n]+/g, ' '))}
          onKeyDown={onKeyDown}
          onSelect={onSelect}
          className={clsx(
            textClass,
            // Its own text is see-through: the layer underneath draws the words and the chips.
            'relative block resize-none overflow-hidden bg-transparent text-transparent caret-ink placeholder:text-ink-subtle focus:outline-none',
            invalid ? 'border-danger focus:border-danger' : 'border-border focus:border-brand',
          )}
        />
      </div>

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
