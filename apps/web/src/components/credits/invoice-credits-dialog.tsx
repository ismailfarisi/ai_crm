'use client';

import { useState } from 'react';
import { invoicePosition, PERMISSIONS, type InvoiceDto } from '@saas/shared';
import { useCreditNoteAction, useCreditNotes } from '@/hooks/use-credits';
import { useFinanceAccounts } from '@/hooks/use-finance';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/field';

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Credits against one invoice: what has been credited and refunded, and a
 * form to credit more. An amount is entered net of tax; the API spreads it
 * across the invoice's tax codes in the proportions the invoice charged.
 */
export function InvoiceCreditsDialog({ invoice, onClose }: { invoice: InvoiceDto | null; onClose: () => void }) {
  const open = invoice !== null;
  const { data: notes = [] } = useCreditNotes(invoice?.id, open);
  const { data: accounts = [] } = useFinanceAccounts();
  const act = useCreditNoteAction();
  const canCreate = useCan({ permission: PERMISSIONS.CREDIT_NOTE_CREATE });
  const canIssue = useCan({ permission: PERMISSIONS.CREDIT_NOTE_APPROVE });
  const canRefund = useCan({ permission: PERMISSIONS.CREDIT_NOTE_REFUND });

  const [mode, setMode] = useState<'amount' | 'full'>('amount');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [refundAccount, setRefundAccount] = useState('');

  if (!invoice) return null;

  const position = invoicePosition({
    amount: invoice.amount,
    paidAmount: invoice.paidAmount ?? 0,
    creditedAmount: invoice.creditedAmount ?? 0,
    refundedAmount: invoice.refundedAmount ?? 0,
  });
  const netTotal = invoice.subtotalAmount || invoice.amount;
  const previewTax =
    mode === 'amount' && Number(amount) > 0 && netTotal > 0
      ? Math.round(((invoice.taxAmount * Number(amount)) / netTotal) * 100) / 100
      : null;
  const valid =
    reason.trim().length >= 3 &&
    (mode === 'full' || (Number(amount) > 0 && Number(amount) + (previewTax ?? 0) <= position.creditable + 0.001));

  const submit = (issue: boolean) =>
    act.mutate(
      {
        kind: 'create',
        invoiceId: invoice.id,
        reason: reason.trim(),
        ...(mode === 'full' ? { full: true } : { netAmount: Number(amount) }),
        issue,
      },
      {
        onSuccess: () => {
          setAmount('');
          setReason('');
        },
      },
    );

  return (
    <Dialog open={open} onClose={onClose} title={`Credits — ${invoice.invoiceNumber}`} size="lg">
      <dl className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {[
          ['Invoiced', invoice.amount],
          ['Paid', invoice.paidAmount ?? 0],
          ['Credited', invoice.creditedAmount ?? 0],
          [position.balance < 0 ? 'Owed to customer' : 'Still owed', Math.abs(position.balance)],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded bg-surface-sunk px-3 py-2">
            <dt className="text-xs text-ink-subtle">{label}</dt>
            <dd className="font-medium tabular-nums text-ink">
              {money(Number(value))} {invoice.currency}
            </dd>
          </div>
        ))}
      </dl>

      {notes.length > 0 && (
        <ul className="mb-5 divide-y divide-line rounded border border-line">
          {notes.map((note) => {
            const unrefunded = Math.round((note.totalAmount - note.refundedAmount) * 100) / 100;
            const refundable = Math.min(unrefunded, position.refundable);
            return (
              <li key={note.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-ink">
                    <span className="font-mono">{note.creditNoteNumber}</span> ·{' '}
                    <span className="tabular-nums">{money(note.totalAmount)}</span>
                    <span className="text-ink-subtle"> ({money(note.taxAmount)} tax)</span>
                  </p>
                  <p className="truncate text-xs text-ink-subtle">
                    {note.status.toLowerCase()} · {note.reason}
                    {note.refundedAmount > 0 && ` · ${money(note.refundedAmount)} refunded`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {note.status === 'DRAFT' && canIssue && (
                    <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ kind: 'issue', id: note.id })}>
                      Issue
                    </Button>
                  )}
                  {note.status === 'DRAFT' && canCreate && (
                    <Button size="sm" variant="ghost" onClick={() => act.mutate({ kind: 'cancel', id: note.id })}>
                      Discard
                    </Button>
                  )}
                  {note.status === 'ISSUED' && canRefund && refundable > 0 && (
                    <>
                      <select
                        aria-label="Refund from account"
                        value={refundAccount}
                        onChange={(e) => setRefundAccount(e.target.value)}
                        className="rounded border border-line bg-surface px-2 py-1 text-sm text-ink"
                      >
                        <option value="">Refund from…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!refundAccount}
                        loading={act.isPending}
                        onClick={() => act.mutate({ kind: 'refund', id: note.id, financeAccountId: refundAccount })}
                      >
                        Refund {money(refundable)}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canCreate && invoice.status !== 'CANCELLED' && position.creditable > 0 && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) submit(canIssue);
          }}
        >
          <fieldset className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === 'amount'} onChange={() => setMode('amount')} />
              An amount
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === 'full'} onChange={() => setMode('full')} />
              Everything left ({money(position.creditable)})
            </label>
          </fieldset>
          {mode === 'amount' && (
            <Input
              label="Amount before tax"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              hint={
                previewTax != null
                  ? `Plus ${money(previewTax)} tax, credited at the invoice's rates — ${money(Number(amount) + previewTax)} in all.`
                  : `Up to ${money(position.creditable)} including tax.`
              }
            />
          )}
          <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged in transit, price agreed down…" />
          <div className="flex justify-end gap-2">
            {canIssue && (
              <Button type="button" variant="secondary" disabled={!valid} loading={act.isPending} onClick={() => submit(false)}>
                Save as draft
              </Button>
            )}
            <Button type="submit" disabled={!valid} loading={act.isPending}>
              {canIssue ? 'Issue credit note' : 'Draft for approval'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
