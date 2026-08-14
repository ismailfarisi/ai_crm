'use client';

import { Plus, Trash2, Layers, FileText, Package, Hash } from 'lucide-react';
import type { QuoteLineItem, QuoteLineItemType } from '@saas/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface QuoteLinesTableProps {
  items: QuoteLineItem[];
  onChange: (items: QuoteLineItem[]) => void;
  currency?: string;
  readOnly?: boolean;
}

const UOM_OPTIONS = [
  { value: 'Units', label: 'Units' },
  { value: 'Hours', label: 'Hours (hrs)' },
  { value: 'Days', label: 'Days' },
  { value: 'Licenses', label: 'Licenses' },
  { value: 'Months', label: 'Months (mo)' },
  { value: 'Packages', label: 'Packages' },
  { value: 'Services', label: 'Services' },
  { value: 'Items', label: 'Items' },
];

const TAX_RATE_OPTIONS = [
  { value: '0', label: '0% (Exempt)' },
  { value: '5', label: '5% (VAT)' },
  { value: '10', label: '10% (Sales Tax)' },
  { value: '15', label: '15% (Standard Tax)' },
  { value: '20', label: '20% (VAT 20%)' },
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

export function QuoteLinesTable({
  items,
  onChange,
  currency = 'USD',
  readOnly = false,
}: QuoteLinesTableProps) {
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

    if (type === 'product') {
      const newItem: QuoteLineItem = {
        id: newId,
        type: 'product',
        description: '',
        quantity: 1,
        uom: 'Units',
        unitPrice: 0,
        discount: 0,
        taxRate: 0,
        subtotal: 0,
      };
      onChange([...items, newItem]);
    } else if (type === 'section') {
      const newItem: QuoteLineItem = {
        id: newId,
        type: 'section',
        description: 'New Section / Deliverable Phase',
      };
      onChange([...items, newItem]);
    } else {
      const newItem: QuoteLineItem = {
        id: newId,
        type: 'note',
        description: 'Note: ',
      };
      onChange([...items, newItem]);
    }
  };

  const handleRemoveItem = (id: string) => {
    if (readOnly) return;
    onChange(items.filter((item) => item.id !== id));
  };

  let productCounter = 0;

  return (
    <div className="bg-surface/85 backdrop-blur-xs rounded-2xl border border-border/30 overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.015)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] text-left border-collapse">
          <thead>
            <tr className="bg-surface-muted/30 text-xs font-semibold text-ink-muted/80 uppercase tracking-wider border-b border-border/25">
              <th className="w-12 px-3 py-3 text-center">
                <Hash className="inline size-3.5" />
              </th>
              <th className="px-3 py-3 min-w-[240px]">Description</th>
              <th className="w-24 px-3 py-3 text-right">Quantity</th>
              <th className="w-28 px-3 py-3">UoM</th>
              <th className="w-32 px-3 py-3 text-right">Unit Price</th>
              <th className="w-24 px-3 py-3 text-right">Disc.%</th>
              <th className="w-32 px-3 py-3">Tax</th>
              <th className="w-32 px-3 py-3 text-right">Subtotal</th>
              {!readOnly && <th className="w-12 px-3 py-3 text-center"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={readOnly ? 8 : 9}
                  className="px-6 py-12 text-center text-sm text-ink-muted"
                >
                  <Package className="mx-auto size-8 text-ink-subtle opacity-60 mb-2" />
                  <p className="font-medium text-ink">No line items in this quote</p>
                  <p className="text-xs text-ink-subtle mt-1">
                    Click the buttons below to add products, phase sections, or notes.
                  </p>
                </td>
              </tr>
            ) : (
              items.map((item, index) => {
                if (item.type === 'section') {
                  return (
                    <tr
                      key={item.id}
                      className="bg-amber-500/5 font-semibold text-ink border-y border-amber-500/10 hover:bg-amber-500/10 transition-colors"
                    >
                      <td className="px-3 py-2.5 text-center text-ink-subtle">
                        <Layers className="inline size-4 text-brand" />
                      </td>
                      <td colSpan={readOnly ? 7 : 7} className="px-3 py-2.5">
                        {readOnly ? (
                          <div className="py-1 text-sm font-semibold tracking-wide text-ink">
                            {item.description}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={item.description}
                              placeholder="Section Header (e.g., Phase 1: Implementation)"
                              onChange={(e) =>
                                handleItemChange(item.id, 'description', e.target.value)
                              }
                              className="w-full rounded-lg border border-transparent bg-transparent px-2.5 py-1 text-sm font-semibold text-ink placeholder:text-ink-subtle hover:border-border/40 focus:border-brand focus:bg-surface focus:outline-hidden"
                            />
                          </div>
                        )}
                      </td>
                      {!readOnly && (
                        <td className="px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="rounded-full p-1 text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger"
                            title="Delete Section"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                }

                if (item.type === 'note') {
                  return (
                    <tr
                      key={item.id}
                      className="bg-surface-muted/25 italic text-ink-muted hover:bg-surface-muted/35 transition-colors"
                    >
                      <td className="px-3 py-2.5 text-center text-ink-subtle">
                        <FileText className="inline size-4 text-amber-500" />
                      </td>
                      <td colSpan={readOnly ? 7 : 7} className="px-3 py-2.5">
                        {readOnly ? (
                          <div className="py-1 text-sm italic text-ink-muted">
                            {item.description}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={item.description}
                              placeholder="Add a note or deliverable condition (e.g., Includes 99.9% uptime SLA)..."
                              onChange={(e) =>
                                handleItemChange(item.id, 'description', e.target.value)
                              }
                              className="w-full rounded-lg border border-transparent bg-transparent px-2.5 py-1 text-sm italic text-ink placeholder:text-ink-subtle hover:border-border/40 focus:border-brand focus:bg-surface focus:outline-hidden"
                            />
                          </div>
                        )}
                      </td>
                      {!readOnly && (
                        <td className="px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="rounded-full p-1 text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger"
                            title="Delete Note"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                }

                // Default: 'product'
                productCounter += 1;
                const qty = Number(item.quantity) || 0;
                const price = Number(item.unitPrice) || 0;
                const discount = Number(item.discount) || 0;
                const subtotal = item.subtotal ?? qty * price * (1 - discount / 100);

                return (
                  <tr
                    key={item.id}
                    className="group border-b border-border/20 py-2.5 hover:bg-surface-muted/15 transition-colors"
                  >
                    {/* # Index */}
                    <td className="px-3 py-2.5 text-center text-xs font-mono text-ink-subtle">
                      {productCounter}
                    </td>

                    {/* Description */}
                    <td className="px-3 py-2.5">
                      {readOnly ? (
                        <span className="text-sm font-medium text-ink">
                          {item.description || '—'}
                        </span>
                      ) : (
                        <input
                          type="text"
                          value={item.description}
                          placeholder="Product or service description"
                          onChange={(e) =>
                            handleItemChange(item.id, 'description', e.target.value)
                          }
                          className="w-full rounded-xl border border-border/40 bg-surface-muted/30 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-subtle focus:bg-surface focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden transition-colors"
                        />
                      )}
                    </td>

                    {/* Quantity */}
                    <td className="px-3 py-2.5 text-right">
                      {readOnly ? (
                        <span className="text-sm tabular-nums text-ink font-medium">
                          {item.quantity ?? 1}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.quantity ?? 1}
                          onChange={(e) =>
                            handleItemChange(item.id, 'quantity', parseFloat(e.target.value) || 0)
                          }
                          className="w-20 rounded-xl border border-border/40 bg-surface-muted/30 px-2 py-1.5 text-right text-sm tabular-nums text-ink focus:bg-surface focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden transition-colors"
                        />
                      )}
                    </td>

                    {/* UoM */}
                    <td className="px-3 py-2.5">
                      {readOnly ? (
                        <span className="text-xs text-ink-muted font-medium">
                          {item.uom || 'Units'}
                        </span>
                      ) : (
                        <select
                          value={item.uom || 'Units'}
                          onChange={(e) => handleItemChange(item.id, 'uom', e.target.value)}
                          className="w-full rounded-xl border border-border/40 bg-surface-muted/30 px-2 py-1.5 text-xs text-ink focus:bg-surface focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden transition-colors"
                        >
                          {UOM_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    {/* Unit Price */}
                    <td className="px-3 py-2.5 text-right">
                      {readOnly ? (
                        <span className="text-sm tabular-nums text-ink">
                          {formatCurrency(price, currency)}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice ?? 0}
                          onChange={(e) =>
                            handleItemChange(item.id, 'unitPrice', parseFloat(e.target.value) || 0)
                          }
                          className="w-28 rounded-xl border border-border/40 bg-surface-muted/30 px-2 py-1.5 text-right text-sm tabular-nums text-ink focus:bg-surface focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden transition-colors"
                        />
                      )}
                    </td>

                    {/* Discount % */}
                    <td className="px-3 py-2.5 text-right">
                      {readOnly ? (
                        <span
                          className={cn(
                            'text-sm tabular-nums',
                            discount > 0 ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'text-ink-muted',
                          )}
                        >
                          {discount > 0 ? `${discount}%` : '—'}
                        </span>
                      ) : (
                        <div className="relative inline-block w-20">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={item.discount ?? 0}
                            onChange={(e) =>
                              handleItemChange(item.id, 'discount', parseFloat(e.target.value) || 0)
                            }
                            className="w-full rounded-xl border border-border/40 bg-surface-muted/30 pr-5 pl-2 py-1.5 text-right text-sm tabular-nums text-ink focus:bg-surface focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden transition-colors"
                          />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-subtle">
                            %
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Tax Rate */}
                    <td className="px-3 py-2.5">
                      {readOnly ? (
                        <span className="text-xs text-ink-muted">
                          {item.taxRate ? `${item.taxRate}%` : '0%'}
                        </span>
                      ) : (
                        <select
                          value={String(item.taxRate ?? 0)}
                          onChange={(e) =>
                            handleItemChange(item.id, 'taxRate', parseFloat(e.target.value) || 0)
                          }
                          className="w-full rounded-xl border border-border/40 bg-surface-muted/30 px-2 py-1.5 text-xs text-ink focus:bg-surface focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden transition-colors"
                        >
                          {TAX_RATE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    {/* Subtotal */}
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-sm font-semibold tabular-nums text-ink">
                        {formatCurrency(subtotal, currency)}
                      </span>
                    </td>

                    {/* Actions */}
                    {!readOnly && (
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          className="rounded-full p-1.5 text-ink-subtle opacity-60 group-hover:opacity-100 transition-all hover:bg-danger-soft hover:text-danger"
                          title="Delete Line Item"
                        >
                          <Trash2 className="size-4" />
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

      {/* Action Bar (Odoo Style Add Buttons) */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/25 bg-surface-muted/20 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleAddItem('product')}
            className="gap-1.5 text-xs font-medium rounded-full px-4 py-1.5 border-border/40 hover:border-brand/60"
          >
            <Plus className="size-3.5 text-brand-hover" />
            Add a product
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleAddItem('section')}
            className="gap-1.5 text-xs text-ink-muted hover:text-ink rounded-full px-4 py-1.5 hover:bg-surface-muted/40"
          >
            <Layers className="size-3.5 text-brand-hover" />
            Add a section
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleAddItem('note')}
            className="gap-1.5 text-xs text-ink-muted hover:text-ink rounded-full px-4 py-1.5 hover:bg-surface-muted/40"
          >
            <FileText className="size-3.5 text-warning" />
            Add a note
          </Button>
        </div>
      )}
    </div>
  );
}
