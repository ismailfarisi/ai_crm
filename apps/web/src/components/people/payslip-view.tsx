'use client';

import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import type { PayslipDto } from '@saas/shared';
import { usePayslip } from '@/hooks/use-payroll';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { money, periodLabel } from './payroll-format';

type Amount = { label: string; amount: number; testId?: string };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (rows: Amount[]) => round2(rows.reduce((s, r) => s + r.amount, 0));
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

function Row({ label, amount, strong, testId }: Amount & { strong?: boolean }) {
  return (
    <tr className={strong ? 'border-t border-border-strong font-semibold print:border-black/40' : ''}>
      <td className="py-1">{label}</td>
      <td data-testid={testId} className="py-1 text-right tabular-nums">
        {money(amount)}
      </td>
    </tr>
  );
}

/**
 * The payslip's two columns, built from the same parts `computeLine` uses so
 * gross earnings less total deductions is exactly the net pay printed below.
 */
export function payslipRows(line: PayslipDto['line']): { earnings: Amount[]; deductions: Amount[] } {
  const earnings: Amount[] = [
    { label: 'Basic', amount: line.basic },
    { label: 'Housing', amount: line.housing },
    { label: 'Transport', amount: line.transport },
    ...line.otherAllowances.map((a) => ({ label: a.label, amount: a.amount })),
  ];
  // The package is monthly; a part month pays only the days employed.
  const notEmployed = round2(line.gross - line.proratedGross);
  if (notEmployed !== 0) {
    earnings.push({
      label: `Part month: employed ${line.daysEmployed} of ${line.daysInMonth} days`,
      amount: -notEmployed,
    });
  }
  if (line.overtimeAmount > 0) earnings.push({ label: 'Overtime', amount: line.overtimeAmount });
  if (line.bonusAmount > 0) earnings.push({ label: line.bonusLabel || 'Bonus', amount: line.bonusAmount });

  const deductions: Amount[] = [
    { label: `Unpaid leave (${plural(line.unpaidLeaveDays, 'day')})`, amount: line.unpaidLeaveAmount },
    { label: `Half-pay leave (${plural(line.halfPayDays, 'day')} at half pay)`, amount: line.halfPayAmount },
    {
      label: line.pensionSchemeName ? `Pension: ${line.pensionSchemeName} (employee share)` : 'Pension (employee share)',
      amount: line.pensionEmployee,
    },
    { label: 'Advance recovery', amount: line.advanceRecovery },
    { label: line.otherDeductionLabel || 'Other deductions', amount: line.otherDeductionAmount },
  ].filter((d) => d.amount > 0);
  return { earnings, deductions };
}

export function Payslip({ slip }: { slip: PayslipDto }) {
  const { line, employee, organization, run } = slip;
  const cur = organization.baseCurrency;
  const { earnings, deductions } = payslipRows(line);
  const grossEarnings = sum(earnings);
  const totalDeductions = sum(deductions);

  return (
    <article data-testid="payslip" className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-border/40 bg-surface p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:text-black">
      <header className="flex items-start justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-xl font-bold">{organization.legalName || organization.name}</h1>
          {organization.address && <p className="whitespace-pre-line text-sm text-ink-muted">{organization.address}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">Payslip</p>
          <p className="text-sm text-ink-muted">{periodLabel(run.period)}</p>
          <p className="text-xs text-ink-subtle">{run.runNumber}</p>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-ink-subtle">Employee</dt>
          <dd className="font-medium">{employee.fullName}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">Employee no.</dt>
          <dd>{employee.employeeNumber}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">Job title</dt>
          <dd>{employee.jobTitle || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">Department</dt>
          <dd>{employee.department || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">Pay date</dt>
          <dd>{new Date(run.payDate).toLocaleDateString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">Paid by</dt>
          <dd data-testid="payslip-method">
            {employee.paymentMethod === 'BANK'
              ? `Bank transfer${employee.bankName ? ` · ${employee.bankName}` : ''}`
              : 'Cash'}
          </dd>
        </div>
        {employee.paymentMethod === 'BANK' && (
          <div className="col-span-2">
            <dt className="text-xs text-ink-subtle">IBAN</dt>
            <dd data-testid="payslip-iban" className="font-mono">
              {employee.ibanMasked || '—'}
            </dd>
          </div>
        )}
      </dl>

      <section className="print-break-inside-avoid">
        <h2 className="mb-1 text-sm font-semibold">Earnings ({cur})</h2>
        <table className="w-full text-sm">
          <tbody>
            {earnings.map((e, i) => (
              <Row key={`${e.label}-${i}`} label={e.label} amount={e.amount} />
            ))}
            <Row label="Gross earnings" amount={grossEarnings} strong testId="payslip-gross" />
          </tbody>
        </table>
      </section>

      <section className="print-break-inside-avoid">
        <h2 className="mb-1 text-sm font-semibold">Deductions ({cur})</h2>
        {deductions.length === 0 ? (
          <p className="text-sm text-ink-muted">None</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {deductions.map((d) => (
                <Row key={d.label} label={d.label} amount={d.amount} />
              ))}
              <Row label="Total deductions" amount={totalDeductions} strong testId="payslip-deductions" />
            </tbody>
          </table>
        )}
      </section>

      <div className="flex items-center justify-between border-t-2 border-border-strong pt-3 text-lg font-bold print:border-black/60">
        <span>Net pay</span>
        <span data-testid="payslip-net" className="tabular-nums">
          {money(line.netPay, cur)}
        </span>
      </div>
    </article>
  );
}

export function PayslipView({ runId, lineId }: { runId: string; lineId: string }) {
  const { data, isPending, isError, error } = usePayslip(runId, lineId);

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (isError || !data) {
    return (
      <EmptyState
        title="Couldn't load this payslip"
        description={error instanceof Error ? error.message : 'Please try again.'}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/people/payroll/${runId}`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" />
          Back to run
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Print
        </Button>
      </div>
      <Payslip slip={data} />
    </div>
  );
}
