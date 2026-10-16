'use client';

import { useMemo, useState } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { usePensionPeriod, useRemitPension, useVoidPension } from '@/hooks/use-payroll';
import { useFinanceAccounts } from '@/hooks/use-finance';
import { useOrganization } from '@/hooks/use-organization';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';
import { Badge, Card, CardBody } from '@/components/ui/primitives';
import { money, periodLabel } from './payroll-format';

function RemitModal({ period, amount, onClose }: { period: string; amount: number; onClose: () => void }) {
  const { data: accounts = [] } = useFinanceAccounts();
  const { data: org } = useOrganization();
  const remit = useRemitPension();
  const [accountId, setAccountId] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [showError, setShowError] = useState(false);
  const baseCurrency = org?.baseCurrency;
  // The pension journal posts in the base currency, so only accounts held in it qualify.
  const options = useMemo(
    () =>
      accounts
        .filter((a) => !baseCurrency || a.currency === baseCurrency)
        .map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })),
    [accounts, baseCurrency],
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title="Remit pension contributions"
      description={`Records ${money(amount)} paid to the pension fund for ${periodLabel(period)}.`}
    >
      <form
        data-testid="remit-pension-form"
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!accountId) {
            setShowError(true);
            return;
          }
          try {
            await remit.mutateAsync({
              period,
              input: { financeAccountId: accountId, paidAt: paidAt ? new Date(paidAt) : undefined },
            });
          } catch {
            return;
          }
          onClose();
        }}
      >
        <Select
          label="Paid from"
          placeholder="Choose an account"
          options={options}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          error={showError && !accountId ? 'Choose the account it was paid from' : undefined}
        />
        <Input label="Date (optional)" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={remit.isPending}>
            Record remittance
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** What is owed to the pension fund for a posted month, and whether it has been paid over. */
export function PensionPanel({ period }: { period: string }) {
  const canPay = useCan({ permission: PERMISSIONS.PAYROLL_PAY });
  const { data } = usePensionPeriod(period);
  const voidRemittance = useVoidPension();
  const [remitting, setRemitting] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);

  if (!data) return null;
  const remitted = data.remittance && !data.remittance.voidedAt ? data.remittance : null;

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">Pension contributions</h3>
            {remitted ? (
              <Badge tone="success">Remitted</Badge>
            ) : (
              <Badge tone="warning">Due</Badge>
            )}
          </div>
          {canPay && (
            <div className="flex gap-2">
              {remitted ? (
                <Button variant="ghost" onClick={() => setConfirmingVoid(true)}>
                  Void remittance
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setRemitting(true)}>
                  Remit
                </Button>
              )}
            </div>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-subtle">Employee share</dt>
            <dd data-testid="pension-employee" className="font-semibold tabular-nums text-ink">
              {money(data.employeeTotal)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Employer share</dt>
            <dd data-testid="pension-employer" className="font-semibold tabular-nums text-ink">
              {money(data.employerTotal)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Due to the fund</dt>
            <dd data-testid="pension-due" className="font-semibold tabular-nums text-ink">
              {money(data.due)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Status</dt>
            <dd className="text-sm text-ink-muted" data-testid="pension-status">
              {remitted ? `Paid ${new Date(remitted.paidAt).toLocaleDateString()}` : 'Not yet remitted'}
            </dd>
          </div>
        </dl>
      </CardBody>
      {remitting && <RemitModal period={period} amount={data.due} onClose={() => setRemitting(false)} />}
      <Dialog
        open={confirmingVoid}
        onClose={() => setConfirmingVoid(false)}
        title="Void this remittance?"
        description="The payment journal is reversed and the contributions show as due again."
      >
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setConfirmingVoid(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={voidRemittance.isPending}
            onClick={async () => {
              try {
                await voidRemittance.mutateAsync(period);
              } catch {
                return;
              } finally {
                setConfirmingVoid(false);
              }
            }}
          >
            Void remittance
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
