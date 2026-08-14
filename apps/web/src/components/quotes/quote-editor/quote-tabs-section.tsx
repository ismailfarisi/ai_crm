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
    <div className="bg-surface/85 backdrop-blur-xs rounded-2xl border border-border/30 overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.015)]">
      {/* Tabs Header */}
      <div className="flex border-b border-border/25 bg-surface-muted/20 px-4">
        <button
          type="button"
          onClick={() => setActiveTab('terms')}
          className={cn(
            'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors cursor-pointer',
            activeTab === 'terms'
              ? 'border-brand text-brand-hover font-semibold'
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
            'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors cursor-pointer',
            activeTab === 'notes'
              ? 'border-brand text-brand-hover font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          <Lock className="size-4 text-warning" />
          <span>Internal Notes</span>
          {notes && (
            <span className="size-1.5 rounded-full bg-warning" />
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
              <div className="min-h-28 rounded-xl border border-border/30 bg-surface-muted/30 p-3.5 text-sm leading-relaxed text-ink whitespace-pre-wrap">
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
                className="w-full rounded-xl border border-border/40 bg-surface-muted/30 p-3 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:bg-surface focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden transition-colors"
              />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                Internal Sales & Review Notes
              </label>
              <span className="text-xs text-warning flex items-center gap-1 font-medium">
                <Lock className="size-3.5" />
                Confidential — Internal Team Only
              </span>
            </div>

            {readOnly ? (
              <div className="min-h-28 rounded-xl border border-border/30 bg-surface-muted/30 p-3.5 text-sm leading-relaxed text-ink whitespace-pre-wrap">
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
                className="w-full rounded-xl border border-border/40 bg-surface-muted/30 p-3 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:bg-surface focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden transition-colors"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
