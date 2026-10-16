'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import type { PayrollRunLineDto, UpdatePayrollLinePayload } from '@saas/shared';
import { useUpdatePayrollLine } from '@/hooks/use-payroll';
import { describeServer } from '@/lib/api/describe';
import { Badge } from '@/components/ui/primitives';
import { money } from './payroll-format';
import { usePayrollLinesRegistry } from './payroll-lines-context';

export const FLAG_LABELS: Record<string, string> = {
  NATIONAL_NO_PENSION_SCHEME: 'No pension scheme',
  LEAVE_IN_ADVANCE: 'Leave in advance',
  LABOUR_NOT_ABSORBED: 'Labour not charged to jobs',
};

export const EDIT_DEBOUNCE_MS = 600;

const LEAVE_FIELDS: NumericField[] = ['unpaidLeaveDays', 'halfPayDays'];

type NumericField =
  | 'overtimeHours'
  | 'overtimeHoursPremium'
  | 'bonusAmount'
  | 'unpaidLeaveDays'
  | 'halfPayDays'
  | 'advanceRecovery'
  | 'otherDeductionAmount';
type LabelField = 'bonusLabel' | 'otherDeductionLabel';

const NUMERIC_FIELDS: { key: NumericField; label: string; step: string }[] = [
  { key: 'overtimeHours', label: 'Overtime hours', step: '0.5' },
  { key: 'overtimeHoursPremium', label: 'Premium overtime hours', step: '0.5' },
  { key: 'bonusAmount', label: 'Bonus', step: '0.01' },
  { key: 'unpaidLeaveDays', label: 'Unpaid leave days', step: '0.5' },
  { key: 'halfPayDays', label: 'Half-pay days', step: '0.5' },
  { key: 'advanceRecovery', label: 'Advance recovery', step: '0.01' },
  { key: 'otherDeductionAmount', label: 'Other deduction', step: '0.01' },
];

function initial(line: PayrollRunLineDto): Record<NumericField, string> {
  return {
    overtimeHours: String(line.overtimeHours),
    overtimeHoursPremium: String(line.overtimeHoursPremium),
    bonusAmount: String(line.bonusAmount),
    unpaidLeaveDays: String(line.unpaidLeaveDays),
    halfPayDays: String(line.halfPayDays),
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
  const update = useUpdatePayrollLine(runId);
  const [values, setValues] = useState(() => initial(line));
  const [labels, setLabels] = useState({
    bonusLabel: line.bonusLabel ?? '',
    otherDeductionLabel: line.otherDeductionLabel ?? '',
  });
  // Errors are kept per field, so a later successful save of another field cannot hide this one.
  const [errors, setErrors] = useState<Record<string, string>>({});
  // An edit typed but not yet saved (debouncing or in flight).
  const [unsaved, setUnsaved] = useState(false);
  // Typed into a leave field in this session: the server will flag the line overridden once saved.
  const [touchedLeave, setTouchedLeave] = useState(false);
  const loop = useRef<Promise<void> | null>(null);
  const pending = useRef<UpdatePayrollLinePayload>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // One PATCH at a time per line: edits made meanwhile merge into `pending` and go out
  // when the current one settles, so responses (and errors) arrive in order. The
  // returned promise settles once nothing is pending.
  flushRef.current = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (loop.current) return loop.current;
    if (Object.keys(pending.current).length === 0) return Promise.resolve();
    loop.current = (async () => {
      try {
        while (Object.keys(pending.current).length > 0) {
          const patch = pending.current;
          pending.current = {};
          const keys = Object.keys(patch);
          try {
            await update.mutateAsync({ runId, lineId: line.id, input: patch });
            setErrors((prev) => {
              const next = { ...prev };
              for (const k of keys) delete next[k];
              return next;
            });
          } catch (e) {
            const message = describeServer(e, 'Could not save this line');
            setErrors((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, message])) }));
          }
        }
      } finally {
        loop.current = null;
        if (!timer.current) setUnsaved(false);
      }
    })();
    return loop.current;
  };

  // Approve and Pay flush every line first; on unmount, flush rather than lose a half-typed edit.
  const registry = usePayrollLinesRegistry();
  useEffect(() => {
    const unregister = registry?.register(line.id, () => flushRef.current());
    return () => {
      unregister?.();
      void flushRef.current();
    };
  }, [registry, line.id]);

  // When the records (not the user) move the leave days, show them; never overwrite a typed value.
  useEffect(() => {
    if (unsaved) return;
    setValues((v) => ({ ...v, unpaidLeaveDays: String(line.unpaidLeaveDays), halfPayDays: String(line.halfPayDays) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.unpaidLeaveDays, line.halfPayDays]);

  const invalid = Object.values(values).some((raw) => raw.trim() !== '' && Number.isNaN(Number(raw)));
  const rejected = Object.keys(errors).length > 0;
  useEffect(() => {
    registry?.report(line.id, { unsaved: unsaved || invalid, rejected });
  }, [registry, line.id, unsaved, invalid, rejected]);
  useEffect(() => () => registry?.report(line.id, null), [registry, line.id]);

  const schedule = () => {
    setUnsaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flushRef.current();
    }, EDIT_DEBOUNCE_MS);
  };

  const onNumber = (key: NumericField, raw: string) => {
    setValues((v) => ({ ...v, [key]: raw }));
    // A cleared box means none: send 0 rather than keep the old amount.
    const value = raw.trim() === '' ? 0 : Number(raw);
    if (Number.isNaN(value)) return;
    const next = { ...pending.current, [key]: value };
    if (LEAVE_FIELDS.includes(key)) {
      // A typed leave value supersedes a queued "use leave records".
      delete next.leaveOverridden;
      setTouchedLeave(true);
    }
    pending.current = next;
    schedule();
  };
  // Hand the leave fields back to the records; goes through the same serialised save path.
  const useLeaveRecords = () => {
    const next = { ...pending.current, leaveOverridden: false as const };
    delete next.unpaidLeaveDays;
    delete next.halfPayDays;
    pending.current = next;
    setTouchedLeave(false);
    schedule();
    void flushRef.current();
  };
  const leaveAuto = !line.leaveOverridden && !touchedLeave;
  const onLabel = (key: LabelField, raw: string) => {
    setLabels((l) => ({ ...l, [key]: raw }));
    pending.current = { ...pending.current, [key]: raw.trim() === '' ? null : raw };
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
            {f.key === 'unpaidLeaveDays' && leaveAuto && (
              <div className="mt-1">
                <Badge tone="neutral">auto</Badge>
              </div>
            )}
            {f.key === 'halfPayDays' && leaveAuto && (
              <div className="mt-1">
                <Badge tone="neutral">auto</Badge>
              </div>
            )}
            {f.key === 'halfPayDays' && line.leaveOverridden && editable && (
              <button
                type="button"
                onClick={useLeaveRecords}
                aria-label={`Use leave records for ${line.employeeName}`}
                className="mt-1 block w-full text-right text-xs text-accent hover:underline"
              >
                Use leave records
              </button>
            )}
          </td>
        ))}
        <td className="py-2 pr-2 text-right tabular-nums text-ink-muted">{line.annualLeaveDays}</td>
        <td className="py-2 pr-2 text-right tabular-nums text-ink-muted">
          {line.pensionEmployee > 0 ? money(line.pensionEmployee) : '—'}
        </td>
        <td className="py-2 pr-2 text-right tabular-nums text-ink-muted">
          {line.leaveProvisionChange === null ? '—' : money(line.leaveProvisionChange)}
        </td>
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
      {Object.keys(errors).length > 0 && (
        <tr>
          <td colSpan={NUMERIC_FIELDS.length + 7} className="pb-2 text-xs text-danger" role="alert">
            {line.employeeName}: {[...new Set(Object.values(errors))].join(' ')}
          </td>
        </tr>
      )}
    </>
  );
}
