'use client';

import { useState } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { useOpeningLeavePreview, usePayrollRuns, usePostOpeningLeave } from '@/hooks/use-payroll';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/field';
import { Alert, Card, CardBody, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { PeopleNav } from './people-nav';

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString();
// The same bounds the API enforces on a balance.
const MIN_DAYS = -60;
const MAX_DAYS = 400;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function OpeningLeaveView() {
  const canPost = useCan({ permission: PERMISSIONS.PAYROLL_APPROVE });
  const runs = usePayrollRuns();
  const [cutover, setCutover] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const preview = useOpeningLeavePreview(cutover || undefined);
  const post = usePostOpeningLeave();

  const posted = runs.data?.openingLeaveCutover ?? null;
  const data = preview.data;
  /** The balance to post, or null when the box holds nothing usable. Negatives are valid (leave taken in advance). */
  const daysOf = (employeeId: string, calculated: number): number | null => {
    const raw = overrides[employeeId];
    if (raw === undefined) return calculated;
    const n = Number(raw);
    if (raw.trim() === '' || Number.isNaN(n) || n < MIN_DAYS || n > MAX_DAYS) return null;
    return round2(n);
  };
  const lines = (data?.lines ?? []).map((l) => ({ ...l, days: daysOf(l.employeeId, l.calculatedDays) }));
  const invalid = lines.some((l) => l.days === null);
  const total = round2(lines.reduce((s, l) => s + (l.days ?? 0), 0));
  // Lines on screen may belong to the previous cut-over until the new preview lands.
  const stale = preview.isPlaceholderData || preview.isFetching;
  const effectiveCutover = cutover || data?.cutoverDate || '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opening leave balances"
        description="Carry each employee's annual leave balance into the books as of your go-live date."
      />
      <PeopleNav />

      {posted ? (
        <Alert tone="success">
          <span data-testid="opening-leave-posted">Opening leave balances posted as of {day(posted)}</span>
        </Alert>
      ) : preview.isError ? (
        <EmptyState
          title="Couldn't calculate the opening leave balances"
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
              hint="Leave taken after this date is deducted from the balance by payroll."
            />
          </div>

          {preview.isPending || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : lines.length === 0 ? (
            <EmptyState
              title="Nobody to carry over"
              description="Everyone has joined after this date or already has an opening leave balance."
            />
          ) : (
            <>
              <Alert tone="warning">
                <span data-testid="opening-leave-assumption">
                  The prefilled days assume nobody took any leave before the cut-over. Correct each balance to the days
                  the employee actually has left before you post.
                </span>
              </Alert>
              <Card>
                <CardBody className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="opening-leave-table">
                    <thead>
                      <tr className="text-left text-xs text-ink-subtle">
                        <th className="py-2 font-medium">Employee</th>
                        <th className="py-2 font-medium">Joined</th>
                        <th className="py-2 text-right font-medium">Service days</th>
                        <th className="py-2 text-right font-medium">Earned days (none taken)</th>
                        <th className="py-2 text-right font-medium">Opening balance (days)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.employeeId} className="border-t border-border/40">
                          <td className="py-2 text-ink">{l.employeeName}</td>
                          <td className="py-2 text-ink-muted">{day(l.joiningDate)}</td>
                          <td className="py-2 text-right tabular-nums">{l.serviceDays}</td>
                          <td className="py-2 text-right tabular-nums text-ink-muted">{l.calculatedDays}</td>
                          <td className="py-2 text-right">
                            <input
                              aria-label={`Opening leave days for ${l.employeeName}`}
                              type="number"
                              min={MIN_DAYS}
                              max={MAX_DAYS}
                              step="0.01"
                              value={overrides[l.employeeId] ?? String(l.calculatedDays)}
                              onChange={(e) => setOverrides((o) => ({ ...o, [l.employeeId]: e.target.value }))}
                              aria-invalid={l.days === null}
                              className="w-28 rounded-lg border border-border/80 bg-surface px-2 py-1 text-right text-sm tabular-nums"
                            />
                            {l.days === null && (
                              <p className="mt-1 text-xs text-danger" role="alert">
                                Enter days between {MIN_DAYS} and {MAX_DAYS}
                              </p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border font-semibold">
                        <td colSpan={4} className="py-2 text-right">
                          Total days
                        </td>
                        <td data-testid="opening-leave-total" className="py-2 text-right tabular-nums">
                          {total}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </CardBody>
              </Card>
            </>
          )}

          {lines.length > 0 && (
            <div className="flex items-center justify-end gap-3">
              {!canPost && <p className="text-xs text-ink-subtle">Posting needs payroll approval access.</p>}
              {invalid && <p className="text-xs text-danger">Fix the highlighted balances first.</p>}
              <Button disabled={!canPost || !effectiveCutover || stale || invalid} onClick={() => setConfirming(true)}>
                Post opening leave balances
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Post opening leave balances?"
        description={`This carries ${total} days of leave for ${lines.length === 1 ? '1 employee' : `${lines.length} employees`} into the books as of ${effectiveCutover ? day(effectiveCutover) : 'the cut-over date'}. Check that leave already taken is deducted.`}
        confirmLabel="Post leave balances"
        onConfirm={async () => {
          if (stale || invalid) throw new Error('The figures changed while this was open. Check them and post again.');
          await post.mutateAsync({
            cutoverDate: effectiveCutover,
            lines: lines.map((l) => ({ employeeId: l.employeeId, balanceDays: l.days ?? 0 })),
          });
        }}
      />
    </div>
  );
}
