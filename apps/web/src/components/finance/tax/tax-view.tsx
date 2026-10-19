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
  type VatTreatment,
} from '@saas/shared';
import { useTaxCodes, useTaxReport, useTaxRules, useTaxSettingsAction, useUaeVatStatus } from '@/hooks/use-credits';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/primitives';
import { useOrganization } from '@/hooks/use-organization';
import { FinanceNav } from '../finance-nav';
import { VatSettingsCard } from './vat-settings-card';

const TREATMENT_LABELS: Record<VatTreatment, string> = {
  STANDARD: 'Standard rated',
  ZERO_RATED: 'Zero rated',
  EXEMPT: 'Exempt',
  OUT_OF_SCOPE: 'Out of scope',
  REVERSE_CHARGE: 'Reverse charge',
  BLOCKED: 'Blocked input tax',
  IMPORT_GOODS: 'Import of goods',
};

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

function quarterStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Tax codes, the rules that pick them from an address, and the return figures.
 *
 * Rules read in order of specificity: an exact country beats EU, which beats
 * anywhere. "Needs a tax number" is the business-to-business condition that
 * reverse charge depends on.
 */
export function TaxView() {
  const canManage = useCan({ permission: PERMISSIONS.TAX_MANAGE });
  const { data: codes = [] } = useTaxCodes();
  const { data: rules = [] } = useTaxRules();
  const act = useTaxSettingsAction();
  // No tax:read means this fails; that simply reads as "not UAE mode".
  const uaeMode = useUaeVatStatus().data?.enabled === true;
  const orgIsUae = useOrganization().data?.country === 'AE';

  const [code, setCode] = useState({ code: '', name: '', rate: '', kind: 'SALES' as TaxKind, isReverseCharge: false, treatment: '' as VatTreatment | '' });
  const [rule, setRule] = useState({ kind: 'SALES' as TaxKind, country: '', requiresTaxId: false, taxCodeId: '' });
  const start = quarterStart();
  const [from, setFrom] = useState(iso(start));
  const [to, setTo] = useState(iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1))));
  const report = useTaxReport(from, to);

  const codeName = (id: string) => codes.find((c) => c.id === id);

  return (
    <div className="space-y-6">
      <PageHeader title="Tax" description="Codes, the rules that choose them, and what is owed for a period." />
      <FinanceNav />

      {orgIsUae && <VatSettingsCard />}

      <section aria-labelledby="report-heading" className="rounded border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id="report-heading" className="text-sm font-medium text-ink">
            Tax report
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <label className="flex items-center gap-2">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-line bg-surface px-2 py-1 text-ink" />
            </label>
            <label className="flex items-center gap-2">
              Up to
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-line bg-surface px-2 py-1 text-ink" />
            </label>
          </div>
        </div>
        {report.data ? (
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <ReportTable title="Output tax (sales, less credit notes)" rows={report.data.output} total={report.data.outputTax} />
            <ReportTable title="Input tax (approved supplier bills)" rows={report.data.input} total={report.data.inputTax} />
            <div className="rounded bg-surface-sunk px-4 py-3 lg:col-span-2">
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

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="codes-heading" className="rounded border border-line bg-surface">
          <h2 id="codes-heading" className="border-b border-line px-4 py-3 text-sm font-medium text-ink">
            Tax codes
          </h2>
          <ul className="divide-y divide-line">
            {codes.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-mono text-ink">{c.code}</span>{' '}
                  <span className="text-ink-muted">{c.name}</span>
                </span>
                {uaeMode && canManage && (
                  <select
                    aria-label={`Treatment for ${c.code} (${c.kind.toLowerCase()})`}
                    data-column="treatment"
                    value={c.treatment ?? ''}
                    disabled={act.isPending}
                    onChange={(e) => {
                      const treatment = e.target.value as VatTreatment | '';
                      if (!treatment) return;
                      act.mutate({
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
                          treatment,
                        },
                      });
                    }}
                    className="w-36 shrink-0 rounded border border-line bg-surface px-1 py-0.5 text-xs"
                  >
                    <option value="">Treatment…</option>
                    {treatmentsFor(c).map((t) => (
                      <option key={t} value={t}>
                        {TREATMENT_LABELS[t]}
                      </option>
                    ))}
                  </select>
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
              className="grid gap-2 border-t border-line p-4 sm:grid-cols-6"
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
              <input aria-label="Code" placeholder="STD" value={code.code} onChange={(e) => setCode({ ...code, code: e.target.value })} className="rounded border border-line bg-surface px-2 py-1 text-sm sm:col-span-1" />
              <input aria-label="Name" placeholder="Standard rate" value={code.name} onChange={(e) => setCode({ ...code, name: e.target.value })} className="rounded border border-line bg-surface px-2 py-1 text-sm sm:col-span-2" />
              <input aria-label="Rate %" placeholder="20" type="number" min={0} max={100} step="any" disabled={code.isReverseCharge} value={code.isReverseCharge ? '0' : code.rate} onChange={(e) => setCode({ ...code, rate: e.target.value })} className="rounded border border-line bg-surface px-2 py-1 text-sm" />
              <select aria-label="Kind" value={code.kind} onChange={(e) => {
                const kind = e.target.value as TaxKind;
                setCode({ ...code, kind, treatment: code.treatment && treatmentAllowed(kind, code.treatment) ? code.treatment : '' });
              }} className="rounded border border-line bg-surface px-2 py-1 text-sm">
                <option value="SALES">Sales</option>
                <option value="PURCHASE">Purchase</option>
              </select>
              {uaeMode && (
                <select aria-label="Treatment" required value={code.treatment} onChange={(e) => setCode({ ...code, treatment: e.target.value as VatTreatment | '' })} className="rounded border border-line bg-surface px-2 py-1 text-sm sm:col-span-5">
                  <option value="">Treatment…</option>
                  {VAT_TREATMENTS.filter((t) => treatmentAllowed(code.kind, t)).map((t) => (
                    <option key={t} value={t}>
                      {TREATMENT_LABELS[t]}
                    </option>
                  ))}
                </select>
              )}
              <Button type="submit" size="sm" disabled={!code.code.trim() || !code.name.trim() || (!code.isReverseCharge && code.rate === '') || (uaeMode && !code.treatment)} loading={act.isPending}>
                <Plus className="size-4" />
                Add
              </Button>
              {!uaeMode && (
                <label className="flex items-center gap-2 text-xs text-ink-muted sm:col-span-6">
                  <input type="checkbox" checked={code.isReverseCharge} onChange={(e) => setCode({ ...code, isReverseCharge: e.target.checked })} />
                  Reverse charge — charged at 0%, and the invoice says the customer accounts for the tax
                </label>
              )}
            </form>
          )}
        </section>

        <section aria-labelledby="rules-heading" className="rounded border border-line bg-surface">
          <h2 id="rules-heading" className="border-b border-line px-4 py-3 text-sm font-medium text-ink">
            Rules
          </h2>
          {rules.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-subtle">
              No rules yet, so each line keeps the rate typed or set on its catalog item.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {rules.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="text-ink">
                    {r.kind === 'SALES' ? 'Customers' : 'Suppliers'} in{' '}
                    <strong>{r.country === '*' ? 'anywhere else' : r.country}</strong>
                    {r.requiresTaxId && ' with a tax number'} →{' '}
                    <span className="font-mono">{codeName(r.taxCodeId)?.code ?? '?'}</span>
                  </span>
                  {canManage && (
                    <Button size="sm" variant="ghost" aria-label="Remove rule" onClick={() => act.mutate({ kind: 'deleteRule', id: r.id })}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <form
              className="grid gap-2 border-t border-line p-4 sm:grid-cols-5"
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
              <select aria-label="Applies to" value={rule.kind} onChange={(e) => setRule({ ...rule, kind: e.target.value as TaxKind, taxCodeId: '' })} className="rounded border border-line bg-surface px-2 py-1 text-sm">
                <option value="SALES">Customers</option>
                <option value="PURCHASE">Suppliers</option>
              </select>
              <input aria-label="Country" placeholder="GB, EU or *" maxLength={2} value={rule.country} onChange={(e) => setRule({ ...rule, country: e.target.value })} className="rounded border border-line bg-surface px-2 py-1 text-sm uppercase" />
              <select aria-label="Tax code" value={rule.taxCodeId} onChange={(e) => setRule({ ...rule, taxCodeId: e.target.value })} className="rounded border border-line bg-surface px-2 py-1 text-sm sm:col-span-2">
                <option value="">Tax code…</option>
                {codes
                  .filter((c) => c.kind === rule.kind && c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
              </select>
              <Button type="submit" size="sm" disabled={!rule.country.trim() || !rule.taxCodeId} loading={act.isPending}>
                <Plus className="size-4" />
                Add
              </Button>
              <label className="flex items-center gap-2 text-xs text-ink-muted sm:col-span-5">
                <input type="checkbox" checked={rule.requiresTaxId} onChange={(e) => setRule({ ...rule, requiresTaxId: e.target.checked })} />
                Only when they have a tax / VAT number (business customers)
              </label>
            </form>
          )}
        </section>
      </div>
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
          <tbody className="divide-y divide-line">
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
