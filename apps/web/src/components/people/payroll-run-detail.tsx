'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Banknote, CheckCircle2, FileDown, RefreshCw, Trash2, Undo2 } from 'lucide-react';
import { PERMISSIONS, type PaymentMethod } from '@saas/shared';
import {
  useApprovePayrollRun,
  useDeletePayrollRun,
  usePayPayrollRun,
  usePayrollLinesSaving,
  usePayrollRun,
  usePayrollSettings,
  useRefreshPayrollRun,
  useRunSif,
  useVoidPayrollRun,
} from '@/hooks/use-payroll';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardBody, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { PeopleNav } from './people-nav';
import { PayrollLineEditor } from './payroll-line-editor';
import { PayrollLinesProvider, usePayrollLines } from './payroll-lines-context';
import { PayRunModal } from './pay-run-modal';
import { PensionPanel } from './pension-panel';
import { downloadSif } from './download-sif';
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
  blockedReason,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  loading: boolean;
  /** Why confirming is not possible yet; the confirm button stays disabled while set. */
  blockedReason?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      {blockedReason && (
        <p className="mb-3 text-sm text-ink-muted" role="status" data-testid="confirm-blocked">
          {blockedReason}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={danger ? 'danger' : 'primary'}
          loading={loading}
          disabled={Boolean(blockedReason)}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

export function PayrollRunDetail({ id }: { id: string }) {
  const { data: run, isPending, isError, error, isFetching } = usePayrollRun(id);
  const router = useRouter();
  const canManage = useCan({ permission: PERMISSIONS.PAYROLL_MANAGE });
  const canApprove = useCan({ permission: PERMISSIONS.PAYROLL_APPROVE });
  const canPay = useCan({ permission: PERMISSIONS.PAYROLL_PAY });
  const refresh = useRefreshPayrollRun();
  const approve = useApprovePayrollRun();
  const voidRun = useVoidPayrollRun();
  const pay = usePayPayrollRun();
  const deleteRun = useDeletePayrollRun();
  const runSif = useRunSif();
  const settings = usePayrollSettings();
  const saving = usePayrollLinesSaving(id);
  const lineEdits = usePayrollLines();
  const [confirm, setConfirm] = useState<'approve' | 'void' | 'delete' | null>(null);
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
  const posted = payable || run.status === 'PAID';
  const showSif = posted && canPay;
  const wpsOff = settings.data?.wpsEnabled === false;
  const hasPension = run.totals.pensionEmployee + run.totals.pensionEmployer > 0;
  const showVoid = run.status === 'APPROVED' && nothingPaid && canApprove;
  const lines = run.lines ?? [];
  const payingAmount = paying === 'BANK' ? run.totals.bankNet : run.totals.cashNet;
  const showDelete = isDraft && canManage;
  // Approve and Pay quote the run's totals, so they wait for every line edit to be
  // saved and the run refetched; a refused edit has to be fixed first.
  const blockedReason = lineEdits.rejected
    ? 'A line has a change the server refused. Fix the highlighted row first.'
    : lineEdits.unsaved || saving || isFetching
      ? 'Saving line changes…'
      : null;
  const startPaying = (method: PaymentMethod) => {
    setPaying(method);
    void lineEdits.flushAll();
  };

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
              <Button
                onClick={() => {
                  setConfirm('approve');
                  void lineEdits.flushAll();
                }}
              >
                <CheckCircle2 className="size-4" />
                Approve
              </Button>
            )}
            {showPayBank && (
              <Button onClick={() => startPaying('BANK')}>
                <Banknote className="size-4" />
                Pay bank
              </Button>
            )}
            {showPayCash && (
              <Button variant="outline" onClick={() => startPaying('CASH')}>
                <Banknote className="size-4" />
                Pay cash
              </Button>
            )}
            {showSif && (
              <Button
                variant="outline"
                loading={runSif.isPending}
                disabled={wpsOff}
                title={wpsOff ? 'Switch on WPS in payroll settings' : undefined}
                onClick={async () => {
                  try {
                    downloadSif(await runSif.mutateAsync(run.id));
                  } catch {
                    // useRunSif already toasted the server's reason.
                  }
                }}
              >
                <FileDown className="size-4" />
                Export SIF
              </Button>
            )}
            {showDelete && (
              <Button variant="ghost" onClick={() => setConfirm('delete')}>
                <Trash2 className="size-4" />
                Delete draft
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
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Salary cost" value={run.totals.salaryCost} testId="total-salary-cost" />
            <Stat label="Net pay" value={run.totals.net} testId="total-net" />
            <Stat label="Bank net" value={run.totals.bankNet} testId="total-bank-net" />
            <Stat label="Cash net" value={run.totals.cashNet} testId="total-cash-net" />
            <Stat label="Gratuity accrual" value={run.totals.gratuityAccrual} testId="total-gratuity" />
            <Stat label="Half pay" value={run.totals.halfPay} testId="total-half-pay" />
            <Stat label="Pension (employee)" value={run.totals.pensionEmployee} testId="total-pension-employee" />
            <Stat label="Pension (employer)" value={run.totals.pensionEmployer} testId="total-pension-employer" />
            <Stat label="Leave provision" value={run.totals.leaveProvision} testId="total-leave-provision" />
          </dl>
          {showSif && wpsOff && (
            <p className="mt-3 text-sm text-ink-muted" data-testid="sif-disabled-reason">
              Switch on WPS in payroll settings to export the SIF file.
            </p>
          )}
          {run.status === 'PARTIALLY_PAID' && (
            <p className="mt-3 text-sm text-ink-muted">
              {run.bankPaidAt ? 'Bank payments recorded.' : 'Bank payments still to record.'}{' '}
              {run.cashPaidAt ? 'Cash payments recorded.' : 'Cash payments still to record.'}
            </p>
          )}
        </CardBody>
      </Card>

      {posted && hasPension && <PensionPanel period={run.period} />}

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
                <th className="py-2 pr-2 text-right font-medium">Half-pay days</th>
                <th className="py-2 pr-2 text-right font-medium">Advance</th>
                <th className="py-2 pr-2 text-right font-medium">Other ded.</th>
                <th className="py-2 pr-2 text-right font-medium">Annual days</th>
                <th className="py-2 pr-2 text-right font-medium">Pension (emp.)</th>
                <th className="py-2 pr-2 text-right font-medium">Leave prov. change</th>
                <th className="py-2 pr-3 text-right font-medium">Net</th>
                <th className="py-2 text-right font-medium">
                  <span className="sr-only">Payslip</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <PayrollLinesProvider value={lineEdits.registry}>
                {lines.map((line) => (
                  <PayrollLineEditor key={line.id} runId={run.id} line={line} editable={isDraft && canManage} />
                ))}
              </PayrollLinesProvider>
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
        blockedReason={blockedReason}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await lineEdits.flushAll();
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
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this draft?"
        description={`${run.runNumber} and its lines are discarded. Nothing was posted, so the books do not change.`}
        confirmLabel="Delete draft"
        danger
        loading={deleteRun.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await deleteRun.mutateAsync(run.id);
          } catch {
            setConfirm(null);
            return;
          }
          router.push('/people/payroll');
        }}
      />
      {paying && (
        <PayRunModal
          open
          method={paying}
          amount={payingAmount}
          isLoading={pay.isPending}
          blockedReason={blockedReason}
          onClose={() => setPaying(null)}
          onSubmit={async (input) => {
            await pay.mutateAsync({ id: run.id, input });
          }}
        />
      )}
    </div>
  );
}
