'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Ban, Banknote, PauseCircle, ShieldCheck, Undo2 } from 'lucide-react';
import { PERMISSIONS, canTransitionBill } from '@saas/shared';
import {
  useBill,
  useBillAction,
  useBillMatch,
  useBillPayments,
  usePayBill,
  useReverseBillPayment,
} from '@/hooks/use-bills';
import { useFinanceAccounts } from '@/hooks/use-finance';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { Input, Textarea } from '@/components/ui/field';
import { BillStatusPill } from './bills-view';
import { AttachmentsPanel } from '@/components/platform/attachments-panel';
import { ActivityTimeline } from '@/components/platform/activity-timeline';

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BillDetail({ id }: { id: string }) {
  const { data: bill, isPending, isError, error } = useBill(id);
  const { data: match } = useBillMatch(id, bill?.status === 'DRAFT');
  const { data: payments = [] } = useBillPayments(id);
  const { data: accounts = [] } = useFinanceAccounts();
  const act = useBillAction();
  const pay = usePayBill();
  const reverse = useReverseBillPayment();

  const [paying, setPaying] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');

  if (isPending) return <p className="text-ink-muted">Loading…</p>;
  if (isError || !bill) {
    return <EmptyState title="Couldn't load this bill" description={error instanceof Error ? error.message : 'Please try again.'} />;
  }

  const outstanding = Math.round((bill.totalAmount - bill.paidAmount) * 100) / 100;
  const can = (to: Parameters<typeof canTransitionBill>[1]) => canTransitionBill(bill.status, to);

  return (
    <>
      <PageHeader
        title={bill.billNumber}
        description={`${bill.supplierName} · their invoice ${bill.supplierInvoiceNumber} · ${money(bill.totalAmount)} ${bill.currency}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <BillStatusPill status={bill.status} />
            {can('APPROVED') && (
              <Can permission={PERMISSIONS.BILL_APPROVE}>
                <Button loading={act.isPending} onClick={() => act.mutate({ id, action: 'approve' })}>
                  <ShieldCheck className="size-4" />
                  Approve
                </Button>
              </Can>
            )}
            {(bill.status === 'APPROVED' || bill.status === 'PARTIALLY_PAID') && (
              <Can permission={PERMISSIONS.BILL_PAY}>
                <Button onClick={() => setPaying(true)}>
                  <Banknote className="size-4" />
                  Record payment
                </Button>
              </Can>
            )}
            {can('DISPUTED') && (
              <Can permission={PERMISSIONS.BILL_UPDATE}>
                <Button variant="secondary" onClick={() => setDisputing(true)}>
                  <PauseCircle className="size-4" />
                  Dispute
                </Button>
              </Can>
            )}
            {bill.status === 'DISPUTED' && (
              <Can permission={PERMISSIONS.BILL_UPDATE}>
                <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate({ id, action: 'reopen' })}>
                  <Undo2 className="size-4" />
                  Back to draft
                </Button>
              </Can>
            )}
            {can('CANCELLED') && (
              <Can permission={PERMISSIONS.BILL_UPDATE}>
                <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate({ id, action: 'cancel' })}>
                  <Ban className="size-4" />
                  Cancel
                </Button>
              </Can>
            )}
          </div>
        }
      />

      {bill.status === 'DRAFT' && match && match.variances.length > 0 && (
        <div className="mb-6 rounded border border-warning/40 bg-warning-soft/40 p-4 text-sm">
          <p className="mb-2 flex items-center gap-2 font-medium text-warning">
            <AlertTriangle className="size-4" />
            Does not match {bill.purchaseOrderId ? 'its order' : 'an order'}
          </p>
          <ul className="space-y-1 text-ink-muted">
            {match.variances.map((v, i) => (
              <li key={i}>{v.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-subtle">Approving this needs permission to accept a variance.</p>
        </div>
      )}

      {bill.status === 'DISPUTED' && bill.disputeReason && (
        <p className="mb-6 rounded border border-danger/40 bg-danger-soft/40 p-3 text-sm text-ink-muted">
          On hold: {bill.disputeReason}
        </p>
      )}

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Invoice date', new Date(bill.billDate).toLocaleDateString()],
          ['Due', bill.dueDate ? new Date(bill.dueDate).toLocaleDateString() : '—'],
          ['Paid', money(bill.paidAmount)],
          ['Outstanding', money(outstanding)],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-line bg-surface px-3 py-2">
            <dt className="text-xs text-ink-subtle">{label}</dt>
            <dd className="tabular-nums text-sm font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {bill.purchaseOrderId && (
        <p className="mb-3 text-sm text-ink-muted">
          Against{' '}
          <Link className="text-accent hover:underline" href={`/purchasing/orders/${bill.purchaseOrderId}`}>
            the purchase order
          </Link>
          {bill.varianceApproved && ' · approved with a variance'}
        </p>
      )}

      <div className="mb-6 overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunk text-left">
              <th className="px-4 py-2 font-medium text-ink-muted">Description</th>
              <th className="px-4 py-2 text-right font-medium text-ink-muted">Qty</th>
              <th className="px-4 py-2 text-right font-medium text-ink-muted">Billed at</th>
              <th className="px-4 py-2 text-right font-medium text-ink-muted">Ordered at</th>
              <th className="px-4 py-2 text-right font-medium text-ink-muted">Total</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((line) => (
              <tr key={line.id} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-2 text-ink">{line.description}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{line.qty}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">{line.unitCost.toFixed(4)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-subtle">
                  {line.orderUnitCost == null ? '—' : line.orderUnitCost.toFixed(4)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">{money(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {payments.length > 0 && (
        <section aria-label="Payments">
          <h2 className="mb-2 text-sm font-medium text-ink">Payments</h2>
          <ul className="divide-y divide-line rounded border border-line bg-surface text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className={p.reversedAt ? 'text-ink-subtle line-through' : 'text-ink'}>
                  {money(p.amount)} on {new Date(p.paidAt).toLocaleDateString()}
                  {p.reference && ` · ${p.reference}`}
                </span>
                {p.reversedAt ? (
                  <span className="text-xs text-ink-subtle">Reversed</span>
                ) : (
                  <Can permission={PERMISSIONS.BILL_PAY}>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={reverse.isPending}
                      onClick={() => reverse.mutate({ id, paymentId: p.id })}
                    >
                      Reverse
                    </Button>
                  </Can>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Can permission={PERMISSIONS.BILL_UPDATE}>
          {(allowed) => <AttachmentsPanel ownerType="BILL" ownerId={id} canEdit={allowed} />}
        </Can>
        <ActivityTimeline subjectType="BILL" subjectId={id} />
      </div>

      <Dialog
        open={paying}
        onClose={() => setPaying(false)}
        size="sm"
        title={`Pay ${bill.billNumber}`}
        description={`${money(outstanding)} ${bill.currency} outstanding.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPaying(false)}>
              Cancel
            </Button>
            <Button
              loading={pay.isPending}
              disabled={!accountId}
              onClick={async () => {
                await pay.mutateAsync({
                  id,
                  input: {
                    financeAccountId: accountId,
                    amount: amount ? Number(amount) : undefined,
                    reference: reference || null,
                  },
                });
                setPaying(false);
                setAmount('');
                setReference('');
              }}
            >
              Pay {amount ? money(Number(amount)) : money(outstanding)}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block text-sm" htmlFor="pay-account">
            <span className="mb-1 block font-medium text-ink">Pay from</span>
            <select
              id="pay-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded border border-line bg-surface px-3 py-2 text-ink"
            >
              <option value="">Choose an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({money(a.balance)} {a.currency})
                </option>
              ))}
            </select>
          </label>
          <Input
            id="pay-amount"
            label="Amount"
            type="number"
            min={0}
            step="0.01"
            placeholder={money(outstanding)}
            hint="Leave blank to pay the full outstanding balance."
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input
            id="pay-reference"
            label="Payment reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
      </Dialog>

      <Dialog
        open={disputing}
        onClose={() => setDisputing(false)}
        size="sm"
        title={`Dispute ${bill.billNumber}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisputing(false)}>
              Cancel
            </Button>
            <Button
              loading={act.isPending}
              onClick={async () => {
                await act.mutateAsync({ id, action: 'dispute', reason: reason || null });
                setDisputing(false);
                setReason('');
              }}
            >
              Put on hold
            </Button>
          </>
        }
      >
        <Textarea
          id="dispute-reason"
          label="What is wrong with it"
          placeholder="Billed 520 sheets, 500 arrived…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Dialog>
    </>
  );
}
