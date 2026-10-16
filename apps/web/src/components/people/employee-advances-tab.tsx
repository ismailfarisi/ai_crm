'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PERMISSIONS } from '@saas/shared';
import { useEmployeeAdvances, useRecordAdvance } from '@/hooks/use-payroll';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Card, CardBody, EmptyState } from '@/components/ui/primitives';
import { RecordAdvanceModal } from './record-advance-modal';

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function EmployeeAdvancesTab({ employeeId }: { employeeId: string }) {
  const { data, isPending, isError, error } = useEmployeeAdvances(employeeId);
  const record = useRecordAdvance();
  const [open, setOpen] = useState(false);

  if (isPending) return <p className="text-ink-muted">Loading…</p>;
  if (isError || !data) {
    return <EmptyState title="Couldn't load advances" description={error instanceof Error ? error.message : 'Please try again.'} />;
  }

  return (
    <div className="space-y-4" data-testid="advances-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-xs text-ink-subtle">Outstanding</dt>
            <dd data-testid="advances-outstanding" className="text-lg font-semibold tabular-nums text-ink">
              {money(data.outstanding)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Recovered</dt>
            <dd className="text-lg font-semibold tabular-nums text-ink-muted">{money(data.recovered)}</dd>
          </div>
        </dl>
        <Can permission={PERMISSIONS.PAYROLL_PAY}>
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Record advance
          </Button>
        </Can>
      </div>

      <Card>
        <CardBody>
          {data.advances.length === 0 ? (
            <p className="text-sm text-ink-muted">No advances have been paid to this employee.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-subtle">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Note</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.advances.map((a) => (
                  <tr key={a.id} className="border-t border-line">
                    <td className="py-2 whitespace-nowrap">{new Date(a.issuedAt).toLocaleDateString()}</td>
                    <td className="py-2 text-ink-muted">{a.note ?? '—'}</td>
                    <td className="py-2 text-right tabular-nums">{money(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <RecordAdvanceModal
        open={open}
        onClose={() => setOpen(false)}
        isLoading={record.isPending}
        onSubmit={async (input) => {
          await record.mutateAsync({ id: employeeId, input });
        }}
      />
    </div>
  );
}
