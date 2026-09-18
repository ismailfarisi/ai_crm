'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { CURRENCY_OPTIONS, currencyLongLabel, PERMISSIONS } from '@saas/shared';
import { useCurrencyAction, useCurrencySettings, useFxRates } from '@/hooks/use-platform';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/primitives';
import { FinanceNav } from '../finance-nav';

const today = () => new Date().toISOString().slice(0, 10);
const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(0);
  return d.toISOString().slice(0, 7);
};

/**
 * Base currency, exchange rates, and month-end revaluation.
 *
 * Rates are entered as base currency per unit of the other currency — the
 * same way round a bank statement shows them for a home-currency account.
 */
export function CurrenciesView() {
  const canManage = useCan({ permission: PERMISSIONS.FINANCE_MANAGE });
  const { data: settings } = useCurrencySettings();
  const { data: rates = [] } = useFxRates();
  const act = useCurrencyAction();

  const [form, setForm] = useState({ currency: 'EUR', rateDate: today(), rate: '' });
  const [period, setPeriod] = useState(lastMonth());
  const [base, setBase] = useState('');

  const baseCurrency = settings?.baseCurrency ?? '…';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Currencies"
        description={`The ledger is kept in ${baseCurrency}. Every document is converted at the rate on the day it was posted.`}
      />
      <FinanceNav />

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="base-heading" className="rounded border border-line bg-surface p-4">
          <h2 id="base-heading" className="text-sm font-medium text-ink">
            Base currency: <span className="font-mono">{baseCurrency}</span>
          </h2>
          {settings?.canChangeBaseCurrency ? (
            canManage && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (base) act.mutate({ kind: 'setBase', currency: base });
                }}
              >
                <select value={base} onChange={(e) => setBase(e.target.value)} aria-label="Base currency" className="rounded border border-line bg-surface px-2 py-1 text-sm">
                  <option value="">Change to…</option>
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {currencyLongLabel(c.code)}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" disabled={!base} loading={act.isPending}>
                  Set
                </Button>
              </form>
            )
          ) : (
            <p className="mt-2 text-sm text-ink-subtle">Fixed now that entries have been posted in it.</p>
          )}

          <h3 className="mt-5 text-sm font-medium text-ink">Other currencies in use</h3>
          {settings?.currencies.length ? (
            <ul className="mt-2 divide-y divide-line text-sm">
              {settings.currencies.map((c) => (
                <li key={c.currency} className="flex justify-between py-1.5">
                  <span className="font-mono text-ink">{c.currency}</span>
                  <span className={c.latestRate ? 'tabular-nums text-ink-muted' : 'text-danger'}>
                    {c.latestRate
                      ? `1 ${c.currency} = ${c.latestRate} ${baseCurrency} (${c.latestRateDate})`
                      : 'No rate — documents in it cannot be posted'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-subtle">Everything so far is in {baseCurrency}.</p>
          )}
        </section>

        <section aria-labelledby="reval-heading" className="rounded border border-line bg-surface p-4">
          <h2 id="reval-heading" className="text-sm font-medium text-ink">
            Month-end revaluation
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Restates open foreign-currency invoices and bills at the last day&apos;s rate, and reverses on the first of the
            next month so the real gain or loss is taken when they settle.
          </p>
          {canManage && (
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                act.mutate({ kind: 'revalue', period: `${period}-01` });
              }}
            >
              <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Month" className="rounded border border-line bg-surface px-2 py-1 text-sm" />
              <Button type="submit" size="sm" loading={act.isPending}>
                Revalue
              </Button>
            </form>
          )}
        </section>
      </div>

      <section aria-labelledby="rates-heading" className="rounded border border-line bg-surface">
        <h2 id="rates-heading" className="border-b border-line px-4 py-3 text-sm font-medium text-ink">
          Exchange rates
        </h2>
        {canManage && (
          <form
            className="flex flex-wrap items-end gap-2 border-b border-line p-4"
            onSubmit={(e) => {
              e.preventDefault();
              act.mutate(
                { kind: 'rate', currency: form.currency.toUpperCase(), rateDate: form.rateDate, rate: Number(form.rate) },
                { onSuccess: () => setForm({ ...form, rate: '' }) },
              );
            }}
          >
            <label className="text-xs text-ink-subtle">
              Currency
              <input value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="mt-1 block w-20 rounded border border-line bg-surface px-2 py-1 text-sm uppercase text-ink" />
            </label>
            <label className="text-xs text-ink-subtle">
              Date
              <input type="date" value={form.rateDate} onChange={(e) => setForm({ ...form, rateDate: e.target.value })} className="mt-1 block rounded border border-line bg-surface px-2 py-1 text-sm text-ink" />
            </label>
            <label className="text-xs text-ink-subtle">
              1 {form.currency.toUpperCase() || '…'} = ? {baseCurrency}
              <input type="number" step="any" min={0} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} className="mt-1 block w-32 rounded border border-line bg-surface px-2 py-1 text-sm tabular-nums text-ink" />
            </label>
            <Button type="submit" size="sm" disabled={!(Number(form.rate) > 0) || form.currency.length !== 3} loading={act.isPending}>
              Save rate
            </Button>
          </form>
        )}
        {rates.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-subtle">No rates yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Currency</th>
                  <th className="px-4 py-2 text-right font-medium">Rate</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rates.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 tabular-nums">{r.rateDate}</td>
                    <td className="px-4 py-2 font-mono">{r.currency}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.rate} {baseCurrency}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {canManage && (
                        <Button size="sm" variant="ghost" aria-label="Delete rate" onClick={() => act.mutate({ kind: 'deleteRate', id: r.id })}>
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
