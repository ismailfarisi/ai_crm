'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Paperclip, Plus, SlidersHorizontal } from 'lucide-react';
import {
  PERMISSIONS,
  leaveAdjustmentSchema,
  type LeaveAdjustmentInput,
  type LeaveAdjustmentPayload,
  type LeaveEntryKind,
  type LeaveRecordDto,
} from '@saas/shared';
import {
  useAdjustLeave,
  useCreateLeaveRecord,
  useDeleteLeaveRecord,
  useEmployeeLeave,
  useUpdateLeaveRecord,
} from '@/hooks/use-payroll';
import { Can } from '@/components/auth/can';
import { AttachmentsPanel } from '@/components/platform/attachments-panel';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { Badge, Card, CardBody, EmptyState } from '@/components/ui/primitives';
import { useCan } from '@/lib/session-context';
import { LEAVE_TYPE_LABELS, LeaveRecordModal } from './leave-record-modal';
import { inCurrency, money, usePayrollCurrency } from './payroll-format';

const ENTRY_LABELS: Record<LeaveEntryKind, string> = {
  OPENING: 'Opening balance',
  ACCRUAL: 'Accrual',
  TAKEN: 'Leave taken',
  ADJUSTMENT: 'Adjustment',
  ENCASHMENT: 'Encashment',
  REVERSAL: 'Reversal',
};

const days = (n: number) => String(Math.round(n * 100) / 100);
const day = (d: string) => new Date(d).toLocaleDateString();
const EMPTY_ADJUST: LeaveAdjustmentInput = { days: '' as unknown as number, note: '' };

function AdjustDaysDialog({ employeeId, open, onClose }: { employeeId: string; open: boolean; onClose: () => void }) {
  const adjust = useAdjustLeave();
  const form = useForm<LeaveAdjustmentInput, unknown, LeaveAdjustmentPayload>({
    resolver: zodResolver(leaveAdjustmentSchema),
    defaultValues: EMPTY_ADJUST,
  });
  useEffect(() => {
    if (open) form.reset(EMPTY_ADJUST);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Adjust leave days"
      description="Use a negative number to reduce the balance. The leave provision moves with it."
    >
      <form
        data-testid="leave-adjust-form"
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            await adjust.mutateAsync({ id: employeeId, input: values });
          } catch {
            return;
          }
          onClose();
        })}
      >
        <Input label="Days" type="number" step="0.01" {...form.register('days')} error={errors.days?.message} />
        <Input label="Reason" {...form.register('note')} error={errors.note?.message} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={adjust.isPending}>
            Adjust
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function EmployeeLeaveTab({ employeeId }: { employeeId: string }) {
  const { data, isPending, isError, error } = useEmployeeLeave(employeeId);
  const canManage = useCan({ permission: PERMISSIONS.EMPLOYEE_MANAGE });
  const create = useCreateLeaveRecord();
  const update = useUpdateLeaveRecord();
  const remove = useDeleteLeaveRecord();
  const [modal, setModal] = useState<{ record: LeaveRecordDto | null } | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [filesFor, setFilesFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LeaveRecordDto | null>(null);
  const cur = usePayrollCurrency();

  if (isPending) return <p className="text-ink-muted">Loading…</p>;
  if (isError || !data) {
    return <EmptyState title="Couldn't load leave" description={error instanceof Error ? error.message : 'Please try again.'} />;
  }

  return (
    <div className="space-y-4" data-testid="leave-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="grid grid-cols-3 gap-6 text-sm">
          <div>
            <dt className="text-xs text-ink-subtle">Balance (days)</dt>
            <dd data-testid="leave-balance" className="text-lg font-semibold tabular-nums text-ink">
              {days(data.balanceDays)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Annual entitlement</dt>
            <dd className="text-lg font-semibold tabular-nums text-ink-muted">{data.annualDays}</dd>
          </div>
          {data.provision !== undefined && (
            <div>
              <dt className="text-xs text-ink-subtle">Leave provision</dt>
              <dd data-testid="leave-provision" className="text-lg font-semibold tabular-nums text-ink-muted">
                {money(data.provision, cur)}
              </dd>
            </div>
          )}
        </dl>
        <div className="flex gap-2">
          <Can permission={PERMISSIONS.PAYROLL_APPROVE}>
            <Button variant="secondary" onClick={() => setAdjusting(true)}>
              <SlidersHorizontal className="size-4" />
              Adjust days
            </Button>
          </Can>
          <Can permission={PERMISSIONS.EMPLOYEE_MANAGE}>
            <Button onClick={() => setModal({ record: null })}>
              <Plus className="size-4" />
              Add leave
            </Button>
          </Can>
        </div>
      </div>

      <Card>
        <CardBody className="overflow-x-auto">
          {data.records.length === 0 ? (
            <p className="text-sm text-ink-muted">No leave recorded.</p>
          ) : (
            <table className="w-full text-sm" data-testid="leave-records">
              <thead>
                <tr className="text-left text-xs text-ink-subtle">
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">From</th>
                  <th className="py-2 font-medium">To</th>
                  <th className="py-2 text-right font-medium">Days</th>
                  <th className="py-2 font-medium">Note</th>
                  {canManage && <th className="py-2" />}
                </tr>
              </thead>
              <tbody>
                {data.records.map((r) => (
                  <tr key={r.id} className="border-t border-border/40 align-top">
                    <td className="py-2">
                      <Badge tone={r.type === 'UNPAID' ? 'warning' : 'neutral'}>{LEAVE_TYPE_LABELS[r.type]}</Badge>
                    </td>
                    <td className="py-2 whitespace-nowrap">{day(r.startDate)}</td>
                    <td className="py-2 whitespace-nowrap">{day(r.endDate)}</td>
                    <td className="py-2 text-right tabular-nums">{days(r.days)}</td>
                    <td className="py-2 text-ink-muted">
                      {r.note ?? '—'}
                      {canManage && filesFor === r.id && (
                        <div className="mt-3">
                          <AttachmentsPanel ownerType="LEAVE_RECORD" ownerId={r.id} canEdit />
                        </div>
                      )}
                    </td>
                    {canManage && (
                      <td className="py-2">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setFilesFor(filesFor === r.id ? null : r.id)}>
                            <Paperclip className="size-3.5" />
                            Files
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setModal({ record: r })}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleting(r)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="overflow-x-auto">
          {data.entries.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing in the leave ledger yet.</p>
          ) : (
            <table className="w-full text-sm" data-testid="leave-ledger">
              <thead>
                <tr className="text-left text-xs text-ink-subtle">
                  <th className="py-2 font-medium">As of</th>
                  <th className="py-2 font-medium">Movement</th>
                  <th className="py-2 font-medium">Note</th>
                  <th className="py-2 text-right font-medium">Days</th>
                  {data.provision !== undefined && <th className="py-2 text-right font-medium">{inCurrency('Amount', cur)}</th>}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id} className="border-t border-border/40">
                    <td className="py-2 whitespace-nowrap">{day(e.asOf)}</td>
                    <td className="py-2">{ENTRY_LABELS[e.kind]}</td>
                    <td className="py-2 text-ink-muted">{e.note ?? '—'}</td>
                    <td className="py-2 text-right tabular-nums">{days(e.days)}</td>
                    {data.provision !== undefined && (
                      <td className="py-2 text-right tabular-nums">{e.amount == null ? '—' : money(e.amount)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {canManage && modal && (
        <LeaveRecordModal
          open
          onClose={() => setModal(null)}
          existing={modal.record}
          isLoading={create.isPending || update.isPending}
          onSubmit={(input) =>
            modal.record
              ? update.mutateAsync({ id: employeeId, recordId: modal.record.id, input })
              : create.mutateAsync({ id: employeeId, input })
          }
        />
      )}
      {canManage && deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title={`Delete ${LEAVE_TYPE_LABELS[deleting.type].toLowerCase()} leave, ${day(deleting.startDate)} to ${day(deleting.endDate)}?`}
          description={`The record of ${days(deleting.days)} ${deleting.days === 1 ? 'day' : 'days'} is removed and payroll stops counting it. Any draft payroll run for those months is worked out again.`}
          confirmLabel="Delete leave"
          tone="danger"
          onConfirm={() => remove.mutateAsync({ id: employeeId, recordId: deleting.id })}
        />
      )}
      <Can permission={PERMISSIONS.PAYROLL_APPROVE}>
        <AdjustDaysDialog employeeId={employeeId} open={adjusting} onClose={() => setAdjusting(false)} />
      </Can>
    </div>
  );
}
