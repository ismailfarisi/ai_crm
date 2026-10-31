'use client';

import { Plus, Trash2, Layers, FileText, Package, PackagePlus, Hash } from 'lucide-react';
import type { QuoteLineItem, QuoteLineItemType } from '@saas/shared';
import { DEFAULT_UNIT, UNIT_GROUPS } from '@saas/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { lineMargin } from './margin-status';

export interface QuoteLinesTableProps {
  items: QuoteLineItem[];
  onChange: (items: QuoteLineItem[]) => void;
  currency?: string;
  readOnly?: boolean;
  /**
   * The organisation's own sales tax codes. When empty the table falls back to
   * a handful of round percentages so a tenant that has not configured tax yet
   * can still quote.
   */
  taxCodes?: Array<{ id: string; code: string; name: string; rate: number }>;
  /** Opens the catalog picker; lines priced from what they cost come first. */
  onAddFromCatalog?: () => void;
  /** Opens the catalog picker to replace one typed line with a costed one. */
  onFindInCatalog?: (lineId: string) => void;
  /** The shortcut that opens the picker, shown on its button. */
  catalogShortcut?: string;
  /** Removes a line; the page offers an undo. Without it the line simply goes. */
  onRemoveLine?: (lineId: string) => void;
  /** Adds a typed line, section or note; the page puts focus in it. */
  onAddTypedLine?: (line: QuoteLineItem) => void;
  /** Shows each line's cost and margin under its subtotal (`quote:view_cost`). */
  canSeeCost?: boolean;
  /** The margin floor as a fraction, to tint a line that falls below it. */
  marginFloor?: number | null;
  /** Lines whose cost is being worked out again after a quantity change. */
  recostingIds?: ReadonlySet<string>;
}

const formatPct = (fraction: number) => `${(fraction * 100).toFixed(1).replace('-', '−')}%`;

/** The quiet second row under a line's subtotal: what it costs and what it keeps. */
function LineCost({
  item,
  currency,
  floor,
  recosting,
  readOnly,
}: {
  item: QuoteLineItem;
  currency: string;
  floor: number | null;
  recosting: boolean;
  readOnly: boolean;
}) {
  if (recosting) {
    return <span className="block text-xs text-ink-muted">Re-costing…</span>;
  }
  const margin = lineMargin(item, floor);
  if (!margin) {
    const priced = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0) > 0;
    // In the editor the line says this under its description, with the fix.
    return priced && readOnly ? <span className="block text-xs text-warning">No cost</span> : null;
  }
  const verdict =
    margin.marginPct === null
      ? null
      : margin.marginPct < 0
        ? `${formatPct(margin.marginPct)} loss`
        : margin.tone === 'danger'
          ? `${formatPct(margin.marginPct)} below floor`
          : `${formatPct(margin.marginPct)} margin`;
  // Two short rows, so the figures stay whole in a narrow column.
  return (
    <span className={cn('block text-xs tabular-nums', margin.tone === 'danger' ? 'text-danger' : 'text-ink-muted')}>
      <span className="block whitespace-nowrap">Cost {formatCurrency(margin.cost, currency)}</span>
      {verdict && <span className="block whitespace-nowrap">{verdict}</span>}
    </span>
  );
}


/**
 * Used only by organisations that have not set any tax codes up yet.
 *
 * This list used to be the whole story, so a rate the business actually needed
 * — 8.25% for California, say — could not be put on a quote at all, and the
 * codes configured under Finance → Tax never reached a document. Real codes
 * take precedence whenever they exist.
 */
const FALLBACK_TAX_RATE_OPTIONS = [
  { value: '0', label: 'No tax (0%)' },
  { value: '5', label: '5%' },
  { value: '10', label: '10%' },
  { value: '15', label: '15%' },
  { value: '20', label: '20%' },
];

export function formatCurrency(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

/*
 * The table needs about 840px to show every column. Narrower than that — a
 * phone, a tablet, a laptop with the sidebar open — each line becomes a card
 * instead, so price and subtotal never scroll away from the line they belong
 * to. Measured on the table's own container, not the viewport, because the
 * sidebar decides how much room it actually has.
 */
const CONTROL =
  'rounded-xl border border-border-control bg-surface-muted/30 px-2 py-1.5 text-sm text-ink tabular-nums ' +
  'focus:bg-surface focus:border-brand-ring focus:ring-1 focus:ring-brand-ring focus:outline-hidden transition-colors ' +
  '@max-[52rem]:h-10 @max-[52rem]:w-full';
const CELL = 'px-3 py-2.5 @max-[52rem]:p-0';

/** A field's label, shown only when the line is a card and has no column heading above it. */
function CardLabel({ children }: { children: string }) {
  return (
    <span aria-hidden className="mb-1 hidden text-xs font-medium text-ink-muted @max-[52rem]:block">
      {children}
    </span>
  );
}

export function QuoteLinesTable({
  items,
  onChange,
  currency = 'USD',
  readOnly = false,
  taxCodes = [],
  onAddFromCatalog,
  onFindInCatalog,
  catalogShortcut,
  onRemoveLine,
  onAddTypedLine,
  canSeeCost = false,
  marginFloor = null,
  recostingIds,
}: QuoteLinesTableProps) {
  const taxRateOptions =
    taxCodes.length > 0
      ? // A line keeps only the rate, so codes that share one (zero-rated and
        // exempt are both 0%) are one choice here, named for all of them.
        [...new Set(taxCodes.map((code) => code.rate))].map((rate) => {
          const names = taxCodes.filter((code) => code.rate === rate).map((code) => code.name);
          const label = names.join(' / ');
          // Codes are often named for their rate already ("No tax (0%)").
          return { value: String(rate), label: label.includes('%') ? label : `${label} (${rate}%)` };
        })
      : FALLBACK_TAX_RATE_OPTIONS;
  // Once any code exists the round fallbacks disappear, so an organisation
  // that has set up only a zero-rated code can quote nothing but 0%.
  const onlyZeroRated = taxCodes.length > 0 && taxCodes.every((code) => !(code.rate > 0));

  const handleItemChange = (
    id: string,
    field: keyof QuoteLineItem,
    value: string | number | undefined,
  ) => {
    if (readOnly) return;
    const nextItems = items.map((item) => {
      if (item.id !== id) return item;

      const updated = { ...item, [field]: value };

      if (updated.type === 'product') {
        const qty = Number(updated.quantity) || 0;
        const price = Number(updated.unitPrice) || 0;
        const discount = Math.min(100, Math.max(0, Number(updated.discount) || 0));
        const lineGross = qty * price;
        const lineDiscount = lineGross * (discount / 100);
        updated.subtotal = Number((lineGross - lineDiscount).toFixed(2));
      }

      return updated;
    });

    onChange(nextItems);
  };

  const handleAddItem = (type: QuoteLineItemType) => {
    if (readOnly) return;
    const newId = `line_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newItem: QuoteLineItem =
      type === 'product'
        ? {
            id: newId,
            type: 'product',
            description: '',
            quantity: 1,
            uom: DEFAULT_UNIT,
            unitPrice: 0,
            discount: 0,
            taxRate: 0,
            subtotal: 0,
          }
        : { id: newId, type, description: '' };

    if (onAddTypedLine) onAddTypedLine(newItem);
    else onChange([...items, newItem]);
  };

  const handleRemoveItem = (id: string) => {
    if (readOnly) return;
    if (onRemoveLine) onRemoveLine(id);
    else onChange(items.filter((item) => item.id !== id));
  };

  let productCounter = 0;

  return (
    <div className="@container bg-surface rounded-2xl border border-border/60 overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.015)]">
      {/* Shared by every line's unit input. Grouped so the trades read apart. */}
      <datalist id="quote-line-units">
        {UNIT_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.units.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </optgroup>
        ))}
      </datalist>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] text-left border-collapse @max-[52rem]:block @max-[52rem]:min-w-0">
          <thead className="@max-[52rem]:hidden">
            <tr className="bg-surface-muted/30 text-xs font-semibold text-ink-muted uppercase tracking-wider border-b border-border/60">
              <th className="w-12 px-3 py-3 text-center">
                <Hash className="inline size-3.5" aria-hidden />
                <span className="sr-only">Line</span>
              </th>
              <th className="px-3 py-3 min-w-[240px]">Description</th>
              <th className="w-24 px-3 py-3 text-right">Quantity</th>
              <th className="w-28 px-3 py-3">Unit</th>
              <th className="w-32 px-3 py-3 text-right">Unit price</th>
              <th className="w-24 px-3 py-3 text-right">Disc. %</th>
              <th className="w-32 px-3 py-3">Tax</th>
              <th className="w-36 px-3 py-3 text-right">Subtotal</th>
              {!readOnly && (
                <th className="w-12 px-3 py-3 text-center">
                  <span className="sr-only">Remove</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60 @max-[52rem]:block">
            {items.length === 0 ? (
              <tr className="@max-[52rem]:block">
                <td
                  colSpan={readOnly ? 8 : 9}
                  className="px-6 py-12 text-center text-sm text-ink-muted @max-[52rem]:block"
                >
                  <Package className="mx-auto size-8 text-ink-subtle mb-2" aria-hidden />
                  <p className="font-medium text-ink">No lines on this quote yet</p>
                  <p className="text-xs text-ink-muted mt-1">
                    Add a line from the catalog to price it from what it costs, or type one below.
                  </p>
                </td>
              </tr>
            ) : (
              items.map((item, index) => {
                if (item.type === 'section' || item.type === 'note') {
                  const isSection = item.type === 'section';
                  const kind = isSection ? 'Section heading' : 'Note';
                  const Icon = isSection ? Layers : FileText;

                  return (
                    <tr
                      key={item.id}
                      data-line-id={item.id}
                      className={cn(
                        'transition-colors @max-[52rem]:flex @max-[52rem]:items-center @max-[52rem]:gap-2 @max-[52rem]:px-3 @max-[52rem]:py-2',
                        isSection
                          ? 'bg-brand-soft/40 font-semibold text-ink'
                          : 'bg-surface-muted/25 text-ink-muted',
                      )}
                    >
                      <td className="px-3 py-2.5 text-center @max-[52rem]:p-0">
                        <Icon className="inline size-4 text-ink-subtle" aria-hidden />
                      </td>
                      <td colSpan={7} className="px-3 py-2.5 @max-[52rem]:flex-1 @max-[52rem]:p-0">
                        {readOnly ? (
                          <div className={cn('py-1 text-sm', isSection ? 'font-semibold text-ink' : ' text-ink-muted')}>
                            {item.description}
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={item.description}
                            placeholder={
                              isSection
                                ? 'Section heading (e.g. Inner packaging)'
                                : 'Add a note (e.g. Artwork to be approved before production)'
                            }
                            aria-label={`${kind}, row ${index + 1}`}
                            data-line-field="description"
                            onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                            className={cn(
                              'w-full rounded-lg border border-transparent bg-transparent px-2.5 py-1 text-sm text-ink placeholder:text-ink-subtle hover:border-border focus:border-brand focus:bg-surface focus:outline-hidden @max-[52rem]:h-10',
                              isSection ? 'font-semibold' : '',
                            )}
                          />
                        )}
                      </td>
                      {!readOnly && (
                        <td className="px-3 py-2.5 text-center @max-[52rem]:p-0">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="inline-flex size-8 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger @max-[52rem]:size-10"
                            aria-label={`Remove ${kind.toLowerCase()}${item.description ? ` "${item.description}"` : ''}`}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                }

                // Default: 'product'
                productCounter += 1;
                const lineNo = productCounter;
                const qty = Number(item.quantity) || 0;
                const price = Number(item.unitPrice) || 0;
                const discount = Number(item.discount) || 0;
                const subtotal = item.subtotal ?? qty * price * (1 - discount / 100);
                const name = (field: string) => `${field}, line ${lineNo}`;

                return (
                  <tr
                    key={item.id}
                    data-line-id={item.id}
                    className="transition-colors hover:bg-surface-muted/20 @max-[52rem]:grid @max-[52rem]:grid-cols-6 @max-[52rem]:gap-x-3 @max-[52rem]:gap-y-3 @max-[52rem]:px-4 @max-[52rem]:py-4"
                  >
                    {/* # Index */}
                    <td className="px-3 py-2.5 text-center text-xs tabular-nums text-ink-subtle @max-[52rem]:hidden">
                      {lineNo}
                    </td>

                    {/* Description */}
                    <td className={cn(CELL, '@max-[52rem]:col-span-5')}>
                      <CardLabel>{`Line ${lineNo}`}</CardLabel>
                      {readOnly ? (
                        <span className="text-sm font-medium text-ink">
                          {item.description || '—'}
                        </span>
                      ) : (
                        <input
                          type="text"
                          value={item.description}
                          placeholder="What's being made or supplied"
                          aria-label={name('Description')}
                          data-line-field="description"
                          onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                          className={cn(CONTROL, 'w-full px-2.5 placeholder:text-ink-subtle')}
                        />
                      )}
                      {/* A typed line has a price but no cost, so the margin counts it as pure profit. */}
                      {!readOnly && onFindInCatalog && !item.cost && (item.description.trim() || price > 0) && (
                        <button
                          type="button"
                          onClick={() => onFindInCatalog(item.id)}
                          className="mt-1 inline-flex min-h-8 items-center gap-1 rounded text-xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                          aria-label={`Line ${lineNo} has no cost. Replace it with a catalog item`}
                        >
                          <PackagePlus className="size-3.5" aria-hidden />
                          No cost. Find in catalog
                        </button>
                      )}
                    </td>

                    {/* Quantity */}
                    <td className={cn(CELL, 'text-right @max-[52rem]:col-span-2 @max-[52rem]:text-start')}>
                      <CardLabel>Quantity</CardLabel>
                      {readOnly ? (
                        <span className="text-sm tabular-nums text-ink font-medium">
                          {Number(item.quantity ?? 1).toLocaleString('en-GB')}
                        </span>
                      ) : (
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={item.quantity ?? 1}
                          aria-label={name('Quantity')}
                          data-line-field="quantity"
                          onChange={(e) =>
                            handleItemChange(item.id, 'quantity', parseFloat(e.target.value) || 0)
                          }
                          className={cn(CONTROL, 'w-20 text-right')}
                        />
                      )}
                    </td>

                    {/* Unit of measure */}
                    <td className={cn(CELL, '@max-[52rem]:col-span-2')}>
                      <CardLabel>Unit</CardLabel>
                      {readOnly ? (
                        <span className="text-xs text-ink-muted font-medium">
                          {item.uom || DEFAULT_UNIT}
                        </span>
                      ) : (
                        /*
                         * A combobox, not a dropdown. The list used to be eight
                         * software-services units — Licenses, Months, Services —
                         * with no kg, m², sheet, roll, pallet or thousand and no
                         * way to add one, so a box maker had to quote 500 boxes
                         * in "Units". The suggestions cover the common trades;
                         * anything else can simply be typed.
                         */
                        <input
                          type="text"
                          list="quote-line-units"
                          value={item.uom || DEFAULT_UNIT}
                          onChange={(e) => handleItemChange(item.id, 'uom', e.target.value)}
                          aria-label={name('Unit of measure')}
                          className={cn(CONTROL, 'w-full')}
                        />
                      )}
                    </td>

                    {/* Unit Price */}
                    <td className={cn(CELL, 'text-right @max-[52rem]:col-span-2 @max-[52rem]:text-start')}>
                      <CardLabel>Unit price</CardLabel>
                      {readOnly ? (
                        <span className="text-sm tabular-nums text-ink">
                          {formatCurrency(price, currency)}
                        </span>
                      ) : (
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={item.unitPrice ?? 0}
                          aria-label={name('Unit price')}
                          onChange={(e) =>
                            handleItemChange(item.id, 'unitPrice', parseFloat(e.target.value) || 0)
                          }
                          className={cn(CONTROL, 'w-28 text-right')}
                        />
                      )}
                    </td>

                    {/* Discount % */}
                    <td className={cn(CELL, 'text-right @max-[52rem]:col-span-2 @max-[52rem]:text-start')}>
                      <CardLabel>Discount</CardLabel>
                      {readOnly ? (
                        <span className={cn('text-sm tabular-nums', discount > 0 ? 'font-medium text-ink' : 'text-ink-muted')}>
                          {discount > 0 ? `${discount}%` : '—'}
                        </span>
                      ) : (
                        <div className="relative inline-block w-20 @max-[52rem]:w-full">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="100"
                            step="1"
                            value={item.discount ?? 0}
                            aria-label={name('Discount percent')}
                            onChange={(e) =>
                              handleItemChange(item.id, 'discount', parseFloat(e.target.value) || 0)
                            }
                            className={cn(CONTROL, 'w-full pr-5 text-right')}
                          />
                          <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-subtle">
                            %
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Tax Rate: wider on a card, so a code's full name fits */}
                    <td className={cn(CELL, '@max-[52rem]:col-span-4')}>
                      <CardLabel>Tax</CardLabel>
                      {readOnly ? (
                        <span className="text-xs text-ink-muted">
                          {item.taxRate ? `${item.taxRate}%` : '0%'}
                        </span>
                      ) : (
                        <select
                          value={String(item.taxRate ?? 0)}
                          aria-label={name('Tax rate')}
                          onChange={(e) =>
                            handleItemChange(item.id, 'taxRate', parseFloat(e.target.value) || 0)
                          }
                          className={cn(CONTROL, 'w-full text-xs @max-[52rem]:text-sm')}
                        >
                          {taxRateOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    {/* Subtotal, with the line's cost and margin under it */}
                    <td
                      className={cn(
                        CELL,
                        'text-right @max-[52rem]:col-span-6 @max-[52rem]:flex @max-[52rem]:items-baseline @max-[52rem]:justify-between @max-[52rem]:gap-3 @max-[52rem]:border-t @max-[52rem]:border-border/60 @max-[52rem]:pt-3',
                      )}
                    >
                      <CardLabel>Subtotal</CardLabel>
                      <span className="block">
                        <span className="block text-sm font-semibold tabular-nums text-ink">
                          {formatCurrency(subtotal, currency)}
                        </span>
                        {canSeeCost && (
                          <LineCost
                            item={item}
                            currency={currency}
                            floor={marginFloor}
                            recosting={recostingIds?.has(item.id) ?? false}
                            readOnly={readOnly}
                          />
                        )}
                      </span>
                    </td>

                    {/* Actions */}
                    {!readOnly && (
                      <td className={cn(CELL, 'text-center @max-[52rem]:col-start-6 @max-[52rem]:row-start-1 @max-[52rem]:flex @max-[52rem]:items-start @max-[52rem]:justify-end')}>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          className="inline-flex size-8 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger @max-[52rem]:size-10"
                          aria-label={`Remove line ${lineNo}${item.description ? `, ${item.description}` : ''}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && onlyZeroRated && (
        <p className="border-t border-border/60 px-4 py-2.5 text-xs text-ink-muted">
          The only tax code set up is 0%, so every line is zero-rated. Add your VAT rate under Finance → Tax
          to charge it.
        </p>
      )}

      {/* The catalog first; typed lines for anything it does not cover */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-surface-muted/20 px-4 py-3">
          {onAddFromCatalog && (
            <Button type="button" variant="outline" onClick={onAddFromCatalog}>
              <PackagePlus className="size-4 text-ink-subtle" aria-hidden />
              Add from catalog
              {catalogShortcut && (
                <kbd className="ms-1 hidden rounded border border-border px-1.5 py-0.5 text-xs font-medium text-ink-muted md:pointer-fine:inline">
                  {catalogShortcut}
                </kbd>
              )}
            </Button>
          )}

          <Button type="button" variant={onAddFromCatalog ? 'ghost' : 'outline'} onClick={() => handleAddItem('product')}>
            <Plus className="size-4 text-ink-subtle" aria-hidden />
            Type a line
          </Button>

          <Button type="button" variant="ghost" onClick={() => handleAddItem('section')}>
            <Layers className="size-4 text-ink-subtle" aria-hidden />
            Add a section
          </Button>

          <Button type="button" variant="ghost" onClick={() => handleAddItem('note')}>
            <FileText className="size-4 text-ink-subtle" aria-hidden />
            Add a note
          </Button>
        </div>
      )}
    </div>
  );
}
