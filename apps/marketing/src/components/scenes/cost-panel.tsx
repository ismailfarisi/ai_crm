'use client';

import { useState } from 'react';
import { SceneFrame } from '../ui';

/**
 * Illustrative breakdowns for the hero's rigid-box quote. Setup time spread
 * over fewer boxes is why the small run costs more per unit. Lines must sum to
 * `unitCost`, and 5,000 must agree with the hero thread (cost 3.18, price 4.60).
 */
const RUNS = {
  1000: {
    sheets: 250,
    lines: [
      ['Board', 1.46],
      ['Print & foil', 1.12],
      ['Machine time', 1.21],
      ['Labour', 1.13],
    ],
    unitCost: 4.92,
    unitPrice: 6.9,
  },
  5000: {
    sheets: 1250,
    lines: [
      ['Board', 1.42],
      ['Print & foil', 0.64],
      ['Machine time', 0.58],
      ['Labour', 0.54],
    ],
    unitCost: 3.18,
    unitPrice: 4.6,
  },
} as const;

type Qty = keyof typeof RUNS;

export function CostPanel() {
  const [qty, setQty] = useState<Qty>(5000);
  const run = RUNS[qty];
  const margin = (run.unitPrice - run.unitCost) / run.unitPrice;

  return (
    <SceneFrame title="Q-1042 · Rigid box 200×150×60 · Al Noor Sweets">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-ink-muted">Quantity</p>
          <div role="radiogroup" aria-label="Quantity" className="flex rounded-xl bg-paper p-1">
            {([1000, 5000] as const).map((q) => (
              <button
                key={q}
                type="button"
                role="radio"
                aria-checked={qty === q}
                onClick={() => setQty(q)}
                className={`rounded-lg px-3 py-1.5 font-mono text-sm transition ${
                  qty === q ? 'bg-white shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {q.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-4 text-xs text-ink-subtle">
          4-up on 1000×700 greyboard · {run.sheets.toLocaleString()} sheets
        </p>

        <table className="mt-3 w-full text-sm">
          <tbody>
            {run.lines.map(([label, value]) => (
              <tr key={label} className="border-b border-line">
                <td className="py-2.5 text-ink-muted">{label}</td>
                <td className="w-1/2 px-4 py-2.5">
                  <div className="h-1.5 rounded-full bg-paper">
                    <div
                      className="h-1.5 rounded-full bg-ink/70 transition-all duration-500"
                      style={{ width: `${(value / run.unitCost) * 100}%` }}
                    />
                  </div>
                </td>
                <td className="py-2.5 text-right font-mono">{value.toFixed(2)}</td>
              </tr>
            ))}
            <tr>
              <td className="pt-3 font-medium">Unit cost</td>
              <td />
              <td className="pt-3 text-right font-mono font-medium">AED {run.unitCost.toFixed(2)}</td>
            </tr>
            <tr>
              <td className="pt-1.5 font-medium">Unit price</td>
              <td />
              <td className="pt-1.5 text-right font-mono font-medium">AED {run.unitPrice.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-good-soft px-4 py-3">
          <span className="text-sm font-medium">Margin {Math.round(margin * 100)}%</span>
          <span className="text-xs text-ink-muted">Floor 25% · passes</span>
        </div>
      </div>
    </SceneFrame>
  );
}
