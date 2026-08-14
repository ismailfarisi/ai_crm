'use client';

import { useState } from 'react';
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

export function QuoteTabsSection({
  termsAndConditions,
  notes,
  onChangeTerms,
  onChangeNotes,
  readOnly = false,
}: QuoteTabsSectionProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('terms');

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
      {/* Tabs Header */}
      <div className="flex border-b border-border bg-surface-muted/30 px-4">
        <button
          type="button"
          onClick={() => setActiveTab('terms')}
          className={cn(
            'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
            activeTab === 'terms'
              ? 'border-brand text-brand font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          <FileCheck className="size-4" />
          <span>Terms & Conditions</span>
          {termsAndConditions && (
            <span className="size-1.5 rounded-full bg-brand" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('notes')}
          className={cn(
            'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
            activeTab === 'notes'
              ? 'border-brand text-brand font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          <Lock className="size-4 text-amber-500" />
          <span>Internal Notes</span>
          {notes && (
            <span className="size-1.5 rounded-full bg-amber-500" />
          )}
        </button>
      </div>

      {/* Tab Contents */}
      <div className="p-5">
        {activeTab === 'terms' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                Client-Facing Terms & Delivery Conditions
              </label>
              <span className="text-xs text-ink-subtle flex items-center gap-1">
                <Info className="size-3.5" />
                Visible to customer on PDF / Print
              </span>
            </div>

            {readOnly ? (
              <div className="min-h-28 rounded-lg border border-border bg-surface-muted/30 p-3.5 text-sm leading-relaxed text-ink whitespace-pre-wrap">
                {termsAndConditions || (
                  <span className="text-ink-subtle italic">No terms specified.</span>
                )}
              </div>
            ) : (
              <textarea
                value={termsAndConditions || ''}
                onChange={(e) => onChangeTerms(e.target.value)}
                placeholder="Specify delivery timeline, payment milestones, scope boundaries, or warranty conditions..."
                rows={4}
                className="w-full rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden"
              />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                Internal Sales & Review Notes
              </label>
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <Lock className="size-3.5" />
                Confidential — Internal Team Only
              </span>
            </div>

            {readOnly ? (
              <div className="min-h-28 rounded-lg border border-border bg-surface-muted/30 p-3.5 text-sm leading-relaxed text-ink whitespace-pre-wrap">
                {notes || (
                  <span className="text-ink-subtle italic">No internal notes.</span>
                )}
              </div>
            ) : (
              <textarea
                value={notes || ''}
                onChange={(e) => onChangeNotes(e.target.value)}
                placeholder="Internal pricing assumptions, profit margins, discount approval notes, or workflow context..."
                rows={4}
                className="w-full rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
