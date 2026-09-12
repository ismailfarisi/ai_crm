'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  RIGID_BOX_TEMPLATE,
  SAMPLE_CATALOG,
  calculatePriceBreaks,
  costTemplate,
  estimateWorkingDays,
  type PriceBreak,
} from '@saas/shared';

const QUANTITIES = [100, 250, 500, 1000, 2500];

const money = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

interface Result {
  breaks: PriceBreak[];
  materialCost: number;
  machineCost: number;
  laborCost: number;
  toolingCost: number;
  leadTimeDays: number;
  error: null;
}

/**
 * Runs the real costing engine in the browser.
 *
 * `@saas/shared`'s engine is pure — no I/O, no clock, no randomness — so the
 * numbers here are computed by exactly the same code the API prices quotes
 * with, rather than being a mock-up. The rates come from the sample catalog,
 * which is why the copy calls them illustrative.
 */
export function LiveQuoteDemo() {
  const [length, setLength] = useState(200);
  const [width, setWidth] = useState(150);
  const [height, setHeight] = useState(80);
  const [finish, setFinish] = useState('matt');
  const [quantity, setQuantity] = useState(500);

  const result = useMemo<Result | { error: string }>(() => {
    const parameters = {
      length_mm: length,
      width_mm: width,
      height_mm: height,
      finish,
    };

    try {
      const breaks = calculatePriceBreaks(
        RIGID_BOX_TEMPLATE,
        SAMPLE_CATALOG,
        parameters,
        [...new Set([...QUANTITIES, quantity])].sort((a, b) => a - b),
      );
      const breakdown = costTemplate(RIGID_BOX_TEMPLATE, SAMPLE_CATALOG, parameters, quantity);

      return {
        breaks,
        materialCost: breakdown.materialCost,
        machineCost: breakdown.machineCost,
        laborCost: breakdown.laborCost,
        toolingCost: breakdown.amortizedToolingCost,
        leadTimeDays: estimateWorkingDays(breakdown, SAMPLE_CATALOG),
        error: null,
      };
    } catch (error) {
      // A box too big for any sheet in stock lands here, with the engine's own
      // explanation. Showing it is the point — this is what the app does too.
      return { error: error instanceof Error ? error.message : 'Could not price this' };
    }
  }, [length, width, height, finish, quantity]);

  const failed = 'error' in result && typeof result.error === 'string';
  const chosen = !failed
    ? (result as Result).breaks.find((row) => row.quantity === quantity)
    : undefined;

  const costParts = !failed
    ? [
        { label: 'Material', value: (result as Result).materialCost },
        { label: 'Machine', value: (result as Result).machineCost },
        { label: 'Labour', value: (result as Result).laborCost },
        { label: 'Tooling', value: (result as Result).toolingCost },
      ]
    : [];
  const costTotal = costParts.reduce((sum, part) => sum + part.value, 0) || 1;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-xl shadow-black/5">
      <div className="flex items-center gap-2 border-b border-border/50 bg-surface-muted/40 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-danger/50" />
        <span className="size-2.5 rounded-full bg-brand/60" />
        <span className="size-2.5 rounded-full bg-emerald-500/50" />
        <span className="ml-2 text-xs font-medium text-ink-subtle">
          Rigid gift box — live cost model
        </span>
      </div>

      <div className="grid min-h-[292px] gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Inputs */}
        <div className="space-y-3.5 border-border/50 p-4 md:border-r">
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { label: 'Length', value: length, set: setLength },
              { label: 'Width', value: width, set: setWidth },
              { label: 'Height', value: height, set: setHeight },
            ].map((field) => (
              <label key={field.label} className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-muted">
                  {field.label} <span className="text-ink-subtle">mm</span>
                </span>
                <input
                  type="number"
                  value={field.value}
                  min={40}
                  max={600}
                  onChange={(event) => field.set(Math.max(0, event.target.valueAsNumber || 0))}
                  className="w-full rounded-lg border border-border/60 bg-surface px-2.5 py-1.5 text-sm font-medium text-ink focus:border-brand focus:outline-hidden"
                />
              </label>
            ))}
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-muted">Lamination</span>
            <select
              value={finish}
              onChange={(event) => setFinish(event.target.value)}
              className="w-full rounded-lg border border-border/60 bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-brand focus:outline-hidden"
            >
              <option value="none">None</option>
              <option value="matt">Matt</option>
              <option value="gloss">Gloss</option>
              <option value="soft-touch">Soft touch</option>
            </select>
          </label>

          {!failed && (
            <div className="space-y-2 border-t border-border/50 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                Where the cost goes
              </p>
              <div className="flex h-2 overflow-hidden rounded-full bg-surface-muted">
                {costParts.map((part, index) => (
                  <span
                    key={part.label}
                    style={{ width: `${(part.value / costTotal) * 100}%` }}
                    className={
                      ['bg-brand', 'bg-brand/70', 'bg-brand/45', 'bg-brand/25'][index] ?? 'bg-brand'
                    }
                  />
                ))}
              </div>
              <dl className="space-y-1">
                {costParts.map((part) => (
                  <div key={part.label} className="flex justify-between text-xs">
                    <dt className="text-ink-muted">{part.label}</dt>
                    <dd className="font-medium text-ink">{money(part.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        {/* Output */}
        <div className="p-4">
          {failed ? (
            <div className="flex h-full flex-col justify-center gap-3 text-center">
              <AlertTriangle className="mx-auto size-6 text-danger" />
              <div>
                <p className="text-sm font-semibold text-ink">This can&rsquo;t be made</p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-ink-muted">
                  {(result as { error: string }).error}
                </p>
              </div>
              <p className="text-[11px] text-ink-subtle">
                The engine catches it here, not on the shop floor.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-baseline justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  Price breaks
                </p>
                {chosen && (
                  <p className="text-xs text-ink-subtle">
                    {(result as Result).leadTimeDays} day
                    {(result as Result).leadTimeDays === 1 ? '' : 's'} on the floor
                  </p>
                )}
              </div>

              <table className="w-full text-sm">
                <tbody className="divide-y divide-border/40">
                  {(result as Result).breaks.map((row) => {
                    const active = row.quantity === quantity;
                    return (
                      <tr
                        key={row.quantity}
                        onClick={() => setQuantity(row.quantity)}
                        className={`cursor-pointer transition-colors ${
                          active ? 'bg-brand-soft/70' : 'hover:bg-surface-muted/50'
                        }`}
                      >
                        <td className="py-1.5 pl-2 text-ink-muted">
                          {row.quantity.toLocaleString()}
                        </td>
                        <td
                          className={`py-1.5 pr-2 text-right tabular-nums ${
                            active ? 'font-bold text-ink' : 'font-medium text-ink'
                          }`}
                        >
                          {money(row.unitPrice)}
                          <span className="text-ink-subtle"> ea</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {chosen && (
                <div className="mt-4 rounded-xl bg-surface-muted/50 px-3 py-2.5">
                  <p className="text-xs text-ink-muted">
                    {quantity.toLocaleString()} boxes at {money(chosen.unitPrice)}
                  </p>
                  <p className="text-lg font-bold tracking-tight text-ink">
                    {money(chosen.totalPrice)}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <p className="border-t border-border/50 bg-surface-muted/30 px-4 py-2 text-[11px] leading-relaxed text-ink-subtle">
        Runs the same engine that prices quotes in the app. These rates are illustrative — in your
        account they&rsquo;re yours.
      </p>
    </div>
  );
}

/** Shown while the interactive demo hydrates, so the layout does not jump. */
export function LiveQuoteDemoSkeleton() {
  return (
    <div className="grid h-[420px] place-items-center rounded-2xl border border-border/60 bg-surface shadow-xl shadow-black/5">
      <Loader2 className="size-5 animate-spin text-ink-subtle" />
    </div>
  );
}
