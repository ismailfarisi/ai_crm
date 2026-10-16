'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Banknote, CheckCircle2, RefreshCw, Undo2 } from 'lucide-react';
import { PERMISSIONS, type PaymentMethod } from '@saas/shared';
import {
  useApprovePayrollRun,
  usePayPayrollRun,
  usePayrollLinesSaving,
  usePayrollRun,
  useRefreshPayrollRun,
  useVoidPayrollRun,
} from '@/hooks/use-payroll';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardBody, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { PeopleNav } from './people-nav';
import { PayrollLineEditor } from './payroll-line-editor';
import { PayRunModal } from './pay-run-modal';
import { RunStatusBadge } from './payroll-runs-view';
import { money, periodLabel } from './payroll-format';

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd data-testid={testId} className="text-lg font-semibold tabular-nums text-ink">
        {money(value)}
      </dd>
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

export function PayrollRunDetail({ id }: { id: string }) {
  const { data: run, isPending, isError, error } = usePayrollRun(id);
  const canManage = useCan({ permission: PERMISSIONS.PAYROLL_MANAGE });
  const canApprove = useCan({ permission: PERMISSIONS.PAYROLL_APPROVE });
  const canPay = useCan({ permission: PERMISSIONS.PAYROLL_PAY });
  const refresh = useRefreshPayrollRun();
  const approve = useApprovePayrollRun();
  const voidRun = useVoidPayrollRun();
  const pay = usePayPayrollRun();
  const saving = usePayrollLinesSaving(id);
  const [confirm, setConfirm] = useState<'approve' | 'void' | null>(null);
  const [paying, setPaying] = useState<PaymentMethod | null>(null);

  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (isError || !run) {
    return (
      <EmptyState
        title="Couldn't load this payroll run"
        description={error instanceof Error ? error.message : 'Please try again.'}
      />
    );
  }

  const isDraft = run.status === 'DRAFT';
  const payable = run.status === 'APPROVED' || run.status === 'PARTIALLY_PAID';
  const nothingPaid = !run.bankPaidAt && !run.cashPaidAt;
  const showRefresh = isDraft && canManage;
  const showApprove = isDraft && canApprove;
  const showPayBank = payable && canPay && run.totals.bankNet > 0 && !run.bankPaidAt;
  const showPayCash = payable && canPay && run.totals.cashNet > 0 && !run.cashPaidAt;
  const showVoid = run.status === 'APPROVED' && nothingPaid && canApprove;
  const lines = run.lines ?? [];
  const payingAmount = paying === 'BANK' ? run.totals.bankNet : run.totals.cashNet;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${periodLabel(run.period)} payroll`}
        description={`${run.runNumber} · pay date ${new Date(run.payDate).toLocaleDateString()}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={run.status} />
            {showRefresh && (
              <Button variant="outline" loading={refresh.isPending} onClick={() => refresh.mutate(run.id)}>
                <RefreshCw className="size-4" />
                Refresh
              </Button>
            )}
            {showApprove && (
              <Button disabled={saving} onClick={() => setConfirm('approve')}>
                <CheckCircle2 className="size-4" />
                Approve
              </Button>
            )}
            {showPayBank && (
              <Button disabled={saving} onClick={() => setPaying('BANK')}>
                <Banknote className="size-4" />
                Pay bank
              </Button>
            )}
            {showPayCash && (
              <Button variant="outline" disabled={saving} onClick={() => setPaying('CASH')}>
                <Banknote className="size-4" />
                Pay cash
              </Button>
            )}
            {showVoid && (
              <Button variant="danger" onClick={() => setConfirm('void')}>
                <Undo2 className="size-4" />
                Void
              </Button>
            )}
          </div>
        }
      />
      <PeopleNav />
      <Link href="/people/payroll" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" />
        All runs
      </Link>

      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Salary cost" value={run.totals.salaryCost} testId="total-salary-cost" />
            <Stat label="Net pay" value={run.totals.net} testId="total-net" />
            <Stat label="Bank net" value={run.totals.bankNet} testId="total-bank-net" />
            <Stat label="Cash net" value={run.totals.cashNet} testId="total-cash-net" />
            <Stat label="Gratuity accrual" value={run.totals.gratuityAccrual} testId="total-gratuity" />
          </dl>
          {run.status === 'PARTIALLY_PAID' && (
            <p className="mt-3 text-sm text-ink-muted">
              {run.bankPaidAt ? 'Bank payments recorded.' : 'Bank payments still to record.'}{' '}
              {run.cashPaidAt ? 'Cash payments recorded.' : 'Cash payments still to record.'}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="overflow-x-auto">
          {!isDraft && run.status !== 'VOIDED' && (
            <p className="mb-3 text-xs text-ink-subtle">Only draft runs can be edited.</p>
          )}
          <table className="w-full text-sm" data-testid="lines-table">
            <thead>
              <tr className="text-left text-xs text-ink-subtle">
                <th className="py-2 font-medium">Employee</th>
                <th className="py-2 pr-3 text-right font-medium">Gross</th>
                <th className="py-2 pr-2 text-right font-medium">OT hrs</th>
                <th className="py-2 pr-2 text-right font-medium">Premium OT hrs</th>
                <th className="py-2 pr-2 text-right font-medium">Bonus</th>
                <th className="py-2 pr-2 text-right font-medium">Unpaid days</th>
                <th className="py-2 pr-2 text-right font-medium">Advance</th>
                <th className="py-2 pr-2 text-right font-medium">Other ded.</th>
                <th className="py-2 pr-3 text-right font-medium">Net</th>
                <th className="py-2 text-right font-medium">
                  <span className="sr-only">Payslip</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <PayrollLineEditor key={line.id} runId={run.id} line={line} editable={isDraft && canManage} />
              ))}
            </tbody>
          </table>
          {lines.length === 0 && <p className="py-4 text-sm text-ink-muted">This run has no lines.</p>}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirm === 'approve'}
        title="Approve this payroll run?"
        description={`This posts ${money(run.totals.salaryCost)} of salary cost, ${money(run.totals.net)} net pay and a ${money(run.totals.gratuityAccrual)} gratuity accrual to the books. Runs must be approved in month order.`}
        confirmLabel="Approve run"
        loading={approve.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await approve.mutateAsync(run.id);
          } catch {
            return;
          } finally {
            setConfirm(null);
          }
        }}
      />
      <ConfirmDialog
        open={confirm === 'void'}
        title="Void this payroll run?"
        description="This reverses the run's journal entry and gratuity accrual. It can only be done while nothing has been paid and no later month is posted."
        confirmLabel="Void run"
        danger
        loading={voidRun.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await voidRun.mutateAsync(run.id);
          } catch {
            return;
          } finally {
            setConfirm(null);
          }
        }}
      />
      {paying && (
        <PayRunModal
          open
          method={paying}
          amount={payingAmount}
          isLoading={pay.isPending}
          onClose={() => setPaying(null)}
          onSubmit={async (input) => {
            await pay.mutateAsync({ id: run.id, input });
          }}
        />
      )}
    </div>
  );
}
