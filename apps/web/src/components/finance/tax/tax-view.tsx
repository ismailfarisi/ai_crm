'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  expectedUaeRate,
  PERMISSIONS,
  treatmentAllowed,
  VAT_TREATMENTS,
  type TaxCodeDto,
  type TaxKind,
  type TaxReportRow,
  type TaxRuleDto,
  type VatTreatment,
} from '@saas/shared';
import { useTaxCodes, useTaxReport, useTaxRules, useTaxSettingsAction, useUaeVatStatus } from '@/hooks/use-credits';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/primitives';
import { useOrganization } from '@/hooks/use-organization';
import { FinanceNav } from '../finance-nav';
import { VatSettingsCard } from './vat-settings-card';
import { VatReturnCard } from './vat-return-card';
import { currentTaxRange, type TaxRange } from './vat-period';
import { describeTreatmentChange } from './vat-boxes';

const TREATMENT_LABELS: Record<VatTreatment, string> = {
  STANDARD: 'Standard rated',
  ZERO_RATED: 'Zero rated',
  EXEMPT: 'Exempt',
  OUT_OF_SCOPE: 'Out of scope',
  REVERSE_CHARGE: 'Reverse charge',
  BLOCKED: 'Blocked input tax',
  IMPORT_GOODS: 'Import of goods',
};

const KIND_OPTIONS = [
  { value: 'SALES', label: 'Sales' },
  { value: 'PURCHASE', label: 'Purchase' },
];

/**
 * What a code's rate reads as. A UAE purchase reverse charge or import is
 * self-assessed at its rate, so both facts are shown; an EU (or UAE sales)
 * reverse charge is a 0% notice and reads as reverse charge alone.
 */
function rateLabel(c: TaxCodeDto): string {
  const selfAssessed = c.kind === 'PURCHASE' && (c.treatment === 'REVERSE_CHARGE' || c.treatment === 'IMPORT_GOODS');
  if (selfAssessed) return `${c.rate}% reverse charge`;
  return c.isReverseCharge ? 'reverse charge' : `${c.rate}%`;
}

/**
 * Treatments a code can switch to without changing its rate. In UAE mode the
 * rate follows the treatment, so offering any other would only be refused.
 */
const treatmentsFor = (c: TaxCodeDto) =>
  VAT_TREATMENTS.filter((t) => treatmentAllowed(c.kind, t) && expectedUaeRate(c.kind, t) === Number(c.rate));

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ruleSentence = (r: TaxRuleDto) =>
  `${r.kind === 'SALES' ? 'Customers' : 'Suppliers'} in ${r.country === '*' ? 'anywhere else' : r.country}${r.requiresTaxId ? ' with a tax number' : ''}`;

/**
 * Tax codes, the rules that pick them from an address, and the return figures.
 *
 * Rules read in order of specificity: an exact country beats EU, which beats
 * anywhere. "Needs a tax number" is the business-to-business condition that
 * reverse charge depends on.
 *
 * The period opens on the current VAT period (or the one in the link), the
 * same one the Finance overview reports. Changing a code's treatment and
 * removing a rule both ask first, because each changes what lands on returns.
 */
export function TaxView({ initialRange }: { initialRange?: TaxRange } = {}) {
  const canManage = useCan({ permission: PERMISSIONS.TAX_MANAGE });
  const { data: codes = [] } = useTaxCodes();
  const { data: rules = [] } = useTaxRules();
  const act = useTaxSettingsAction();
  // No tax:read means this fails; that simply reads as "not UAE mode".
  const vatStatus = useUaeVatStatus();
  const uaeMode = vatStatus.data?.enabled === true;
  const orgIsUae = useOrganization().data?.country === 'AE';

  const [code, setCode] = useState({ code: '', name: '', rate: '', kind: 'SALES' as TaxKind, isReverseCharge: false, treatment: '' as VatTreatment | '' });
  const [rule, setRule] = useState({ kind: 'SALES' as TaxKind, country: '', requiresTaxId: false, taxCodeId: '' });
  // Until a date is picked, the period follows the VAT settings as they load.
  const [picked, setPicked] = useState<TaxRange | null>(initialRange ?? null);
  const { from, to } = picked ?? currentTaxRange(vatStatus.data?.settings);
  const report = useTaxReport(from, to);

  const [retreating, setRetreating] = useState<{ code: TaxCodeDto; treatment: VatTreatment } | null>(null);
  const [removingRule, setRemovingRule] = useState<TaxRuleDto | null>(null);

  const codeName = (id: string) => codes.find((c) => c.id === id);

  return (
    <div className="space-y-6">
      <PageHeader title="Tax" description="Codes, the rules that choose them, and what is owed for a period." />
      <FinanceNav />

      {orgIsUae && <VatSettingsCard />}

      <section aria-labelledby="report-heading" className="rounded-2xl border border-border bg-surface">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id="report-heading" className="pb-2 text-sm font-semibold text-ink">
            Tax report
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <Input
              type="date"
              label="From"
              value={from}
              onChange={(e) => setPicked({ from: e.target.value, to })}
              containerClassName="w-40"
            />
            <Input
              type="date"
              label="Up to"
              value={to}
              onChange={(e) => setPicked({ from, to: e.target.value })}
              containerClassName="w-40"
            />
          </div>
        </div>
        {report.data ? (
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <ReportTable title="Output tax (sales, less credit notes)" rows={report.data.output} total={report.data.outputTax} />
            <ReportTable title="Input tax (approved supplier bills)" rows={report.data.input} total={report.data.inputTax} />
            <div className="rounded-xl bg-surface-sunk px-4 py-3 lg:col-span-2">
              <p className="text-sm text-ink-muted">
                {report.data.netPayable >= 0 ? 'Owed to the tax authority' : 'Reclaimable from the tax authority'}
              </p>
              <p className="text-2xl font-semibold tabular-nums text-ink">{money(Math.abs(report.data.netPayable))}</p>
              {report.data.reverseChargeNet > 0 && (
                <p className="mt-1 text-xs text-ink-subtle">
                  Includes {money(report.data.reverseChargeNet)} of reverse-charge sales, reported with no tax charged.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="p-4 text-sm text-ink-subtle">{report.isError ? 'Could not load the report.' : 'Loading…'}</p>
        )}
      </section>

      {uaeMode && <VatReturnCard from={from} to={to} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="codes-heading" className="rounded-2xl border border-border bg-surface">
          <h2 id="codes-heading" className="border-b border-border px-4 py-3 text-sm font-semibold text-ink">
            Tax codes
          </h2>
          <ul className="divide-y divide-border">
            {codes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-mono text-ink">{c.code}</span>{' '}
                  <span className="text-ink-muted">{c.name}</span>
                </span>
                {uaeMode && canManage && (
                  <Select
                    aria-label={`Treatment for ${c.code} (${c.kind.toLowerCase()})`}
                    data-column="treatment"
                    value={c.treatment ?? ''}
                    disabled={act.isPending}
                    placeholder="Treatment…"
                    options={treatmentsFor(c).map((t) => ({ value: t, label: TREATMENT_LABELS[t] }))}
                    onChange={(e) => {
                      const treatment = e.target.value as VatTreatment | '';
                      // Nothing is saved until the change is confirmed.
                      if (treatment && treatment !== c.treatment) setRetreating({ code: c, treatment });
                    }}
                    containerClassName="w-44 shrink-0"
                  />
                )}
                {uaeMode && !canManage && (
                  <span className="w-32 shrink-0 text-xs text-ink-muted" data-column="treatment">
                    {c.treatment ? TREATMENT_LABELS[c.treatment] : '—'}
                  </span>
                )}
                <span className="shrink-0 text-xs text-ink-subtle">
                  {c.kind.toLowerCase()} · {rateLabel(c)}
                  {!c.isActive && ' · inactive'}
                </span>
              </li>
            ))}
          </ul>
          {canManage && (
            <form
              aria-label="Add a tax code"
              className="grid items-end gap-3 border-t border-border p-4 sm:grid-cols-6"
              onSubmit={(e) => {
                e.preventDefault();
                act.mutate(
                  {
                    kind: 'createCode',
                    input: {
                      code: code.code.trim(),
                      name: code.name.trim(),
                      rate: code.isReverseCharge ? 0 : Number(code.rate),
                      kind: code.kind,
                      isReverseCharge: code.isReverseCharge,
                      ledgerAccountId: null,
                      isActive: true,
                      treatment: code.treatment || null,
                    },
                  },
                  { onSuccess: () => setCode({ code: '', name: '', rate: '', kind: code.kind, isReverseCharge: false, treatment: '' }) },
                );
              }}
            >
              <Input label="Code" placeholder="SR" value={code.code} onChange={(e) => setCode({ ...code, code: e.target.value })} containerClassName="sm:col-span-2" />
              <Input label="Name" placeholder="Standard rate" value={code.name} onChange={(e) => setCode({ ...code, name: e.target.value })} containerClassName="sm:col-span-4" />
              <Input
                label="Rate %"
                placeholder="5"
                type="number"
                min={0}
                max={100}
                step="any"
                inputMode="decimal"
                disabled={code.isReverseCharge}
                value={code.isReverseCharge ? '0' : code.rate}
                onChange={(e) => setCode({ ...code, rate: e.target.value })}
                containerClassName="sm:col-span-2"
              />
              <Select
                label="Kind"
                value={code.kind}
                options={KIND_OPTIONS}
                onChange={(e) => {
                  const kind = e.target.value as TaxKind;
                  setCode({ ...code, kind, treatment: code.treatment && treatmentAllowed(kind, code.treatment) ? code.treatment : '' });
                }}
                containerClassName="sm:col-span-2"
              />
              {uaeMode && (
                <Select
                  label="Treatment"
                  required
                  value={code.treatment}
                  placeholder="Treatment…"
                  options={VAT_TREATMENTS.filter((t) => treatmentAllowed(code.kind, t)).map((t) => ({ value: t, label: TREATMENT_LABELS[t] }))}
                  onChange={(e) => setCode({ ...code, treatment: e.target.value as VatTreatment | '' })}
                  containerClassName="sm:col-span-6"
                />
              )}
              <Button
                type="submit"
                className="sm:col-span-2"
                disabled={!code.code.trim() || !code.name.trim() || (!code.isReverseCharge && code.rate === '') || (uaeMode && !code.treatment)}
                loading={act.isPending}
              >
                <Plus className="size-4" />
                Add code
              </Button>
              {!uaeMode && (
                <label className="flex items-center gap-2 text-xs text-ink-muted sm:col-span-6">
                  <input type="checkbox" className="size-4 accent-brand" checked={code.isReverseCharge} onChange={(e) => setCode({ ...code, isReverseCharge: e.target.checked })} />
                  Reverse charge — charged at 0%, and the invoice says the customer accounts for the tax
                </label>
              )}
            </form>
          )}
        </section>

        <section aria-labelledby="rules-heading" className="rounded-2xl border border-border bg-surface">
          <h2 id="rules-heading" className="border-b border-border px-4 py-3 text-sm font-semibold text-ink">
            Rules
          </h2>
          {rules.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-subtle">
              No rules yet, so each line keeps the rate typed or set on its catalog item.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rules.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="text-ink">
                    {ruleSentence(r)} →{' '}
                    <span className="font-mono">{codeName(r.taxCodeId)?.code ?? '?'}</span>
                  </span>
                  {canManage && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove the rule for ${ruleSentence(r).toLowerCase()}`}
                      onClick={() => setRemovingRule(r)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <form
              aria-label="Add a rule"
              className="grid items-end gap-3 border-t border-border p-4 sm:grid-cols-6"
              onSubmit={(e) => {
                e.preventDefault();
                act.mutate(
                  {
                    kind: 'createRule',
                    input: {
                      kind: rule.kind,
                      country: rule.country.trim().toUpperCase(),
                      requiresTaxId: rule.requiresTaxId,
                      taxCodeId: rule.taxCodeId,
                      priority: 0,
                    },
                  },
                  { onSuccess: () => setRule({ ...rule, country: '', taxCodeId: '' }) },
                );
              }}
            >
              <Select
                label="Applies to"
                value={rule.kind}
                options={[
                  { value: 'SALES', label: 'Customers' },
                  { value: 'PURCHASE', label: 'Suppliers' },
                ]}
                onChange={(e) => setRule({ ...rule, kind: e.target.value as TaxKind, taxCodeId: '' })}
                containerClassName="sm:col-span-3"
              />
              <Input
                label="Country"
                placeholder="AE, EU or *"
                maxLength={2}
                value={rule.country}
                onChange={(e) => setRule({ ...rule, country: e.target.value })}
                className="uppercase"
                containerClassName="sm:col-span-3"
              />
              <Select
                label="Tax code"
                value={rule.taxCodeId}
                placeholder="Tax code…"
                options={codes
                  .filter((c) => c.kind === rule.kind && c.isActive)
                  .map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
                onChange={(e) => setRule({ ...rule, taxCodeId: e.target.value })}
                containerClassName="sm:col-span-4"
              />
              <Button type="submit" className="sm:col-span-2" disabled={!rule.country.trim() || !rule.taxCodeId} loading={act.isPending}>
                <Plus className="size-4" />
                Add rule
              </Button>
              <label className="flex items-center gap-2 text-xs text-ink-muted sm:col-span-6">
                <input type="checkbox" className="size-4 accent-brand" checked={rule.requiresTaxId} onChange={(e) => setRule({ ...rule, requiresTaxId: e.target.checked })} />
                Only when they have a tax / VAT number (business customers)
              </label>
            </form>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={retreating !== null}
        onClose={() => setRetreating(null)}
        title={
          retreating
            ? `Treat '${retreating.code.name}' as ${TREATMENT_LABELS[retreating.treatment].toLowerCase()}?`
            : ''
        }
        description={retreating ? describeTreatmentChange(retreating.code, retreating.treatment) : undefined}
        confirmLabel="Change treatment"
        onConfirm={() => {
          if (!retreating) return;
          const c = retreating.code;
          return act.mutateAsync({
            kind: 'updateCode',
            id: c.id,
            input: {
              code: c.code,
              name: c.name,
              rate: Number(c.rate),
              kind: c.kind,
              isReverseCharge: c.isReverseCharge,
              ledgerAccountId: c.ledgerAccountId,
              isActive: c.isActive,
              treatment: retreating.treatment,
            },
          });
        }}
      />

      <ConfirmDialog
        open={removingRule !== null}
        onClose={() => setRemovingRule(null)}
        title="Remove this rule?"
        description={
          removingRule
            ? `${ruleSentence(removingRule)} will no longer get ${codeName(removingRule.taxCodeId)?.code ?? 'its code'} chosen for them. New lines keep the rate typed or set on the catalog item. Documents already raised are not changed.`
            : undefined
        }
        confirmLabel="Remove rule"
        tone="danger"
        onConfirm={() => (removingRule ? act.mutateAsync({ kind: 'deleteRule', id: removingRule.id }) : undefined)}
      />
    </div>
  );
}

function ReportTable({ title, rows, total }: { title: string; rows: TaxReportRow[]; total: number }) {
  return (
    <div className="overflow-x-auto">
      <h3 className="mb-2 text-sm font-medium text-ink">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-subtle">Nothing in this period.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-subtle">
            <tr>
              <th className="py-1 font-medium">Code</th>
              <th className="py-1 text-right font-medium">Net</th>
              <th className="py-1 text-right font-medium">Tax</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={`${r.taxCodeId ?? r.code}-${r.rate}-${r.reverseCharge}`}>
                <td className="py-1.5 text-ink">
                  {r.code} <span className="text-ink-subtle">{r.reverseCharge ? 'reverse charge' : `${r.rate}%`}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{money(r.net)}</td>
                <td className="py-1.5 text-right tabular-nums">{money(r.tax)}</td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="py-1.5">Total</td>
              <td />
              <td className="py-1.5 text-right tabular-nums">{money(total)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
