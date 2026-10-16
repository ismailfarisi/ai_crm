'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import type { PayrollRunLineDto, UpdatePayrollLinePayload } from '@saas/shared';
import { useUpdatePayrollLine } from '@/hooks/use-payroll';
import { describeServer } from '@/lib/api/describe';
import { Badge } from '@/components/ui/primitives';
import { money } from './payroll-format';

export const FLAG_LABELS: Record<string, string> = {
  NATIONAL_PENSION_NOT_HANDLED: 'Pension not handled',
};

export const EDIT_DEBOUNCE_MS = 600;

type NumericField =
  | 'overtimeHours'
  | 'overtimeHoursPremium'
  | 'bonusAmount'
  | 'unpaidLeaveDays'
  | 'advanceRecovery'
  | 'otherDeductionAmount';
type LabelField = 'bonusLabel' | 'otherDeductionLabel';

const NUMERIC_FIELDS: { key: NumericField; label: string; step: string }[] = [
  { key: 'overtimeHours', label: 'Overtime hours', step: '0.5' },
  { key: 'overtimeHoursPremium', label: 'Premium overtime hours', step: '0.5' },
  { key: 'bonusAmount', label: 'Bonus', step: '0.01' },
  { key: 'unpaidLeaveDays', label: 'Unpaid leave days', step: '0.5' },
  { key: 'advanceRecovery', label: 'Advance recovery', step: '0.01' },
  { key: 'otherDeductionAmount', label: 'Other deduction', step: '0.01' },
];

function initial(line: PayrollRunLineDto): Record<NumericField, string> {
  return {
    overtimeHours: String(line.overtimeHours),
    overtimeHoursPremium: String(line.overtimeHoursPremium),
    bonusAmount: String(line.bonusAmount),
    unpaidLeaveDays: String(line.unpaidLeaveDays),
    advanceRecovery: String(line.advanceRecovery),
    otherDeductionAmount: String(line.otherDeductionAmount),
  };
}

/**
 * One line of a run. While the run is a draft the extras are inputs; every
 * change is debounced into one PATCH and a rejection stays on this row.
 */
export function PayrollLineEditor({
  runId,
  line,
  editable,
}: {
  runId: string;
  line: PayrollRunLineDto;
  editable: boolean;
}) {
  const update = useUpdatePayrollLine();
  const [values, setValues] = useState(() => initial(line));
  const [labels, setLabels] = useState({
    bonusLabel: line.bonusLabel ?? '',
    otherDeductionLabel: line.otherDeductionLabel ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<UpdatePayrollLinePayload>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flush on unmount rather than lose a half-typed edit.
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    update.mutate(
      { runId, lineId: line.id, input: patch },
      {
        onSuccess: () => setError(null),
        onError: (e) => setError(describeServer(e, 'Could not save this line')),
      },
    );
  };
  useEffect(() => () => flushRef.current(), []);

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), EDIT_DEBOUNCE_MS);
  };

  const onNumber = (key: NumericField, raw: string) => {
    setValues((v) => ({ ...v, [key]: raw }));
    if (raw.trim() === '' || Number.isNaN(Number(raw))) return;
    pending.current = { ...pending.current, [key]: Number(raw) };
    schedule();
  };
  const onLabel = (key: LabelField, raw: string) => {
    setLabels((l) => ({ ...l, [key]: raw }));
    pending.current = { ...pending.current, [key]: raw };
    schedule();
  };

  return (
    <>
      <tr className="border-t border-border/40 align-top" data-testid={`line-${line.employeeNumber}`}>
        <td className="py-2 pr-3">
          <div className="font-medium text-ink">{line.employeeName}</div>
          <div className="text-xs text-ink-subtle">
            {line.employeeNumber} · {line.paymentMethod === 'BANK' ? 'Bank' : 'Cash'}
          </div>
          {line.flags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {line.flags.map((f) => (
                <Badge key={f} tone="warning">
                  {FLAG_LABELS[f] ?? f}
                </Badge>
              ))}
            </div>
          )}
        </td>
        <td className="py-2 pr-3 text-right tabular-nums">{money(line.proratedGross)}</td>
        {NUMERIC_FIELDS.map((f) => (
          <td key={f.key} className="py-2 pr-2 text-right">
            {editable ? (
              <>
                <input
                  aria-label={`${f.label} for ${line.employeeName}`}
                  type="number"
                  min="0"
                  step={f.step}
                  value={values[f.key]}
                  onChange={(e) => onNumber(f.key, e.target.value)}
                  className="w-20 rounded-lg border border-border/80 bg-surface px-2 py-1 text-right text-sm tabular-nums"
                />
                {f.key === 'bonusAmount' && (
                  <input
                    aria-label={`Bonus label for ${line.employeeName}`}
                    placeholder="Label"
                    value={labels.bonusLabel}
                    onChange={(e) => onLabel('bonusLabel', e.target.value)}
                    className="mt-1 w-20 rounded-lg border border-border/80 bg-surface px-2 py-1 text-xs"
                  />
                )}
                {f.key === 'otherDeductionAmount' && (
                  <input
                    aria-label={`Deduction label for ${line.employeeName}`}
                    placeholder="Label"
                    value={labels.otherDeductionLabel}
                    onChange={(e) => onLabel('otherDeductionLabel', e.target.value)}
                    className="mt-1 w-20 rounded-lg border border-border/80 bg-surface px-2 py-1 text-xs"
                  />
                )}
              </>
            ) : (
              <span className="tabular-nums text-ink-muted">{String(line[f.key])}</span>
            )}
          </td>
        ))}
        <td className="py-2 pr-3 text-right font-medium tabular-nums">{money(line.netPay)}</td>
        <td className="py-2 text-right">
          <Link
            href={`/people/payroll/${runId}/payslips/${line.id}`}
            className="inline-flex items-center gap-1 text-accent hover:underline"
            aria-label={`Payslip for ${line.employeeName}`}
          >
            <FileText className="size-4" />
          </Link>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={NUMERIC_FIELDS.length + 4} className="pb-2 text-xs text-danger" role="alert">
            {line.employeeName}: {error}
          </td>
        </tr>
      )}
    </>
  );
}
