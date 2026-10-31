'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { FileCheck, Lock, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuoteTabsSectionProps {
  termsAndConditions: string | null | undefined;
  notes: string | null | undefined;
  onChangeTerms: (terms: string) => void;
  onChangeNotes: (notes: string) => void;
  readOnly?: boolean;
}

type ActiveTab = 'terms' | 'notes';

const TABS: Array<{ key: ActiveTab; label: string }> = [
  { key: 'terms', label: 'Terms and conditions' },
  { key: 'notes', label: 'Internal notes' },
];

const FIELD =
  'w-full rounded-xl border border-border-control bg-surface-muted/30 p-3 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:bg-surface focus:border-brand-ring focus:ring-1 focus:ring-brand-ring focus:outline-hidden transition-colors';
// The read-only stand-in for the field above: a value, not a card.
const READ_ONLY = 'min-h-28 whitespace-pre-wrap py-1 text-sm leading-relaxed text-ink';

export function QuoteTabsSection({
  termsAndConditions,
  notes,
  onChangeTerms,
  onChangeNotes,
  readOnly = false,
}: QuoteTabsSectionProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('terms');
  const id = useId();
  const tabRefs = useRef<Record<ActiveTab, HTMLButtonElement | null>>({ terms: null, notes: null });

  // Arrow keys move between tabs, as the tab pattern expects.
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next: ActiveTab = activeTab === 'terms' ? 'notes' : 'terms';
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="bg-surface rounded-2xl border border-border/60 overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.015)]">
      <div
        role="tablist"
        aria-label="Terms and notes"
        onKeyDown={onTabKeyDown}
        className="flex border-b border-border/60 bg-surface-muted/20 px-2 sm:px-4"
      >
        {TABS.map((tab) => {
          const selected = activeTab === tab.key;
          const filled = tab.key === 'terms' ? Boolean(termsAndConditions) : Boolean(notes);
          const Icon = tab.key === 'terms' ? FileCheck : Lock;
          return (
            <button
              key={tab.key}
              ref={(element) => {
                tabRefs.current[tab.key] = element;
              }}
              type="button"
              role="tab"
              id={`${id}-${tab.key}-tab`}
              aria-selected={selected}
              aria-controls={`${id}-${tab.key}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors cursor-pointer sm:px-4',
                selected ? 'border-brand text-ink font-semibold' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span>{tab.label}</span>
              {/* The dot is for the eye; a screen reader hears only the gap, which is the news. */}
              {filled ? (
                <span className="size-1.5 rounded-full bg-ink-subtle" aria-hidden />
              ) : (
                <span className="sr-only">, empty</span>
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${id}-${activeTab}-panel`}
        aria-labelledby={`${id}-${activeTab}-tab`}
        className="p-4 sm:p-5"
      >
        {activeTab === 'terms' ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={`${id}-terms`} className="text-sm font-medium text-ink">
                Terms the customer sees
              </label>
              <span className="flex items-center gap-1 text-xs text-ink-muted">
                <Info className="size-3.5" aria-hidden />
                Printed on the quote and shown on the customer&apos;s link
              </span>
            </div>

            {readOnly ? (
              <div className={READ_ONLY}>
                {termsAndConditions || <span className="text-ink-muted">No terms set.</span>}
              </div>
            ) : (
              <textarea
                id={`${id}-terms`}
                value={termsAndConditions || ''}
                onChange={(e) => onChangeTerms(e.target.value)}
                placeholder="Lead time, artwork approval, overs and unders, delivery and payment terms"
                rows={4}
                className={FIELD}
              />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={`${id}-notes`} className="text-sm font-medium text-ink">
                Notes for the team
              </label>
              <span className="flex items-center gap-1 text-xs font-medium text-ink-muted">
                <Lock className="size-3.5" aria-hidden />
                Never shown to the customer
              </span>
            </div>

            {readOnly ? (
              <div className={READ_ONLY}>
                {notes || <span className="text-ink-muted">No notes.</span>}
              </div>
            ) : (
              <textarea
                id={`${id}-notes`}
                value={notes || ''}
                onChange={(e) => onChangeNotes(e.target.value)}
                placeholder="How you priced it, what the customer pushed back on, who signed off the discount"
                rows={4}
                className={FIELD}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
