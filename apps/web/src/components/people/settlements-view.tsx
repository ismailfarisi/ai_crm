'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, UserMinus } from 'lucide-react';
import { PERMISSIONS, SETTLEMENT_REASONS, type SettlementDto, type SettlementReason, type SettlementStatus } from '@saas/shared';
import { useCreateSettlement, useEmployees, useSettlements } from '@/hooks/use-payroll';
import { describeServer } from '@/lib/api/describe';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import { Alert, Badge, Card, CardBody, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { PeopleNav } from './people-nav';
import { SETTLEMENT_REASON_LABELS, SETTLEMENT_STATUS_LABELS, SETTLEMENT_STATUS_TONES, inCurrency, money, usePayrollCurrency } from './payroll-format';

export function SettlementStatusBadge({ status }: { status: SettlementStatus }) {
  return <Badge tone={SETTLEMENT_STATUS_TONES[status]}>{SETTLEMENT_STATUS_LABELS[status]}</Badge>;
}

export const REASON_OPTIONS = SETTLEMENT_REASONS.map((r) => ({ value: r, label: SETTLEMENT_REASON_LABELS[r] }));

function NewSettlementModal({
  open,
  onClose,
  settlements,
}: {
  open: boolean;
  onClose: () => void;
  settlements: SettlementDto[];
}) {
  const router = useRouter();
  const create = useCreateSettlement();
  const { data: leavers = [] } = useEmployees({ status: 'LEFT' });
  const [employeeId, setEmployeeId] = useState('');
  const [reason, setReason] = useState<SettlementReason>('RESIGNATION');
  const [error, setError] = useState<string | null>(null);

  // A voided settlement frees the leaver to be settled again.
  const options = useMemo(() => {
    const live = new Set(settlements.filter((s) => s.status !== 'VOIDED').map((s) => s.employeeId));
    return leavers
      .filter((e) => !live.has(e.id))
      .map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeNumber})` }));
  }, [leavers, settlements]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New settlement"
      description="Drafts the end-of-service gratuity, leave encashment and advance recovery for an employee who has left."
    >
      <form
        data-testid="new-settlement-form"
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!employeeId) {
            setError('Choose the employee who left');
            return;
          }
          setError(null);
          try {
            const created = await create.mutateAsync({ employeeId, reason });
            onClose();
            router.push(`/people/settlements/${created.id}`);
          } catch (err) {
            setError(describeServer(err, 'Could not draft the settlement'));
          }
        }}
      >
        <Select
          label="Employee"
          placeholder={options.length ? 'Choose an employee' : 'No leavers waiting for a settlement'}
          options={options}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        />
        <Select
          label="Reason"
          options={REASON_OPTIONS}
          value={reason}
          onChange={(e) => setReason(e.target.value as SettlementReason)}
        />
        {error && <Alert>{error}</Alert>}
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

export function SettlementsView() {
  const { data, isPending, isError, error } = useSettlements();
  const cur = usePayrollCurrency();
  const [adding, setAdding] = useState(false);
  const settlements = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlements"
        description="Final settlements for employees who have left, from draft to paid."
        actions={
          <Can permission={PERMISSIONS.PAYROLL_MANAGE}>
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              New settlement
            </Button>
          </Can>
        }
      />
      <PeopleNav />

      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : isError ? (
        <EmptyState
          title="Couldn't load settlements"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : settlements.length === 0 ? (
        <EmptyState
          icon={<UserMinus className="size-8" />}
          title="No settlements yet"
          description="Mark an employee as left, then draft their final settlement here."
        />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="settlements-table">
              <thead>
                <tr className="text-left text-xs text-ink-subtle">
                  <th className="py-2 font-medium">Number</th>
                  <th className="py-2 font-medium">Employee</th>
                  <th className="py-2 font-medium">Leaving date</th>
                  <th className="py-2 font-medium">Reason</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">{inCurrency('Net', cur)}</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id} className="border-t border-border/40">
                    <td className="py-2">
                      <Link href={`/people/settlements/${s.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                        {s.settlementNumber}
                      </Link>
                    </td>
                    <td className="py-2">{s.employeeName}</td>
                    <td className="py-2 whitespace-nowrap">{new Date(s.leavingDate).toLocaleDateString()}</td>
                    <td className="py-2 text-ink-muted">{SETTLEMENT_REASON_LABELS[s.reason]}</td>
                    <td className="py-2">
                      <SettlementStatusBadge status={s.status} />
                    </td>
                    <td className="py-2 text-right tabular-nums">{money(s.netPay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <Can permission={PERMISSIONS.PAYROLL_MANAGE}>
        {adding && <NewSettlementModal open onClose={() => setAdding(false)} settlements={settlements} />}
      </Can>
    </div>
  );
}
