'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Layers, Loader2, Package, Search, Sparkles } from 'lucide-react';
import type { CatalogItemDto, ProductTemplateDto } from '@saas/shared';
import { PERMISSIONS } from '@saas/shared';
import { useCan } from '@/lib/session-context';
import { useCatalogSearch } from '@/hooks/use-catalog';
import { cn } from '@/lib/utils';
import { formatCurrency } from './quote-lines-table';

export type PickerChoice =
  | { kind: 'CATALOG_ITEM'; item: CatalogItemDto }
  | { kind: 'TEMPLATE'; template: ProductTemplateDto };

interface CatalogPickerProps {
  open: boolean;
  onClose: () => void;
  onChoose: (choice: PickerChoice) => void;
  currency?: string;
}

/**
 * Command-palette item picker.
 *
 * Replaces typing a description and a price by hand, which is how every line
 * used to get its numbers. Templates come first because a parametric product
 * is the thing you almost always want; flat catalog items follow.
 */
export function CatalogPicker({ open, onClose, onChoose, currency = 'USD' }: CatalogPickerProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const canSeeCost = useCan({ permission: PERMISSIONS.QUOTE_VIEW_COST });
  const { items, templates, isLoading } = useCatalogSearch(query, open);

  const rows = useMemo<PickerChoice[]>(
    () => [
      ...templates.map((template) => ({ kind: 'TEMPLATE' as const, template })),
      ...items.map((item) => ({ kind: 'CATALOG_ITEM' as const, item })),
    ],
    [templates, items],
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // Autofocus after the dialog paints, or the caret lands nowhere.
      const timer = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the highlighted row in view when arrowing past the fold. Guarded
  // because scrollIntoView is absent in jsdom and in older embedded webviews,
  // and losing the scroll is not worth throwing over.
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (typeof active?.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, rows.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const choice = rows[activeIndex];
      if (choice) onChoose(choice);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a line from the catalog"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border/40 bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-border/30 px-4">
          <Search className="size-4 shrink-0 text-ink-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products and templates…"
            className="w-full bg-transparent py-4 text-sm text-ink outline-hidden placeholder:text-ink-subtle"
          />
          {isLoading && <Loader2 className="size-4 shrink-0 animate-spin text-ink-subtle" />}
          <kbd className="hidden shrink-0 rounded border border-border/40 px-1.5 py-0.5 text-[10px] font-medium text-ink-subtle sm:block">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {rows.length === 0 && !isLoading ? (
            <div className="px-4 py-10 text-center">
              <Package className="mx-auto mb-2 size-8 text-ink-subtle opacity-60" />
              <p className="text-sm font-medium text-ink">
                {query ? `Nothing matches "${query}"` : 'Your catalog is empty'}
              </p>
              <p className="mt-1 text-xs text-ink-subtle">
                {query
                  ? 'Try a different term, or close this and type the line by hand.'
                  : 'Add materials, work centres and a product template to quote from a cost model.'}
              </p>
            </div>
          ) : (
            <>
              {templates.length > 0 && (
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                  Product templates
                </p>
              )}
              {rows.map((row, index) => {
                const isActive = index === activeIndex;
                const isFirstItem = row.kind === 'CATALOG_ITEM' && rows[index - 1]?.kind === 'TEMPLATE';

                return (
                  <div key={row.kind === 'TEMPLATE' ? row.template.id : row.item.id}>
                    {isFirstItem && (
                      <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                        Catalog items
                      </p>
                    )}
                    <button
                      type="button"
                      data-active={isActive}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => onChoose(row)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                        isActive ? 'bg-brand-soft' : 'hover:bg-surface-muted/60',
                      )}
                    >
                      {row.kind === 'TEMPLATE' ? (
                        <Layers className="size-4 shrink-0 text-brand" />
                      ) : (
                        <Box className="size-4 shrink-0 text-ink-subtle" />
                      )}

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {row.kind === 'TEMPLATE' ? row.template.name : row.item.name}
                        </span>
                        <span className="block truncate text-xs text-ink-subtle">
                          {row.kind === 'TEMPLATE'
                            ? `${row.template.templateKey} · v${row.template.version} · configurable`
                            : row.item.sku}
                        </span>
                      </span>

                      {row.kind === 'TEMPLATE' ? (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-hover">
                          <Sparkles className="size-3" />
                          Configure
                        </span>
                      ) : (
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-semibold text-ink">
                            {formatCurrency(row.item.listPrice, currency)}
                          </span>
                          {canSeeCost && row.item.standardCost > 0 && (
                            <span className="block text-[11px] text-ink-subtle">
                              cost {formatCurrency(row.item.standardCost, currency)}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border/30 bg-surface-muted/30 px-4 py-2 text-[11px] text-ink-subtle">
          <span>↑↓ to move · Enter to pick</span>
          <span>Prices come from the server, never the browser</span>
        </div>
      </div>
    </div>
  );
}
