'use client';

import { useState } from 'react';

export type NestingCase = {
  width: number;
  perSheet: number;
  across: number;
  down: number;
  /** Blank size as laid on the sheet, after any rotation. */
  blankW: number;
  blankH: number;
  sheets: number;
};

export function NestingDemoView({
  cases,
  sheet,
  margin,
  order,
}: {
  cases: NestingCase[];
  sheet: { w: number; h: number };
  margin: number;
  order: number;
}) {
  const [index, setIndex] = useState(0);
  const current = cases[index];
  const base = cases[0];
  const extra = current.sheets - base.sheets;

  return (
    <div className="rounded-2xl border border-line bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">
          Blank width <span className="text-ink-subtle">· 1000 × 700 mm greyboard sheet</span>
        </p>
        <div role="radiogroup" aria-label="Blank width" className="flex rounded-xl bg-paper p-1">
          {cases.map((c, i) => (
            <button
              key={c.width}
              type="button"
              role="radio"
              aria-checked={index === i}
              onClick={() => setIndex(i)}
              className={`rounded-lg px-3 py-1.5 font-mono text-sm transition ${
                index === i ? 'bg-white shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {c.width} mm
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${sheet.w} ${sheet.h}`}
        className="mt-5 w-full rounded-lg bg-[oklch(0.93_0.025_75)]"
        role="img"
        aria-label={`${current.perSheet} blanks fit on one sheet`}
      >
        <rect
          x={margin}
          y={margin}
          width={sheet.w - 2 * margin}
          height={sheet.h - 2 * margin}
          fill="none"
          stroke="oklch(0.75 0.04 75)"
          strokeDasharray="8 8"
          strokeWidth="2"
        />
        {Array.from({ length: current.down }).flatMap((_, row) =>
          Array.from({ length: current.across }).map((__, col) => (
            <rect
              key={`${row}-${col}`}
              x={margin + col * current.blankW}
              y={margin + row * current.blankH}
              width={current.blankW}
              height={current.blankH}
              fill="white"
              stroke="oklch(0.74 0.16 65)"
              strokeWidth="3"
            />
          )),
        )}
      </svg>

      <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
        <Stat label="Blanks per sheet" value={`${current.perSheet}-up`} />
        <Stat label={`Sheets for ${order.toLocaleString()}`} value={current.sheets.toLocaleString()} />
        <Stat
          label="Extra board"
          value={extra > 0 ? `+${Math.round((extra / base.sheets) * 100)}%` : '—'}
          warn={extra > 0}
        />
      </dl>
    </div>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl px-2 py-3 ${warn ? 'bg-cut-soft' : 'bg-paper'}`}>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-semibold">{value}</dd>
    </div>
  );
}
