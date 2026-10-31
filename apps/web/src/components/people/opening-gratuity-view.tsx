'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS } from '@saas/shared';
import { useOpeningGratuityPreview, usePayrollRuns, usePostOpeningGratuity } from '@/hooks/use-payroll';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/field';
import { Alert, Card, CardBody, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { PeopleNav } from './people-nav';
import { employeeTabHref } from './employee-tabs';
import { inCurrency, money, usePayrollCurrency } from './payroll-format';

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString();

export function OpeningGratuityView() {
  const canPost = useCan({ permission: PERMISSIONS.PAYROLL_APPROVE });
  const runs = usePayrollRuns();
  const [cutover, setCutover] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const preview = useOpeningGratuityPreview(cutover || undefined);
  const post = usePostOpeningGratuity();
  const cur = usePayrollCurrency();

  const posted = runs.data?.openingGratuityCutover ?? null;
  const data = preview.data;
  /** The amount to post, or null when the override box holds nothing usable. */
  const amountOf = (employeeId: string, calculated: number): number | null => {
    const raw = overrides[employeeId];
    if (raw === undefined) return calculated;
    const n = Number(raw);
    if (raw.trim() === '' || Number.isNaN(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  };
  const lines = (data?.lines ?? []).map((l) => {
    const amount = amountOf(l.employeeId, l.calculated);
    // Gratuity is worked out on basic, so without a package it comes out as 0.00 whatever the service.
    const noPackage = l.serviceDays > 0 && l.basic <= 0;
    // Gratuity accrues from the first day, so 0.00 after any service is a missing figure, not a balance.
    const zeroForService = amount === 0 && l.serviceDays > 0;
    return { ...l, amount, noPackage, blocked: amount === null || zeroForService };
  });
  const invalid = lines.some((l) => l.blocked);
  const missingPackages = lines.filter((l) => l.noPackage && l.blocked).length;
  const total = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  // Lines on screen may belong to the previous cut-over until the new preview lands.
  const stale = preview.isPlaceholderData || preview.isFetching;
  const effectiveCutover = cutover || data?.cutoverDate || '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opening gratuity"
        description="Carry each employee's accrued gratuity into the books as of your go-live date."
      />
      <PeopleNav />

      {posted ? (
        <Alert tone="success">
          <span data-testid="opening-posted">Opening balances posted as of {day(posted)}</span>
        </Alert>
      ) : preview.isError ? (
        <EmptyState
          title="Couldn't calculate the opening balances"
          description={preview.error instanceof Error ? preview.error.message : 'Please try again.'}
        />
      ) : (
        <>
          <div className="max-w-xs">
            <Input
              label="Cut-over date"
              type="date"
              value={effectiveCutover}
              onChange={(e) => {
                setCutover(e.target.value);
                setOverrides({});
              }}
              hint="Payroll up to and including this month is treated as already in the opening balances."
            />
          </div>

          {preview.isPending || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : lines.length === 0 ? (
            <EmptyState
              title="Nobody to carry over"
              description="Everyone has joined after this date, already has an opening balance, or has been accrued by a posted payroll run."
            />
          ) : (
            <Card>
              <CardBody className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="opening-table">
                  <thead>
                    <tr className="text-left text-xs text-ink-subtle">
                      <th className="py-2 font-medium">Employee</th>
                      <th className="py-2 font-medium">Joined</th>
                      <th className="py-2 text-right font-medium">{inCurrency('Basic', cur)}</th>
                      <th className="py-2 text-right font-medium">Service days</th>
                      <th className="py-2 text-right font-medium">{inCurrency('Calculated', cur)}</th>
                      <th className="py-2 text-right font-medium">{inCurrency('Opening balance', cur)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.employeeId} className="border-t border-border/40 align-top" data-testid={`opening-row-${l.employeeId}`}>
                        <td className="py-2 text-ink">
                          {l.employeeName}
                          {l.noPackage && (
                            <p className="mt-1 text-xs text-warning" data-testid="opening-no-package">
                              No salary package: add one first.{' '}
                              <Link
                                href={employeeTabHref(l.employeeId, 'salary')}
                                className="font-medium text-ink underline underline-offset-2"
                              >
                                Salary history
                              </Link>
                            </p>
                          )}
                        </td>
                        <td className="py-2 text-ink-muted">{day(l.joiningDate)}</td>
                        <td className="py-2 text-right tabular-nums">{l.noPackage ? '—' : money(l.basic)}</td>
                        <td className="py-2 text-right tabular-nums">{l.serviceDays}</td>
                        <td className="py-2 text-right tabular-nums text-ink-muted">{l.noPackage ? '—' : money(l.calculated)}</td>
                        <td className="py-2 text-right">
                          <input
                            aria-label={`Opening balance for ${l.employeeName}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={overrides[l.employeeId] ?? String(l.calculated)}
                            onChange={(e) => setOverrides((o) => ({ ...o, [l.employeeId]: e.target.value }))}
                            aria-invalid={l.blocked}
                            className="w-28 rounded-lg border border-border/80 bg-surface px-2 py-1 text-right text-sm tabular-nums"
                          />
                          {l.amount === null ? (
                            <p className="mt-1 text-xs text-danger" role="alert">
                              Enter an amount of 0 or more
                            </p>
                          ) : (
                            l.blocked &&
                            !l.noPackage && (
                              <p className="mt-1 text-xs text-danger" role="alert">
                                Can&apos;t be 0.00 after {l.serviceDays} days of service
                              </p>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border font-semibold">
                      <td colSpan={5} className="py-2 text-right">
                        Total
                      </td>
                      <td data-testid="opening-total" className="py-2 text-right tabular-nums">
                        {money(total, cur)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </CardBody>
            </Card>
          )}

          {lines.length > 0 && (
            <div className="flex items-center justify-end gap-3">
              {!canPost && <p className="text-xs text-ink-subtle">Posting needs payroll approval access.</p>}
              {invalid && (
                <p className="text-xs text-danger" data-testid="opening-blocked">
                  {missingPackages > 0
                    ? `${missingPackages === 1 ? '1 employee has' : `${missingPackages} employees have`} no salary package. Add one, or type their opening balance.`
                    : 'Fix the highlighted opening balances first.'}
                </p>
              )}
              <Button disabled={!canPost || !effectiveCutover || stale || invalid} onClick={() => setConfirming(true)}>
                Post opening balances
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Post opening balances?"
        description={`This books ${money(total, cur)} of gratuity provision for ${lines.length === 1 ? '1 employee' : `${lines.length} employees`} as of ${effectiveCutover ? day(effectiveCutover) : 'the cut-over date'}. Payroll for months up to that date can no longer be run.`}
        confirmLabel="Post opening balances"
        onConfirm={async () => {
          if (stale || invalid) throw new Error('The figures changed while this was open. Check them and post again.');
          await post.mutateAsync({
            cutoverDate: effectiveCutover,
            lines: lines.map((l) => ({ employeeId: l.employeeId, amount: l.amount ?? 0 })),
          });
        }}
      />
    </div>
  );
}
