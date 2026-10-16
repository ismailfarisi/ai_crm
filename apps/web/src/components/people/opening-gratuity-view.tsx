'use client';

import { useState } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { useOpeningGratuityPreview, usePayrollRuns, usePostOpeningGratuity } from '@/hooks/use-payroll';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { Alert, Card, CardBody, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { PeopleNav } from './people-nav';
import { money } from './payroll-format';

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString();

export function OpeningGratuityView() {
  const canPost = useCan({ permission: PERMISSIONS.PAYROLL_APPROVE });
  const runs = usePayrollRuns();
  const [cutover, setCutover] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const preview = useOpeningGratuityPreview(cutover || undefined);
  const post = usePostOpeningGratuity();

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
  const lines = (data?.lines ?? []).map((l) => ({ ...l, amount: amountOf(l.employeeId, l.calculated) }));
  const invalid = lines.some((l) => l.amount === null);
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
                      <th className="py-2 text-right font-medium">Basic</th>
                      <th className="py-2 text-right font-medium">Service days</th>
                      <th className="py-2 text-right font-medium">Calculated</th>
                      <th className="py-2 text-right font-medium">Opening balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.employeeId} className="border-t border-border/40">
                        <td className="py-2 text-ink">{l.employeeName}</td>
                        <td className="py-2 text-ink-muted">{day(l.joiningDate)}</td>
                        <td className="py-2 text-right tabular-nums">{money(l.basic)}</td>
                        <td className="py-2 text-right tabular-nums">{l.serviceDays}</td>
                        <td className="py-2 text-right tabular-nums text-ink-muted">{money(l.calculated)}</td>
                        <td className="py-2 text-right">
                          <input
                            aria-label={`Opening balance for ${l.employeeName}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={overrides[l.employeeId] ?? String(l.calculated)}
                            onChange={(e) => setOverrides((o) => ({ ...o, [l.employeeId]: e.target.value }))}
                            aria-invalid={l.amount === null}
                            className="w-28 rounded-lg border border-border/80 bg-surface px-2 py-1 text-right text-sm tabular-nums"
                          />
                          {l.amount === null && (
                            <p className="mt-1 text-xs text-danger" role="alert">
                              Enter an amount of 0 or more
                            </p>
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
                        {money(total)}
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
              {invalid && <p className="text-xs text-danger">Fix the highlighted opening balances first.</p>}
              <Button disabled={!canPost || !effectiveCutover || stale || invalid} onClick={() => setConfirming(true)}>
                Post opening balances
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Post opening balances?"
        description={`This books ${money(total)} of gratuity provision as of ${effectiveCutover ? day(effectiveCutover) : 'the cut-over date'}. Payroll for months up to that date can no longer be run.`}
      >
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={post.isPending}
            disabled={stale || invalid}
            onClick={async () => {
              if (invalid) return;
              try {
                await post.mutateAsync({
                  cutoverDate: effectiveCutover,
                  lines: lines.map((l) => ({ employeeId: l.employeeId, amount: l.amount ?? 0 })),
                });
              } catch {
                return;
              } finally {
                setConfirming(false);
              }
            }}
          >
            Post
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
