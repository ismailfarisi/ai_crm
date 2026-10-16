'use client';

import { useState } from 'react';
import { PERMISSIONS, type PrepaidScheduleDto, type SupplierBillLineDto } from '@saas/shared';
import { useEndPrepaidEarly, usePrepaidSchedules } from '@/hooks/use-finance';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `SOFTWARE_IT` -> `Software it`; the ledger role is the only account name the schedule carries. */
export function roleLabel(role: string): string {
  const text = role.toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const STATUS_LABEL: Record<PrepaidScheduleDto['status'], string> = {
  ACTIVE: 'Releasing',
  COMPLETED: 'Fully released',
  ENDED_EARLY: 'Ended early',
};

/**
 * Where a spread bill line stands: how many months have moved from prepaid
 * into expense, and the one-click way to book the rest now.
 */
export function PrepaidSchedulesPanel({ billId, lines }: { billId: string; lines: SupplierBillLineDto[] }) {
  const { data: schedules = [] } = usePrepaidSchedules(billId);
  const endEarly = useEndPrepaidEarly();
  const [ending, setEnding] = useState<PrepaidScheduleDto | null>(null);

  if (schedules.length === 0) return null;

  return (
    <section aria-label="Prepaid schedules" className="mb-6">
      <h2 className="mb-2 text-sm font-medium text-ink">Spread over time</h2>
      <ul className="divide-y divide-line rounded border border-line bg-surface text-sm">
        {schedules.map((s) => {
          const description = lines.find((l) => l.id === s.billLineId)?.description ?? 'Bill line';
          const pct = s.months > 0 ? Math.min(100, Math.round((s.releasedMonths / s.months) * 100)) : 0;
          return (
            <li key={s.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">{description}</p>
                  <p className="text-xs text-ink-muted">
                    Released {s.releasedMonths} of {s.months} months · {STATUS_LABEL[s.status]}
                  </p>
                </div>
                {s.status === 'ACTIVE' && (
                  <Can permission={PERMISSIONS.FINANCE_MANAGE}>
                    <Button variant="secondary" size="sm" onClick={() => setEnding(s)}>
                      End early
                    </Button>
                  </Can>
                )}
              </div>
              <div
                role="progressbar"
                aria-label={`${description} released`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="h-2 overflow-hidden rounded-full bg-surface-sunk"
              >
                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
              </div>
              <p className="flex justify-between text-xs tabular-nums text-ink-muted">
                <span>Released {money(s.releasedAmount)}</span>
                <span>Remaining {money(s.remainingAmount)}</span>
              </p>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        size="sm"
        title="End this schedule early"
        description={
          ending ? `Post the remaining ${money(ending.remainingAmount)} to ${roleLabel(ending.expenseRole)} today?` : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setEnding(null)}>
              Cancel
            </Button>
            <Button
              loading={endEarly.isPending}
              onClick={async () => {
                if (!ending) return;
                await endEarly.mutateAsync(ending.id);
                setEnding(null);
              }}
            >
              End early
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">The remaining months are expensed now and no further releases happen.</p>
      </Dialog>
    </section>
  );
}
