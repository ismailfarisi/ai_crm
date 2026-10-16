'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Banknote } from 'lucide-react';
import { PERMISSIONS, type PayrollRunDto } from '@saas/shared';
import { useCreatePayrollRun, usePayrollRuns } from '@/hooks/use-payroll';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { Alert, Badge, Card, CardBody, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { PeopleNav } from './people-nav';
import { STATUS_LABELS, STATUS_TONES, defaultNextPeriod, money, periodLabel } from './payroll-format';

export function RunStatusBadge({ status }: { status: PayrollRunDto['status'] }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

function NewRunModal({
  open,
  onClose,
  defaultPeriod,
}: {
  open: boolean;
  onClose: () => void;
  defaultPeriod: string;
}) {
  const create = useCreatePayrollRun();
  const [period, setPeriod] = useState(defaultPeriod);
  const [payDate, setPayDate] = useState('');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New payroll run"
      description="Pulls every active employee's current salary package into a draft you can adjust before approving."
    >
      <form
        data-testid="new-run-form"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!period) return;
          try {
            await create.mutateAsync({ period, payDate: payDate || null });
          } catch {
            return;
          }
          onClose();
        }}
      >
        <Input label="Month" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} required />
        <Input
          label="Pay date (optional)"
          type="date"
          value={payDate}
          onChange={(e) => setPayDate(e.target.value)}
          hint="Defaults to the end of the month."
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Create draft
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function PayrollRunsView() {
  const { data, isPending, isError, error } = usePayrollRuns();
  const [adding, setAdding] = useState(false);
  const runs = data?.runs ?? [];
  const cutover = data?.openingGratuityCutover ?? null;
  const defaultPeriod = defaultNextPeriod(runs, cutover);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description="Monthly payroll runs, from draft to paid."
        actions={
          <Can permission={PERMISSIONS.PAYROLL_MANAGE}>
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              New run
            </Button>
          </Can>
        }
      />
      <PeopleNav />

      {data && cutover === null && (
        <Can permission={PERMISSIONS.PAYROLL_MANAGE}>
          <div data-testid="opening-gratuity-prompt">
            <Alert tone="info">
              Gratuity opening balances haven&apos;t been set up yet.{' '}
              <Link href="/people/payroll/opening-gratuity" className="font-medium underline">
                Set them up
              </Link>{' '}
              before your first run.
            </Alert>
          </div>
        </Can>
      )}

      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : isError ? (
        <EmptyState
          title="Couldn't load payroll runs"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<Banknote className="size-8" />}
          title="No payroll runs yet"
          description="Create the first run once your employees have salary packages."
        />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="runs-table">
              <thead>
                <tr className="text-left text-xs text-ink-subtle">
                  <th className="py-2 font-medium">Period</th>
                  <th className="py-2 font-medium">Number</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Net pay</th>
                  <th className="py-2 text-right font-medium">Gratuity accrual</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-border/40">
                    <td className="py-2">
                      <Link href={`/people/payroll/${r.id}`} className="font-medium text-accent hover:underline">
                        {periodLabel(r.period)}
                      </Link>
                    </td>
                    <td className="py-2 text-ink-muted">{r.runNumber}</td>
                    <td className="py-2">
                      <RunStatusBadge status={r.status} />
                    </td>
                    <td className="py-2 text-right tabular-nums">{money(r.totals.net)}</td>
                    <td className="py-2 text-right tabular-nums">{money(r.totals.gratuityAccrual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <Can permission={PERMISSIONS.PAYROLL_MANAGE}>
        {adding && <NewRunModal open onClose={() => setAdding(false)} defaultPeriod={defaultPeriod} />}
      </Can>
    </div>
  );
}
