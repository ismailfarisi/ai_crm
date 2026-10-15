'use client';

import { EXPENSE_CATEGORIES, billLineSchema, type CreateBillPayload } from '@saas/shared';
import { Button } from '@/components/ui/button';

export type BillLinePayload = CreateBillPayload['lines'][number];

/** What the user has typed for one charge that is not on the order. */
export interface ExtraLineDraft {
  description: string;
  qty: string;
  unitCost: string;
  category: string;
  spread: boolean;
  start: string;
  end: string;
}

export const emptyExtraLine = (): ExtraLineDraft => ({
  description: '',
  qty: '1',
  unitCost: '',
  category: '',
  spread: false,
  start: '',
  end: '',
});

const isBlank = (d: ExtraLineDraft) => !d.description.trim() && !d.unitCost.trim() && !d.category.trim() && !d.spread;

export type ExtraLineResult =
  | { status: 'blank' }
  | { status: 'invalid'; message: string }
  | { status: 'ok'; line: BillLinePayload };

/**
 * Turns a draft into a bill line using the same schema the API validates
 * with, so "both dates or neither" and "end not before start" read the same
 * on screen as they do on save. A draft nobody touched is ignored.
 */
export function buildExtraLine(d: ExtraLineDraft): ExtraLineResult {
  if (isBlank(d)) return { status: 'blank' };
  const parsed = billLineSchema.safeParse({
    purchaseOrderLineId: null,
    description: d.description,
    qty: d.qty,
    unitCost: d.unitCost === '' ? Number.NaN : d.unitCost,
    category: d.category,
    servicePeriodStart: d.spread ? d.start || null : null,
    servicePeriodEnd: d.spread ? d.end || null : null,
  });
  if (!parsed.success) return { status: 'invalid', message: parsed.error.issues[0]?.message ?? 'Check this line' };
  return { status: 'ok', line: parsed.data };
}

const inputClass = 'rounded border border-line bg-surface px-2 py-1 text-ink';

interface ExtraLinesEditorProps {
  lines: ExtraLineDraft[];
  onChange: (lines: ExtraLineDraft[]) => void;
}

/** Charges on a bill that did not come from the purchase order: freight, a service, a prepaid year. */
export function ExtraLinesEditor({ lines, onChange }: ExtraLinesEditorProps) {
  const patch = (i: number, p: Partial<ExtraLineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">Other charges on this bill</h3>
        <Button variant="secondary" size="sm" onClick={() => onChange([...lines, emptyExtraLine()])}>
          Add a charge
        </Button>
      </div>
      <datalist id="bill-line-categories">
        {EXPENSE_CATEGORIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {lines.map((d, i) => {
        const result = buildExtraLine(d);
        return (
          <div key={i} className="space-y-2 rounded border border-line p-3">
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr_5rem_7rem]">
              <input
                aria-label={`Charge ${i + 1} description`}
                placeholder="Description"
                className={inputClass}
                value={d.description}
                onChange={(e) => patch(i, { description: e.target.value })}
              />
              <input
                aria-label={`Charge ${i + 1} category`}
                placeholder="Category"
                list="bill-line-categories"
                className={inputClass}
                value={d.category}
                onChange={(e) => patch(i, { category: e.target.value })}
              />
              <input
                aria-label={`Charge ${i + 1} quantity`}
                type="number"
                min={0}
                step="any"
                className={`${inputClass} text-right tabular-nums`}
                value={d.qty}
                onChange={(e) => patch(i, { qty: e.target.value })}
              />
              <input
                aria-label={`Charge ${i + 1} unit price`}
                type="number"
                min={0}
                step="any"
                placeholder="Unit price"
                className={`${inputClass} text-right tabular-nums`}
                value={d.unitCost}
                onChange={(e) => patch(i, { unitCost: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2 text-ink-muted">
                <input type="checkbox" checked={d.spread} onChange={(e) => patch(i, { spread: e.target.checked })} />
                Spread over
              </label>
              {d.spread && (
                <>
                  <input
                    aria-label={`Charge ${i + 1} service period start`}
                    type="date"
                    className={inputClass}
                    value={d.start}
                    onChange={(e) => patch(i, { start: e.target.value })}
                  />
                  <span className="text-ink-subtle">to</span>
                  <input
                    aria-label={`Charge ${i + 1} service period end`}
                    type="date"
                    className={inputClass}
                    value={d.end}
                    onChange={(e) => patch(i, { end: e.target.value })}
                  />
                </>
              )}
              <Button variant="ghost" size="sm" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
            {result.status === 'invalid' && (
              <p role="alert" className="text-xs text-danger">
                {result.message}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
