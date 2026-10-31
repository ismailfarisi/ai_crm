'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Banknote, CheckCircle2, FileDown, FileText, Plus, RefreshCw, Trash2, Undo2 } from 'lucide-react';
import {
  PERMISSIONS,
  updateSettlementSchema,
  type SettlementDto,
  type UpdateSettlementInput,
  type UpdateSettlementPayload,
} from '@saas/shared';
import {
  useApproveSettlement,
  useDeleteSettlement,
  usePaySettlement,
  usePayrollSettings,
  useRefreshSettlement,
  useSettlement,
  useSettlementSif,
  useUpdateSettlement,
  useVoidSettlement,
} from '@/hooks/use-payroll';
import { describeServer } from '@/lib/api/describe';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Alert, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { PeopleNav } from './people-nav';
import { ConfirmDialog } from './payroll-run-detail';
import { PayRunModal } from './pay-run-modal';
import { SettlementStatusBadge, REASON_OPTIONS } from './settlements-view';
import { downloadSif } from './download-sif';
import { SETTLEMENT_REASON_LABELS, inCurrency, money, serviceLabel, usePayrollCurrency } from './payroll-format';

const optionalNumber = (v: unknown) => (v === '' || v == null || Number.isNaN(v) ? undefined : Number(v));
/** A cleared notice or recovery field means none, which the server only learns from an explicit 0. */
const zeroIfCleared = (v: unknown) => optionalNumber(v) ?? 0;

const NOTICE_OPTIONS = [
  { value: 'PAY', label: 'Paid to the employee' },
  { value: 'DEDUCT', label: 'Deducted from the employee' },
];

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd data-testid={testId} className="text-lg font-semibold tabular-nums text-ink">
        {value}
      </dd>
    </div>
  );
}

/** The editable values, read back off the calculated and manual lines. */
function formValues(s: SettlementDto): UpdateSettlementInput {
  const first = (kind: string) => s.lines.find((l) => l.kind === kind);
  const leave = first('LEAVE_ENCASHMENT');
  const notice = first('NOTICE_PAY');
  const advance = first('ADVANCE_RECOVERY');
  return {
    reason: s.reason,
    // A negative balance is deducted in full, so there is nothing to edit.
    leaveEncashmentDays: s.leaveBalanceDays < 0 ? undefined : (leave?.quantity ?? 0),
    noticeDays: notice?.quantity ?? 0,
    noticeDirection: notice && notice.amount < 0 ? 'DEDUCT' : 'PAY',
    advanceRecovery: advance ? Math.abs(advance.amount) : 0,
    manualLines: s.lines
      .filter((l) => l.kind === 'ADDITION' || l.kind === 'DEDUCTION')
      .map((l) => ({ kind: l.kind as 'ADDITION' | 'DEDUCTION', label: l.label, amount: Math.abs(l.amount) })),
  };
}

function SettlementEditor({ settlement, onDirty }: { settlement: SettlementDto; onDirty: (dirty: boolean) => void }) {
  const update = useUpdateSettlement();
  const [error, setError] = useState<string | null>(null);
  const defaults = useMemo(() => formValues(settlement), [settlement]);
  const form = useForm<UpdateSettlementInput, unknown, UpdateSettlementPayload>({
    resolver: zodResolver(updateSettlementSchema),
    defaultValues: defaults,
  });
  const manual = useFieldArray({ control: form.control, name: 'manualLines' });
  const errors = form.formState.errors;

  // A save or refresh returns fresh lines; show them as the form's new baseline.
  useEffect(() => {
    form.reset(defaults);
  }, [defaults]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = form.formState.isDirty;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const negativeBalance = settlement.leaveBalanceDays < 0;

  return (
    <form
      data-testid="settlement-form"
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        if (!negativeBalance && values.leaveEncashmentDays === undefined) {
          form.setError('leaveEncashmentDays', { message: 'Enter the days, or use Refresh to restore the computed figure' });
          return;
        }
        setError(null);
        try {
          await update.mutateAsync({ id: settlement.id, input: values });
        } catch (err) {
          setError(describeServer(err, 'Could not save the settlement'));
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Reason" options={REASON_OPTIONS} {...form.register('reason')} error={errors.reason?.message} />
        {!negativeBalance && (
          <Input
            label="Leave encashment days"
            type="number"
            step="0.01"
            hint={`Up to ${settlement.leaveBalanceDays} days untaken.`}
            {...form.register('leaveEncashmentDays', { setValueAs: optionalNumber })}
            error={errors.leaveEncashmentDays?.message}
          />
        )}
        <Input
          label="Notice days"
          type="number"
          step="0.01"
          {...form.register('noticeDays', { setValueAs: zeroIfCleared })}
          error={errors.noticeDays?.message}
        />
        <Select
          label="Notice is"
          options={NOTICE_OPTIONS}
          {...form.register('noticeDirection')}
          error={errors.noticeDirection?.message}
        />
        <Input
          label="Advance recovery"
          type="number"
          step="0.01"
          hint="Recovered from the settlement, up to what is outstanding."
          {...form.register('advanceRecovery', { setValueAs: zeroIfCleared })}
          error={errors.advanceRecovery?.message}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Other lines</h3>
          <Button type="button" variant="outline" onClick={() => manual.append({ kind: 'ADDITION', label: '', amount: '' })}>
            <Plus className="size-4" />
            Add line
          </Button>
        </div>
        {manual.fields.length === 0 && <p className="text-sm text-ink-muted">No additions or deductions.</p>}
        {manual.fields.map((field, i) => {
          const lineErrors = errors.manualLines?.[i];
          return (
            <div key={field.id} className="grid items-start gap-2 sm:grid-cols-[9rem_1fr_9rem_auto]" data-testid="manual-line">
              <Select
                aria-label={`Type of line ${i + 1}`}
                options={[
                  { value: 'ADDITION', label: 'Addition' },
                  { value: 'DEDUCTION', label: 'Deduction' },
                ]}
                {...form.register(`manualLines.${i}.kind`)}
              />
              <Input
                aria-label={`Label of line ${i + 1}`}
                placeholder="Description"
                {...form.register(`manualLines.${i}.label`)}
                error={lineErrors?.label?.message}
              />
              <Input
                aria-label={`Amount of line ${i + 1}`}
                type="number"
                step="0.01"
                placeholder="Amount"
                {...form.register(`manualLines.${i}.amount`)}
                error={lineErrors?.amount?.message}
              />
              <Button type="button" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => manual.remove(i)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          );
        })}
      </div>

      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" loading={update.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

export function SettlementDetail({ id }: { id: string }) {
  const { data: s, isPending, isError, error, isFetching } = useSettlement(id);
  const cur = usePayrollCurrency();
  const router = useRouter();
  const canManage = useCan({ permission: PERMISSIONS.PAYROLL_MANAGE });
  const canApprove = useCan({ permission: PERMISSIONS.PAYROLL_APPROVE });
  const canPay = useCan({ permission: PERMISSIONS.PAYROLL_PAY });
  const refresh = useRefreshSettlement();
  const approve = useApproveSettlement();
  const voidSettlement = useVoidSettlement();
  const pay = usePaySettlement();
  const remove = useDeleteSettlement();
  const sif = useSettlementSif();
  const settings = usePayrollSettings();
  const [confirm, setConfirm] = useState<'approve' | 'void' | 'delete' | null>(null);
  const [paying, setPaying] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (isError || !s) {
    return (
      <EmptyState
        title="Couldn't load this settlement"
        description={error instanceof Error ? error.message : 'Please try again.'}
      />
    );
  }

  const isDraft = s.status === 'DRAFT';
  const editable = isDraft && canManage;
  const showApprove = isDraft && canApprove;
  const showVoid = s.status === 'APPROVED' && canApprove;
  const showPay = s.status === 'APPROVED' && canPay;
  const showSif = (s.status === 'APPROVED' || s.status === 'PAID') && s.paymentMethod === 'BANK' && canPay;
  const wpsOff = settings.data?.wpsEnabled === false;
  const stale = approveError !== null && /refresh/i.test(approveError);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${s.settlementNumber} · ${s.employeeName}`}
        description={`${SETTLEMENT_REASON_LABELS[s.reason]} · left ${new Date(s.leavingDate).toLocaleDateString()}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SettlementStatusBadge status={s.status} />
            {editable && (
              <Button
                variant="outline"
                loading={refresh.isPending}
                title="Recalculate from current balances"
                onClick={() => {
                  setApproveError(null);
                  refresh.mutate(s.id);
                }}
              >
                <RefreshCw className="size-4" />
                Refresh
              </Button>
            )}
            {showApprove && (
              <Button
                onClick={() => {
                  setApproveError(null);
                  setConfirm('approve');
                }}
              >
                <CheckCircle2 className="size-4" />
                Approve
              </Button>
            )}
            {showPay && (
              <Button onClick={() => setPaying(true)}>
                <Banknote className="size-4" />
                Pay
              </Button>
            )}
            {showSif && (
              <Button
                variant="outline"
                loading={sif.isPending}
                disabled={wpsOff}
                title={wpsOff ? 'Switch on WPS in payroll settings' : undefined}
                onClick={async () => {
                  try {
                    downloadSif(await sif.mutateAsync(s.id));
                  } catch {
                    // useSettlementSif already toasted the server's reason.
                  }
                }}
              >
                <FileDown className="size-4" />
                Export SIF
              </Button>
            )}
            <Link
              href={`/people/settlements/${s.id}/statement`}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/80 px-3 text-sm font-medium text-ink hover:border-border-strong"
            >
              <FileText className="size-4" />
              Statement
            </Link>
            {editable && (
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
      <Link href="/people/settlements" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" />
        All settlements
      </Link>

      {stale && (
        <Alert tone="warning">
          <span data-testid="approve-stale">{approveError}</span>
          {editable && (
            <Button
              className="ml-3"
              variant="outline"
              loading={refresh.isPending}
              onClick={() => {
                setApproveError(null);
                refresh.mutate(s.id);
              }}
            >
              <RefreshCw className="size-4" />
              Refresh now
            </Button>
          )}
        </Alert>
      )}
      {approveError && !stale && <Alert>{approveError}</Alert>}

      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Service" value={serviceLabel(s.serviceDays)} testId="settlement-service" />
            <Stat label="Basic" value={money(s.basic, cur)} testId="settlement-basic" />
            <Stat label="Gross" value={money(s.gross, cur)} testId="settlement-gross" />
            <Stat label="Leave balance (days)" value={String(s.leaveBalanceDays)} testId="settlement-leave-balance" />
            <Stat label="Net settlement" value={money(s.netPay, cur)} testId="settlement-net" />
          </dl>
          {showSif && wpsOff && (
            <p className="mt-3 text-sm text-ink-muted" data-testid="sif-disabled-reason">
              Switch on WPS in payroll settings to export the SIF file.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="settlement-lines">
            <thead>
              <tr className="text-left text-xs text-ink-subtle">
                <th className="py-2 font-medium">Line</th>
                <th className="py-2 text-right font-medium">Days</th>
                <th className="py-2 text-right font-medium">{inCurrency('Rate', cur)}</th>
                <th className="py-2 text-right font-medium">{inCurrency('Amount', cur)}</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.id} className="border-t border-border/40">
                  <td className="py-2">{l.label}</td>
                  <td className="py-2 text-right tabular-nums">{l.quantity ?? ''}</td>
                  <td className="py-2 text-right tabular-nums">{l.rate != null ? money(l.rate) : ''}</td>
                  <td className="py-2 text-right tabular-nums">{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.lines.length === 0 && <p className="py-4 text-sm text-ink-muted">This settlement has no lines.</p>}
          {!isDraft && s.status !== 'VOIDED' && <p className="mt-3 text-xs text-ink-subtle">Only draft settlements can be edited.</p>}
        </CardBody>
      </Card>

      {editable && (
        <Card>
          <CardHeader>
            <CardTitle>Adjust the settlement</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-ink-muted" data-testid="refresh-note">
              Refresh recalculates gratuity and leave from today&apos;s balances. It resets leave encashment days and advance
              recovery to the full amounts and discards unsaved changes below; notice and other lines are kept.
            </p>
            <SettlementEditor settlement={s} onDirty={setDirty} />
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={confirm === 'approve'}
        title="Approve this settlement?"
        description={`This posts ${s.settlementNumber} to the books with a net settlement of ${money(s.netPay, cur)} and clears ${s.employeeName}'s gratuity and leave balances.`}
        confirmLabel="Approve settlement"
        loading={approve.isPending}
        blockedReason={dirty ? 'You have unsaved changes. Save them first, so the net shown here is the one approved.' : isFetching ? 'Refreshing…' : null}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await approve.mutateAsync(s.id);
          } catch (err) {
            setApproveError(describeServer(err, 'Could not approve the settlement'));
          } finally {
            setConfirm(null);
          }
        }}
      />
      <ConfirmDialog
        open={confirm === 'void'}
        title="Void this settlement?"
        description="This reverses the settlement's journal entry and restores the gratuity and leave balances. It can only be done while nothing has been paid."
        confirmLabel="Void settlement"
        danger
        loading={voidSettlement.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await voidSettlement.mutateAsync(s.id);
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
        description={`${s.settlementNumber} is discarded. Nothing was posted, so the books do not change.`}
        confirmLabel="Delete draft"
        danger
        loading={remove.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await remove.mutateAsync(s.id);
          } catch {
            setConfirm(null);
            return;
          }
          router.push('/people/settlements');
        }}
      />
      {paying && (
        <PayRunModal
          open
          method={s.paymentMethod}
          amount={s.netPay}
          title="Pay the settlement"
          description={`Records ${money(s.netPay, cur)} paid to ${s.employeeName}.`}
          isLoading={pay.isPending}
          onClose={() => setPaying(false)}
          onSubmit={async ({ financeAccountId, paidAt }) => {
            await pay.mutateAsync({ id: s.id, input: { financeAccountId, paidAt } });
          }}
        />
      )}
    </div>
  );
}
