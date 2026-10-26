'use client';

import { useVatReturn } from '@/hooks/use-books';
import { Alert } from '@/components/ui/primitives';

const aed = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rows the FTA form lays out under each heading. */
const OUTPUT_BOXES = ['1a', '1b', '1c', '1d', '1e', '1f', '1g', '2', '3', '4', '5', '6', '7', '8'];
const INPUT_BOXES = ['9', '10', '11'];

/**
 * The VAT201 for the period chosen on the tax report, box by box, in AED.
 * Copy the figures into the FTA portal; then lock the books through the
 * period's last day so nothing can change what was filed.
 */
export function VatReturnCard({ from, to }: { from: string; to: string }) {
  const { data, isError, error } = useVatReturn(from, to);

  return (
    <section aria-labelledby="vat201-heading" className="rounded border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 id="vat201-heading" className="text-sm font-medium text-ink">
          VAT return (VAT201)
        </h2>
        <p className="text-xs text-ink-subtle">
          The same period as the tax report above. Once filed, lock the books through its last day under Finance → Journal.
        </p>
      </div>
      {isError ? (
        <div className="p-4">
          <Alert tone="warning">{error instanceof Error ? error.message : 'Could not build the return.'}</Alert>
        </div>
      ) : !data ? (
        <p className="p-4 text-sm text-ink-subtle">Loading…</p>
      ) : (
        <div className="space-y-4 p-4">
          {data.warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
          <div className="grid gap-4 lg:grid-cols-2">
            <BoxTable title="VAT on sales and all other outputs" rows={data.rows.filter((r) => OUTPUT_BOXES.includes(r.box))} withAdjustment />
            <div className="space-y-4">
              <BoxTable title="VAT on expenses and all other inputs" rows={data.rows.filter((r) => INPUT_BOXES.includes(r.box))} />
              <dl className="divide-y divide-line rounded bg-surface-sunk text-sm">
                <Row label="12 · Total value of due tax for the period" value={data.totalDueTax} />
                <Row label="13 · Total value of recoverable tax for the period" value={data.totalRecoverableTax} />
                <Row
                  label={`14 · ${data.payableTax >= 0 ? 'Payable tax for the period' : 'Refund due for the period'}`}
                  value={Math.abs(data.payableTax)}
                  strong
                />
              </dl>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex justify-between px-4 py-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'text-lg font-semibold text-ink' : 'text-ink'}`}>AED {aed(value)}</dd>
    </div>
  );
}

function BoxTable({
  title,
  rows,
  withAdjustment,
}: {
  title: string;
  rows: { box: string; label: string; amount: number; vat: number; adjustment: number }[];
  withAdjustment?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <h3 className="mb-2 text-xs font-medium text-ink-subtle">{title}</h3>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-subtle">
          <tr>
            <th className="py-1 pr-2 font-medium">Box</th>
            <th className="py-1 pr-2 font-medium" />
            <th className="py-1 pr-2 text-right font-medium">Amount (AED)</th>
            <th className="py-1 pr-2 text-right font-medium">VAT (AED)</th>
            {withAdjustment && <th className="py-1 text-right font-medium">Adjustment</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.box} className={r.box === '8' || r.box === '11' ? 'font-semibold' : ''}>
              <td className="py-1 pr-2 font-mono text-xs">{r.box}</td>
              <td className="py-1 pr-2 text-ink-muted">{r.label}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{aed(r.amount)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{aed(r.vat)}</td>
              {withAdjustment && <td className="py-1 text-right tabular-nums">{r.adjustment ? aed(r.adjustment) : ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
