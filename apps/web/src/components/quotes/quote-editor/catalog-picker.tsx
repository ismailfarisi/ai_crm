'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Box, Layers, Loader2, Package, Search, SlidersHorizontal } from 'lucide-react';
import type { CatalogItemDto, ProductTemplateDto } from '@saas/shared';
import { PERMISSIONS } from '@saas/shared';
import { useCan } from '@/lib/session-context';
import { useCatalogSearch } from '@/hooks/use-catalog';
import { ModalShell } from '@/components/ui/modal-shell';
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

const rowId = (row: PickerChoice) => (row.kind === 'TEMPLATE' ? row.template.id : row.item.id);

/**
 * Command-palette item picker.
 *
 * Replaces typing a description and a price by hand, which is how every line
 * used to get its numbers. Templates come first because a parametric product
 * is the thing you almost always want; flat catalog items follow.
 *
 * The search box is a combobox over a listbox: focus stays in the box while
 * the arrow keys move the highlight, and the highlighted row is announced
 * through `aria-activedescendant`, so a screen reader hears every step.
 */
export function CatalogPicker({ open, onClose, onChoose, currency = 'USD' }: CatalogPickerProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const canSeeCost = useCan({ permission: PERMISSIONS.QUOTE_VIEW_COST });
  const { items, templates, isLoading } = useCatalogSearch(query, open);

  const rows = useMemo<PickerChoice[]>(
    () => [
      ...templates.map((template) => ({ kind: 'TEMPLATE' as const, template })),
      ...items.map((item) => ({ kind: 'CATALOG_ITEM' as const, item })),
    ],
    [templates, items],
  );

  // A fresh search every time the picker opens.
  const [openedFor, setOpenedFor] = useState(open);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }

  // Keep the highlighted row in view when arrowing past the fold. Guarded
  // because scrollIntoView is absent in jsdom and in older embedded webviews,
  // and losing the scroll is not worth throwing over.
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (typeof active?.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

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

  const templateRows = rows.filter((row) => row.kind === 'TEMPLATE');
  const itemRows = rows.filter((row) => row.kind === 'CATALOG_ITEM');
  const groups = [
    { key: 'templates', label: 'Product templates', start: 0, rows: templateRows, showHeading: true },
    {
      key: 'items',
      label: 'Catalog items',
      start: templateRows.length,
      rows: itemRows,
      showHeading: templateRows.length > 0,
    },
  ].filter((group) => group.rows.length > 0);

  const active = rows[activeIndex];
  const resultCount = rows.length === 1 ? '1 result' : `${rows.length} results`;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label="Add a line from the catalog"
      initialFocusRef={inputRef}
      className="max-w-2xl"
    >
      <div className="flex items-center gap-3 border-b border-border/60 px-4">
        <Search className="size-4 shrink-0 text-ink-subtle" aria-hidden />
        <label htmlFor={`${baseId}-search`} className="sr-only">
          Search the catalog
        </label>
        <input
          ref={inputRef}
          id={`${baseId}-search`}
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(activeIndex) : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search products and templates…"
          autoComplete="off"
          className="w-full bg-transparent py-4 text-sm text-ink outline-hidden placeholder:text-ink-subtle"
        />
        {isLoading && <Loader2 className="size-4 shrink-0 animate-spin text-ink-subtle" aria-hidden />}
        <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-xs font-medium text-ink-muted pointer-fine:block">
          Esc
        </kbd>
      </div>

      {/* Said once the search settles, not on every keystroke. */}
      <p role="status" className="sr-only">
        {isLoading ? '' : resultCount}
      </p>

      <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
        {rows.length === 0 && !isLoading ? (
          <div className="px-4 py-10 text-center">
            <Package className="mx-auto mb-2 size-8 text-ink-subtle" aria-hidden />
            <p className="text-sm font-medium text-ink">
              {query ? `Nothing matches "${query}"` : 'Your catalog is empty'}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {query
                ? 'Try a different term, or close this and type the line by hand.'
                : 'Add materials, work centres and a product template to quote from a cost model.'}
            </p>
          </div>
        ) : null}

        <div id={listId} role="listbox" aria-label="Catalog">
          {groups.map((group) => (
            <div key={group.key} role="group" aria-labelledby={`${baseId}-${group.key}`}>
              <p
                id={`${baseId}-${group.key}`}
                className={cn(
                  'px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted',
                  group.key === 'templates' ? 'pt-2' : 'pt-3',
                  // A list of items alone needs no heading on screen.
                  !group.showHeading && 'sr-only',
                )}
              >
                {group.label}
              </p>
              {group.rows.map((row, offset) => {
                const index = group.start + offset;
                const isActive = index === activeIndex;
                const name = row.kind === 'TEMPLATE' ? row.template.name : row.item.name;

                return (
                  <div
                    key={rowId(row)}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    onMouseEnter={() => setActiveIndex(index)}
                    // Keep focus in the search box; the click still picks the row.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onChoose(row)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                      isActive ? 'bg-brand-soft' : 'hover:bg-surface-muted/60',
                    )}
                  >
                    {row.kind === 'TEMPLATE' ? (
                      <Layers className="size-4 shrink-0 text-ink-muted" aria-hidden />
                    ) : (
                      <Box className="size-4 shrink-0 text-ink-subtle" aria-hidden />
                    )}

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{name}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {row.kind === 'TEMPLATE'
                          ? row.template.description || 'Priced from its size and quantity'
                          : row.item.sku}
                      </span>
                    </span>

                    {row.kind === 'TEMPLATE' ? (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink">
                        <SlidersHorizontal className="size-3" aria-hidden />
                        Configure
                      </span>
                    ) : (
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-ink">
                          {formatCurrency(row.item.listPrice, currency)}
                        </span>
                        {canSeeCost && row.item.standardCost > 0 && (
                          <span className="block text-xs tabular-nums text-ink-muted">
                            cost {formatCurrency(row.item.standardCost, currency)}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-surface-muted/30 px-4 py-2 text-xs text-ink-muted">
        <span className="hidden pointer-fine:inline">↑↓ to move · Enter to pick</span>
        <span>Prices and costs come from your catalog</span>
      </div>
    </ModalShell>
  );
}
