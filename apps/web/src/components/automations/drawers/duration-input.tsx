'use client';

import React from 'react';
import { DURATION_UNITS, type Duration, type DurationUnit } from '../duration';

export interface DurationInputProps {
  value: Duration;
  onChange: (value: Duration) => void;
  testId: string;
  /** Units offered; waits can be seconds, an approval is never that short. */
  units?: readonly DurationUnit[];
  label: string;
}

const controlClass =
  'rounded-lg border border-border px-3 py-2 text-xs text-ink bg-surface focus:border-brand focus:outline-none';

/** An amount and a unit: "1" + "days". */
export function DurationInput({ value, onChange, testId, units = DURATION_UNITS, label }: DurationInputProps) {
  const offered = units.includes(value.unit) ? units : [value.unit, ...units];
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={1}
        aria-label={`${label}: amount`}
        data-testid={`${testId}-amount`}
        value={Number.isFinite(value.amount) ? value.amount : ''}
        onChange={(e) => onChange({ ...value, amount: Math.max(1, Number(e.target.value) || 1) })}
        className={`${controlClass} w-20`}
      />
      <select
        aria-label={`${label}: unit`}
        data-testid={`${testId}-unit`}
        value={value.unit}
        onChange={(e) => onChange({ ...value, unit: e.target.value as DurationUnit })}
        className={`${controlClass} flex-1`}
      >
        {offered.map((unit) => (
          <option key={unit} value={unit}>
            {value.amount === 1 ? unit.slice(0, -1) : unit}
          </option>
        ))}
      </select>
    </div>
  );
}
