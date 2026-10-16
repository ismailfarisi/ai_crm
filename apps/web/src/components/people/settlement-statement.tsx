'use client';

import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import type { SettlementStatementDto, SettlementStatus } from '@saas/shared';
import { useSettlementStatement } from '@/hooks/use-payroll';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { SETTLEMENT_REASON_LABELS, money, serviceLabel } from './payroll-format';

const day = (iso: string) => new Date(iso).toLocaleDateString();

/** Statuses whose statement must not pass for the final one, with what to print. */
const NOT_FINAL: Partial<Record<SettlementStatus, { mark: string; note: string }>> = {
  DRAFT: { mark: 'DRAFT', note: 'DRAFT — not final. Figures may change before approval.' },
  VOIDED: { mark: 'VOIDED', note: 'VOIDED — this settlement was cancelled and is not valid.' },
};

export function SettlementStatement({ statement }: { statement: SettlementStatementDto }) {
  const { settlement: s, employee, organization } = statement;
  const cur = organization.baseCurrency;
  const notFinal = NOT_FINAL[s.status];

  return (
    <article
      data-testid="settlement-statement"
      className="relative mx-auto max-w-2xl space-y-5 overflow-hidden rounded-2xl border border-border/40 bg-surface p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:text-black"
    >
      {notFinal && (
        <>
          <div
            aria-hidden
            data-testid="statement-watermark"
            className="pointer-events-none absolute inset-0 flex select-none items-center justify-center"
          >
            <span className="-rotate-30 text-8xl font-black tracking-widest text-danger/15 print:text-black/10">
              {notFinal.mark}
            </span>
          </div>
          <p
            role="status"
            data-testid="statement-not-final"
            className="rounded-lg border-2 border-danger px-3 py-2 text-center text-sm font-bold text-danger print:border-black print:text-black"
          >
            {notFinal.note}
          </p>
        </>
      )}
      <header className="flex items-start justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-xl font-bold">{organization.legalName || organization.name}</h1>
          {organization.address && <p className="whitespace-pre-line text-sm text-ink-muted">{organization.address}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">Final settlement</p>
          <p className="text-sm text-ink-muted">{SETTLEMENT_REASON_LABELS[s.reason]}</p>
          <p className="text-xs text-ink-subtle">{s.settlementNumber}</p>
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
          <dt className="text-xs text-ink-subtle">Service period</dt>
          <dd data-testid="statement-service">
            {day(employee.joiningDate)} to {day(s.leavingDate)} · {serviceLabel(s.serviceDays)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-subtle">Paid by</dt>
          <dd>
            {s.paymentMethod === 'BANK'
              ? `Bank transfer${employee.bankName ? ` · ${employee.bankName}` : ''}`
              : 'Cash'}
          </dd>
        </div>
        {s.paymentMethod === 'BANK' && (
          <div>
            <dt className="text-xs text-ink-subtle">IBAN</dt>
            <dd data-testid="statement-iban" className="font-mono">
              {employee.ibanMasked || '—'}
            </dd>
          </div>
        )}
      </dl>

      <section className="print-break-inside-avoid">
        <h2 className="mb-1 text-sm font-semibold">Settlement ({cur})</h2>
        <table className="w-full text-sm">
          <tbody>
            {s.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-1">
                  {l.label}
                  {l.quantity != null && <span className="text-xs text-ink-muted"> · {l.quantity} days</span>}
                </td>
                <td className="py-1 text-right tabular-nums">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="flex items-center justify-between border-t-2 border-black/40 pt-3 text-lg font-bold">
        <span>Net settlement</span>
        <span data-testid="statement-net" className="tabular-nums">
          {cur} {money(s.netPay)}
        </span>
      </div>
    </article>
  );
}

export function SettlementStatementView({ id }: { id: string }) {
  const { data, isPending, isError, error } = useSettlementStatement(id);

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (isError || !data) {
    return (
      <EmptyState
        title="Couldn't load this statement"
        description={error instanceof Error ? error.message : 'Please try again.'}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/people/settlements/${id}`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" />
          Back to settlement
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Print
        </Button>
      </div>
      <SettlementStatement statement={data} />
    </div>
  );
}
