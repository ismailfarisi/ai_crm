'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  quickCostSnapshot,
  type MaterialUom,
  type QuickCostInput,
  type QuickCostPer,
  QUICK_COST_DEFAULT_PER,
  type QuickCostPreviewDto,
  type QuoteLineCostSnapshot,
  type QuoteLineItem,
} from '@saas/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDebounced } from '@/hooks/use-catalog';
import { api, queryKeys } from '@/lib/api/endpoints';
import { cn } from '@/lib/utils';
import { formatCurrency } from './quote-lines-table';

const UOM_WORDS: Record<MaterialUom, { one: string; many: string }> = {
  SHEET: { one: 'sheet', many: 'sheets' },
  METRE: { one: 'metre', many: 'metres' },
  KG: { one: 'kg', many: 'kg' },
  EACH: { one: 'piece', many: 'pieces' },
};
const unitWord = (uom: MaterialUom, n: number) => (n === 1 ? UOM_WORDS[uom].one : UOM_WORDS[uom].many);
const pct = (fraction: number) => `${(fraction * 100).toFixed(1).replace(/\.0$/, '')}%`;
const num = (value: number) => Number(value.toFixed(3)).toString();

const CONTROL =
  'h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-ink focus:border-ink focus:outline-none';

interface MaterialRow { key: string; materialId: string; quantity: string }
interface HoursRow { key: string; workCenterId: string; hours: string; per: QuickCostPer }
interface BoughtInRow { key: string; description: string; amount: string; per: QuickCostPer }

let nextKey = 0;
const key = () => `r${++nextKey}`;

export interface QuickCostResult {
  quickCost: QuickCostInput;
  cost: QuoteLineCostSnapshot;
  /** Set when the estimator chose the suggested price. */
  unitPrice?: number;
}

interface QuickCostDialogProps {
  line: QuoteLineItem | null;
  currency: string;
  onClose: () => void;
  onApply: (lineId: string, result: QuickCostResult) => void;
}

/**
 * Works out what a hand-typed line costs: materials from stock, hours on each
 * machine, anything bought in, and overhead. The server costs it at the
 * catalog's rates and says what price keeps the margin floor; the browser only
 * collects the inputs.
 */
export function QuickCostDialog({ line, currency, onClose, onApply }: QuickCostDialogProps) {
  return line ? (
    <QuickCostForm key={line.id} line={line} currency={currency} onClose={onClose} onApply={onApply} />
  ) : null;
}

function QuickCostForm({ line, currency, onClose, onApply }: QuickCostDialogProps & { line: QuoteLineItem }) {
  const { data: options, isLoading, error: optionsError } = useQuery({
    queryKey: queryKeys.quickCostOptions,
    queryFn: api.catalog.quickCostOptions,
    staleTime: 60_000,
  });
  const quantity = Number(line.quantity) || 1;
  const existing = line.quickCost;
  // Materials are for the whole line, so a costing entered for another
  // quantity opens with them scaled to this one. Hours and bought-in are
  // per piece or whole job and open exactly as entered.
  const [scale] = useState(() =>
    existing && existing.costedForQuantity > 0 ? quantity / existing.costedForQuantity : 1,
  );
  const scaled = (value: number) => num(value * scale);

  const [materials, setMaterials] = useState<MaterialRow[]>(() =>
    (existing?.materials ?? []).map((m) => ({ key: key(), materialId: m.materialId, quantity: scaled(m.quantity) })),
  );
  const [hours, setHours] = useState<HoursRow[]>(() =>
    (existing?.hours ?? []).map((h) => ({
      key: key(),
      workCenterId: h.workCenterId,
      hours: num(h.hours),
      per: h.per ?? QUICK_COST_DEFAULT_PER.hours,
    })),
  );
  const [boughtIn, setBoughtIn] = useState<BoughtInRow[]>(() =>
    (existing?.boughtIn ?? []).map((b) => ({
      key: key(),
      description: b.description,
      amount: String(b.amount),
      per: b.per ?? QUICK_COST_DEFAULT_PER.boughtIn,
    })),
  );
  const [overhead, setOverhead] = useState<string | null>(() =>
    existing ? String(Number((existing.overheadPct * 100).toFixed(2))) : null,
  );
  const overheadText = overhead ?? String(Number(((options?.defaultOverheadPct ?? 0) * 100).toFixed(2)));

  // Only complete rows are costed; a half-filled row waits quietly.
  const input = useMemo<QuickCostInput>(() => {
    const positive = (text: string) => Number(text) > 0;
    return {
      materials: materials
        .filter((m) => m.materialId && positive(m.quantity))
        .map((m) => ({ materialId: m.materialId, quantity: Number(m.quantity) })),
      hours: hours
        .filter((h) => h.workCenterId && positive(h.hours))
        .map((h) => ({ workCenterId: h.workCenterId, hours: Number(h.hours), per: h.per })),
      boughtIn: boughtIn
        .filter((b) => b.description.trim() && positive(b.amount))
        .map((b) => ({ description: b.description.trim(), amount: Number(b.amount), per: b.per })),
      overheadPct: Math.min(1, Math.max(0, (Number(overheadText) || 0) / 100)),
      costedForQuantity: quantity,
    };
  }, [materials, hours, boughtIn, overheadText, quantity]);

  const hasInputs = input.materials.length + input.hours.length + input.boughtIn.length > 0;
  // Asked of the server once the inputs sit still; nothing is costed here.
  const settled = useDebounced(input, 300);
  const previewPayload = {
    quickCost: settled,
    quantity,
    unitPrice: Number(line.unitPrice) || 0,
    discount: Number(line.discount) || 0,
  };
  const previewQuery = useQuery({
    queryKey: ['catalog', 'quick-cost', 'preview', previewPayload],
    queryFn: () => api.catalog.quickCost(previewPayload),
    enabled: hasInputs && settled.materials.length + settled.hours.length + settled.boughtIn.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const preview = hasInputs && !previewQuery.isError ? (previewQuery.data ?? null) : null;
  const previewError =
    hasInputs && previewQuery.error
      ? previewQuery.error instanceof Error
        ? previewQuery.error.message
        : 'Could not work out the cost'
      : null;
  const isPricing = settled !== input || previewQuery.isFetching;

  // Breakdown rows come back in the order of the complete rows sent.
  const completeHours = hours
    .filter((h) => h.workCenterId && Number(h.hours) > 0)
    .map((h) => h.key);
  const completeBoughtIn = boughtIn
    .filter((b) => b.description.trim() && Number(b.amount) > 0)
    .map((b) => b.key);
  const materialById = useMemo(() => new Map((options?.materials ?? []).map((m) => [m.id, m])), [options]);
  const centreById = useMemo(() => new Map((options?.workCenters ?? []).map((w) => [w.id, w])), [options]);
  const breakdown = preview?.breakdown;
  const money = (value: number) => formatCurrency(value, currency);

  const apply = (unitPrice?: number) => {
    if (!preview) return;
    onApply(line.id, { quickCost: input, cost: quickCostSnapshot(preview.breakdown), unitPrice });
  };

  const label = line.description.trim() || 'this line';

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Work out the cost of ${label}`}
      description={`For all ${num(quantity)} on the line. Materials and hours use the rates in your catalog.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => apply()} disabled={!preview || isPricing}>
            Use this costing
          </Button>
        </>
      }
    >
      {isLoading ? (
        <p className="text-sm text-ink-muted">Loading your materials and machines…</p>
      ) : optionsError ? (
        <p className="text-sm text-danger">Could not load your materials and machines.</p>
      ) : (
        <div className="space-y-5">
          <Section title="Materials from stock" hint="How much the whole job uses; it grows if the quantity changes. Waste from the catalog is added.">
            {materials.map((row) => {
              const material = materialById.get(row.materialId);
              const costed = breakdown?.materials.find((m) => m.materialId === row.materialId);
              return (
                <Row
                  key={row.key}
                  onRemove={() => setMaterials((prev) => prev.filter((m) => m.key !== row.key))}
                  removeLabel="Remove material"
                  explain={
                    costed && material
                      ? `${num(costed.purchaseUnits)} ${unitWord(material.uom, costed.purchaseUnits)}${costed.wastePct ? ` with ${pct(costed.wastePct)} waste` : ''} × ${money(costed.unitCost)} = ${money(costed.cost)}`
                      : material
                        ? `${money(material.costPerUom)} per ${UOM_WORDS[material.uom].one}`
                        : undefined
                  }
                >
                  <select
                    aria-label="Material"
                    value={row.materialId}
                    onChange={(e) =>
                      setMaterials((prev) => prev.map((m) => (m.key === row.key ? { ...m, materialId: e.target.value } : m)))
                    }
                    className={cn(CONTROL, 'min-w-0 flex-1 basis-full sm:basis-auto')}
                  >
                    <option value="">Choose a material</option>
                    {(options?.materials ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.sku ? ` (${m.sku})` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Quantity used"
                    inputMode="decimal"
                    value={row.quantity}
                    placeholder="0"
                    onChange={(e) =>
                      setMaterials((prev) => prev.map((m) => (m.key === row.key ? { ...m, quantity: e.target.value } : m)))
                    }
                    className={cn(CONTROL, 'w-24 text-right tabular-nums')}
                  />
                  <span className="w-14 text-xs text-ink-muted">{material ? UOM_WORDS[material.uom].many : ''}</span>
                </Row>
              );
            })}
            <AddButton
              onClick={() => setMaterials((prev) => [...prev, { key: key(), materialId: '', quantity: '' }])}
              disabled={!options?.materials.length}
            >
              {options?.materials.length ? 'Add material' : 'No materials in the catalog yet'}
            </AddButton>
          </Section>

          <Section
            title="Machine and labour hours"
            hint="Hours on each machine or work centre. Each piece grows with the quantity; whole job is once, like setup."
          >
            {hours.map((row) => {
              const centre = centreById.get(row.workCenterId);
              const costed = breakdown?.hours[completeHours.indexOf(row.key)];
              return (
                <Row
                  key={row.key}
                  onRemove={() => setHours((prev) => prev.filter((h) => h.key !== row.key))}
                  removeLabel="Remove hours"
                  explain={
                    costed
                      ? `${costed.per === 'piece' ? `${num(costed.hoursEach)} h × ${num(quantity)} = ` : ''}${num(costed.chargedHours)} h${costed.chargedHours > costed.hours ? ' (minimum charge)' : ''} × ${money(costed.ratePerHour)} an hour = ${money(costed.cost)}`
                      : centre
                        ? `${money(centre.ratePerHour)} an hour, machine and labour`
                        : undefined
                  }
                >
                  <select
                    aria-label="Machine or work centre"
                    value={row.workCenterId}
                    onChange={(e) =>
                      setHours((prev) => prev.map((h) => (h.key === row.key ? { ...h, workCenterId: e.target.value } : h)))
                    }
                    className={cn(CONTROL, 'min-w-0 flex-1 basis-full sm:basis-auto')}
                  >
                    <option value="">Choose a machine or work centre</option>
                    {(options?.workCenters ?? []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Hours"
                    inputMode="decimal"
                    value={row.hours}
                    placeholder="0"
                    onChange={(e) =>
                      setHours((prev) => prev.map((h) => (h.key === row.key ? { ...h, hours: e.target.value } : h)))
                    }
                    className={cn(CONTROL, 'w-24 text-right tabular-nums')}
                  />
                  <PerSelect
                    label="Hours for"
                    unit="h"
                    value={row.per}
                    onChange={(per) => setHours((prev) => prev.map((h) => (h.key === row.key ? { ...h, per } : h)))}
                  />
                </Row>
              );
            })}
            <AddButton
              onClick={() =>
                setHours((prev) => [
                  ...prev,
                  { key: key(), workCenterId: '', hours: '', per: QUICK_COST_DEFAULT_PER.hours },
                ])
              }
              disabled={!options?.workCenters.length}
            >
              {options?.workCenters.length ? 'Add hours' : 'No work centres set up yet'}
            </AddButton>
          </Section>

          <Section
            title="Bought in"
            hint="What you pay a supplier: once for the whole job (a delivery, an installer's day) or for each piece."
          >
            {boughtIn.map((row) => {
              const costed = breakdown?.boughtIn[completeBoughtIn.indexOf(row.key)];
              return (
              <Row
                key={row.key}
                onRemove={() => setBoughtIn((prev) => prev.filter((b) => b.key !== row.key))}
                removeLabel="Remove bought-in item"
                explain={
                  costed?.per === 'piece'
                    ? `${money(costed.amountEach)} × ${num(quantity)} = ${money(costed.amount)}`
                    : undefined
                }
              >
                <input
                  aria-label="What is bought in"
                  value={row.description}
                  placeholder="What you buy"
                  onChange={(e) =>
                    setBoughtIn((prev) => prev.map((b) => (b.key === row.key ? { ...b, description: e.target.value } : b)))
                  }
                  className={cn(CONTROL, 'min-w-0 flex-1 basis-full sm:basis-auto')}
                />
                <input
                  aria-label="What it costs you"
                  inputMode="decimal"
                  value={row.amount}
                  placeholder="0.00"
                  onChange={(e) =>
                    setBoughtIn((prev) => prev.map((b) => (b.key === row.key ? { ...b, amount: e.target.value } : b)))
                  }
                  className={cn(CONTROL, 'w-24 text-right tabular-nums')}
                />
                <PerSelect
                  label="Cost for"
                  unit={currency.toUpperCase()}
                  value={row.per}
                  onChange={(per) =>
                    setBoughtIn((prev) => prev.map((b) => (b.key === row.key ? { ...b, per } : b)))
                  }
                />
              </Row>
              );
            })}
            <AddButton
              onClick={() =>
                setBoughtIn((prev) => [
                  ...prev,
                  { key: key(), description: '', amount: '', per: QUICK_COST_DEFAULT_PER.boughtIn },
                ])
              }
            >
              Add bought-in item
            </AddButton>
          </Section>

          <Section title="Overhead" hint="Rent, power and running costs, added on top of the costs above.">
            <div className="flex items-center gap-2">
              <input
                aria-label="Overhead percent"
                inputMode="decimal"
                value={overheadText}
                onChange={(e) => setOverhead(e.target.value)}
                className={cn(CONTROL, 'w-24 text-right tabular-nums')}
              />
              <span className="text-xs text-ink-muted">
                %{breakdown ? ` of ${money(breakdown.directCost)} = ${money(breakdown.overheadCost)}` : ''}
              </span>
            </div>
          </Section>

          <Summary
            preview={preview}
            error={previewError}
            isPricing={isPricing}
            hasInputs={hasInputs}
            floorEnforced={options?.floorEnforced ?? false}
            unitPrice={Number(line.unitPrice) || 0}
            money={money}
            onUsePrice={(price) => apply(price)}
          />
        </div>
      )}
    </Dialog>
  );
}

function Summary({
  preview,
  error,
  isPricing,
  hasInputs,
  floorEnforced,
  unitPrice,
  money,
  onUsePrice,
}: {
  preview: QuickCostPreviewDto | null;
  error: string | null;
  isPricing: boolean;
  hasInputs: boolean;
  floorEnforced: boolean;
  unitPrice: number;
  money: (value: number) => string;
  onUsePrice: (price: number) => void;
}) {
  if (!hasInputs) {
    return (
      <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink-muted">
        Add a material, some hours or a bought-in item to see the cost.
      </p>
    );
  }
  if (error) return <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>;
  if (!preview) return <p className="px-4 py-3 text-sm text-ink-muted">Working out the cost…</p>;

  const { breakdown, marginPct, marginAmount, targetMarginPct, suggestedUnitPrice } = preview;
  const target = `${pct(targetMarginPct)} ${floorEnforced ? 'margin floor' : 'target margin'}`;
  const belowTarget = marginPct !== null && marginPct < targetMarginPct;
  const parts = [
    breakdown.materialCost && `materials ${money(breakdown.materialCost)}`,
    breakdown.machineCost + breakdown.laborCost && `hours ${money(breakdown.machineCost + breakdown.laborCost)}`,
    breakdown.boughtInCost && `bought in ${money(breakdown.boughtInCost)}`,
    breakdown.overheadCost && `overhead ${money(breakdown.overheadCost)}`,
  ].filter(Boolean);

  return (
    <div className={cn('space-y-3 rounded-xl border border-border/60 px-4 py-3', isPricing && 'opacity-60')} aria-live="polite">
      <SummaryRow
        label="Cost"
        value={money(breakdown.totalCost)}
        explain={`${parts.join(' + ')}${breakdown.quantity !== 1 ? `. ${money(breakdown.unitCost)} each.` : '.'}`}
      />
      <SummaryRow
        label="Margin"
        tone={marginPct === null ? undefined : marginPct < 0 ? 'danger' : belowTarget ? 'warning' : 'success'}
        value={marginPct === null ? 'No price yet' : `${pct(marginPct)} (${money(marginAmount ?? 0)})`}
        explain={
          marginPct === null
            ? 'Put a price on the line to see the margin.'
            : `What is left of ${money(preview.subtotal)} after the cost${belowTarget ? `, below your ${target}` : ''}.`
        }
      />
      {suggestedUnitPrice !== null && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-3">
          <SummaryRow
            label={`Price for ${pct(targetMarginPct)} margin`}
            value={`${money(suggestedUnitPrice)} each`}
            explain={`The lowest price that keeps your ${target}${preview.subtotal > 0 ? ` after the line's discount` : ''}.`}
          />
          {Math.abs(suggestedUnitPrice - unitPrice) >= 0.01 && (
            <Button variant="outline" size="sm" onClick={() => onUsePrice(suggestedUnitPrice)}>
              Use {money(suggestedUnitPrice)}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  explain,
  tone,
}: {
  label: string;
  value: string;
  explain: string;
  tone?: 'danger' | 'warning' | 'success';
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-3">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            tone === 'danger' && 'text-danger',
            tone === 'warning' && 'text-warning',
            tone === 'success' && 'text-success',
          )}
        >
          {value}
        </span>
      </div>
      <p className="text-xs text-ink-muted">{explain}</p>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-xs font-semibold text-ink">{title}</h3>
        <p className="text-xs text-ink-muted">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Row({
  children,
  explain,
  onRemove,
  removeLabel,
}: {
  children: React.ReactNode;
  explain?: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        {children}
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="inline-flex size-8 items-center justify-center rounded text-ink-muted hover:text-danger"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
      {explain && <p className="mt-0.5 text-xs text-ink-muted tabular-nums">{explain}</p>}
    </div>
  );
}

function PerSelect({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: QuickCostPer;
  onChange: (per: QuickCostPer) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as QuickCostPer)}
      className={cn(CONTROL, 'w-36 text-xs')}
    >
      <option value="piece">{unit} each piece</option>
      <option value="job">{unit} whole job</option>
    </select>
  );
}

function AddButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Plus className="size-3.5" aria-hidden />
      {children}
    </button>
  );
}
