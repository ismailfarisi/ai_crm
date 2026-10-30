'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Clock, Loader2, Plus, TriangleAlert } from 'lucide-react';
import type { ProductTemplateDto, TemplateParameter } from '@saas/shared';
import { PERMISSIONS } from '@saas/shared';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/session-context';
import { usePriceBreaks } from '@/hooks/use-catalog';
import { cn } from '@/lib/utils';
import { formatCurrency } from './quote-lines-table';
import { BlankPreview } from './blank-preview';

type ParameterValue = string | number | boolean;

interface TemplateConfiguratorProps {
  template: ProductTemplateDto;
  currency?: string;
  onBack: () => void;
  onAdd: (input: { quantity: number; parameters: Record<string, ParameterValue> }) => void;
  isAdding?: boolean;
}

const DEFAULT_QUANTITIES = [100, 250, 500, 1000, 2500];

function initialValue(parameter: TemplateParameter): ParameterValue {
  if (parameter.defaultValue !== undefined) return parameter.defaultValue;
  if (parameter.type === 'BOOLEAN') return false;
  if (parameter.type === 'ENUM') return parameter.options?.[0] ?? '';
  return parameter.min ?? 0;
}

/**
 * Dimensions and options in, a price break table out.
 *
 * Every number shown here is computed by the API. The browser holds the form
 * state and nothing else — which is what keeps the preview and the saved quote
 * from ever disagreeing.
 */
export function TemplateConfigurator({
  template,
  currency = 'USD',
  onBack,
  onAdd,
  isAdding = false,
}: TemplateConfiguratorProps) {
  const canSeeCost = useCan({ permission: PERMISSIONS.QUOTE_VIEW_COST });

  const [parameters, setParameters] = useState<Record<string, ParameterValue>>(() =>
    Object.fromEntries(template.parameters.map((p) => [p.key, initialValue(p)])),
  );
  const [quantity, setQuantity] = useState(500);

  const quantities = useMemo(() => {
    // Always price the quantity the user actually wants, alongside the
    // standard ladder, so the row they will pick is never interpolated.
    const set = new Set([...DEFAULT_QUANTITIES, quantity].filter((n) => n > 0));
    return [...set].sort((a, b) => a - b).slice(0, 12);
  }, [quantity]);

  const { data, isLoading, error } = usePriceBreaks(
    template.id,
    { parameters, quantities, toolingAlreadyOwned: [] },
    true,
  );

  const chosen = data?.breaks.find((row) => row.quantity === quantity) ?? null;

  const setParameter = (key: string, value: ParameterValue) =>
    setParameters((prev) => ({ ...prev, [key]: value }));

  const dimensions = {
    length: Number(parameters.length_mm) || 0,
    width: Number(parameters.width_mm) || 0,
    height: Number(parameters.height_mm) || 0,
  };
  const hasBoxDimensions = dimensions.length > 0 && dimensions.width > 0 && dimensions.height > 0;

  return (
    <div className="flex max-h-[78vh] flex-col">
      <div className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          aria-label="Back to catalog"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-ink">{template.name}</h2>
          <p className="truncate text-xs text-ink-muted">
            {template.description || 'Set the size and options, then pick a quantity.'}
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[1fr_1.1fr]">
        {/* Parameters */}
        <div className="space-y-4 border-border/30 p-5 lg:border-r">
          <div className="grid grid-cols-2 gap-3">
            {template.parameters.map((parameter) => (
              <label
                key={parameter.key}
                className={cn('block', parameter.type === 'BOOLEAN' && 'col-span-2')}
              >
                <span className="mb-1 block text-xs font-medium text-ink-muted">
                  {parameter.label}
                  {parameter.unit ? (
                    <span className="text-ink-subtle"> ({parameter.unit})</span>
                  ) : null}
                </span>

                {parameter.type === 'NUMBER' && (
                  <input
                    type="number"
                    value={String(parameters[parameter.key] ?? '')}
                    min={parameter.min}
                    max={parameter.max}
                    onChange={(event) =>
                      setParameter(parameter.key, event.target.valueAsNumber || 0)
                    }
                    className="h-10 w-full rounded-xl border border-border-control bg-surface px-2.5 text-sm text-ink tabular-nums focus:border-brand-ring focus:ring-1 focus:ring-brand-ring focus:outline-hidden"
                  />
                )}

                {parameter.type === 'ENUM' && (
                  <select
                    value={String(parameters[parameter.key] ?? '')}
                    onChange={(event) => setParameter(parameter.key, event.target.value)}
                    className="h-10 w-full rounded-xl border border-border-control bg-surface px-2.5 text-sm text-ink tabular-nums focus:border-brand-ring focus:ring-1 focus:ring-brand-ring focus:outline-hidden"
                  >
                    {(parameter.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                )}

                {parameter.type === 'BOOLEAN' && (
                  <span className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      checked={Boolean(parameters[parameter.key])}
                      onChange={(event) => setParameter(parameter.key, event.target.checked)}
                      className="size-4 rounded border-border-control accent-brand"
                    />
                    <span className="text-sm text-ink-muted">Include</span>
                  </span>
                )}

                {parameter.help && (
                  <span className="mt-1 block text-xs text-ink-muted">{parameter.help}</span>
                )}
              </label>
            ))}
          </div>

          <label className="block border-t border-border/30 pt-4">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Order quantity
            </span>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Math.round(event.target.valueAsNumber || 1)))}
              className="h-10 w-full rounded-xl border border-border-control bg-surface px-2.5 text-sm text-ink tabular-nums focus:border-brand-ring focus:ring-1 focus:ring-brand-ring focus:outline-hidden font-semibold"
            />
          </label>

          {hasBoxDimensions && (
            <BlankPreview
              lengthMm={dimensions.length}
              widthMm={dimensions.width}
              heightMm={dimensions.height}
            />
          )}
        </div>

        {/* Price breaks */}
        <div className="space-y-3 p-5">
          {error ? (
            /* A custom shape that does not fit any sheet lands here. The engine
               explains exactly which blank and which stock, so show that
               sentence rather than a generic failure. */
            <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft/40 px-4 py-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
              <div>
                <p className="text-sm font-semibold text-ink">This configuration cannot be made</p>
                <p className="mt-0.5 text-xs text-ink-muted">{error}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Price breaks
                </h3>
                {isLoading && <Loader2 className="size-3.5 animate-spin text-ink-subtle" />}
              </div>

              <div className="overflow-hidden rounded-xl border border-border/60">
                <table className="w-full text-left text-sm tabular-nums">
                  <thead className="bg-surface-muted/40 text-xs uppercase tracking-wider text-ink-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Qty</th>
                      <th className="px-3 py-2 text-right font-semibold">Unit</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                      {canSeeCost && <th className="px-3 py-2 text-right font-semibold">Margin</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {(data?.breaks ?? []).map((row) => (
                      <tr
                        key={row.quantity}
                        onClick={() => setQuantity(row.quantity)}
                        className={cn(
                          'cursor-pointer transition-colors',
                          row.quantity === quantity
                            ? 'bg-brand-soft/60 font-semibold'
                            : 'hover:bg-surface-muted/40',
                        )}
                      >
                        <td className="px-3 py-2 text-ink tabular-nums">
                          {/* The row is the click target; this is its keyboard and screen-reader twin. */}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setQuantity(row.quantity);
                            }}
                            aria-pressed={row.quantity === quantity}
                            aria-label={`Quote ${row.quantity.toLocaleString()}`}
                            className="rounded underline-offset-2 hover:underline"
                          >
                            {row.quantity.toLocaleString()}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right text-ink">
                          {formatCurrency(row.unitPrice, currency)}
                        </td>
                        <td className="px-3 py-2 text-right text-ink-muted">
                          {formatCurrency(row.totalPrice, currency)}
                        </td>
                        {canSeeCost && (
                          <td className="px-3 py-2 text-right text-ink-muted">
                            {(row.marginPct * 100).toFixed(1)}%
                          </td>
                        )}
                      </tr>
                    ))}
                    {!data && isLoading && (
                      <tr>
                        <td colSpan={canSeeCost ? 4 : 3} className="px-3 py-8 text-center text-xs text-ink-muted">
                          Pricing…
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {data && data.breaks.length > 1 && (
                <p className="text-xs leading-relaxed text-ink-muted">
                  Unit price falls in steps, not smoothly — sheets are bought whole and setup is
                  charged once per run.
                </p>
              )}

              {data?.warnings.map((warning) => (
                <div
                  key={warning}
                  className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                  <p className="text-xs leading-relaxed text-ink-muted">{warning}</p>
                </div>
              ))}

              {data && (
                <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <Clock className="size-3.5" />
                  About {data.leadTimeDays} working day{data.leadTimeDays === 1 ? '' : 's'} on the
                  floor at this quantity
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/30 bg-surface-muted/20 px-5 py-3">
        <div className="min-w-0 text-sm tabular-nums">
          {chosen ? (
            <>
              <span className="font-semibold text-ink">
                {formatCurrency(chosen.unitPrice, currency)}
              </span>
              <span className="text-ink-subtle"> × {quantity.toLocaleString()} = </span>
              <span className="font-semibold text-ink">
                {formatCurrency(chosen.totalPrice, currency)}
              </span>
            </>
          ) : (
            <span className="text-ink-subtle">Choose a quantity</span>
          )}
        </div>

        <Button
          type="button"
          variant="primary"
          loading={isAdding}
          disabled={!chosen || Boolean(error)}
          onClick={() => onAdd({ quantity, parameters })}
          className="shrink-0"
        >
          <Plus className="size-4" aria-hidden />
          Add to quote
        </Button>
      </div>
    </div>
  );
}
