'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Copy, GitBranch, Link2, PackageCheck, Send, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSIONS, type QuoteStatus, type QuoteTotals } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { useQuoteSalesOrder } from '@/hooks/use-sales-orders';
import { useCan } from '@/lib/session-context';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { formatCurrency } from './quote-lines-table';
import { MarginBadge } from './quote-margin-card';
import { formatDate } from './format';
import type { MarginStatus } from './margin-status';

export type CustomerDialog = 'send' | 'accept' | null;

interface QuoteCustomerPanelProps {
  quoteId: string;
  status: QuoteStatus;
  acceptedAt: string | null;
  acceptedByName: string | null;
  supersededAt: string | null;
  version: number;
  /** What the customer would receive, shown before anything is sent. */
  summary: {
    quoteNumber: string;
    customerName: string;
    customerEmail: string | null;
    validUntil: string | null;
    currency: string;
    totals: QuoteTotals;
    margin: MarginStatus;
    lineCount: number;
  };
  /** Edits on screen that the customer would not get, because only the saved quote is sent. */
  hasUnsavedChanges: boolean;
  /** Called once the customer's acceptance is on record, however it arrived. */
  onAccepted: (acceptedAt: string, acceptedByName: string) => void;
  /** The open dialog, held by the page so the phone's bottom bar can open "send" too. */
  dialog: CustomerDialog;
  onDialogChange: (dialog: CustomerDialog) => void;
  /** On a phone, Send lives in the bottom bar under the thumb instead. */
  hideSendButton?: boolean;
}

/**
 * Everything that happens with the customer once the quote is approved:
 * sending it, recording their acceptance — which raises the sales order — and
 * revising it if they want changes first.
 *
 * This is also where the quote says what state it is in, once, rather than in
 * a banner above it as well. Nothing here shows before approval: every quote
 * is signed off before a customer sees it.
 */
export function QuoteCustomerPanel({
  quoteId,
  status,
  acceptedAt,
  acceptedByName,
  supersededAt,
  version,
  summary,
  hasUnsavedChanges,
  onAccepted,
  dialog,
  onDialogChange,
  hideSendButton = false,
}: QuoteCustomerPanelProps) {
  const router = useRouter();
  const canSeeCost = useCan({ permission: PERMISSIONS.QUOTE_VIEW_COST });
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<'link' | 'send' | 'revise' | 'accept' | 'order' | null>(null);
  const [acceptName, setAcceptName] = useState('');
  const approved = status === 'APPROVED';
  const { data: orderResult, refetch: refetchOrder } = useQuoteSalesOrder(
    quoteId,
    approved || Boolean(acceptedAt),
  );
  const order = orderResult?.order ?? null;
  const closeDialog = () => onDialogChange(null);

  const createLink = async () => {
    setBusy('link');
    try {
      const created = await api.quoteAcceptance.createLink(quoteId);
      setLink(created);
      try {
        await navigator.clipboard.writeText(created.url);
        toast.success('Acceptance link copied. Any earlier link no longer works.');
      } catch {
        toast.success('Acceptance link created');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the link');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Issues the link and emails it, which is what "send the quote" has always
   * meant. Until now the only route was *Get acceptance link*, which copied a
   * URL for the sender to paste into their own mail client — on a product
   * that already has a mail provider and the customer's address on the quote.
   */
  const sendToCustomer = async () => {
    setBusy('send');
    try {
      const sent = await api.quoteAcceptance.send(quoteId);
      setLink({ url: sent.url, expiresAt: sent.expiresAt });
      closeDialog();
      toast.success(`Quote sent to ${sent.sentTo}. Any earlier link no longer works.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the quote');
    } finally {
      setBusy(null);
    }
  };

  const markAccepted = async () => {
    setBusy('accept');
    try {
      const updated = await api.quoteAcceptance.markAccepted(quoteId, { name: acceptName.trim() });
      closeDialog();
      onAccepted(updated.acceptedAt ?? new Date().toISOString(), updated.acceptedByName ?? acceptName.trim());
      await refetchOrder();
      toast.success('Acceptance recorded. The sales order is raised.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record the acceptance');
    } finally {
      setBusy(null);
    }
  };

  /**
   * The acceptance stands even when raising its order fails (a missing
   * exchange rate, say). Approving again raises whatever order is missing,
   * and does nothing when it already exists.
   */
  const raiseOrder = async () => {
    setBusy('order');
    try {
      await api.quotes.signal(quoteId, { action: 'APPROVE' });
      const { data } = await refetchOrder();
      if (data?.order) toast.success(`Order ${data.order.orderNumber} raised`);
      else toast.error('The order still could not be raised.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not raise the order');
    } finally {
      setBusy(null);
    }
  };

  const revise = async () => {
    setBusy('revise');
    try {
      const revision = await api.quoteAcceptance.revise(quoteId);
      toast.success(`Version ${revision.version ?? version + 1} created as a draft`);
      router.push(`/quotes/${revision.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revise the quote');
    } finally {
      setBusy(null);
    }
  };

  if (supersededAt) {
    return (
      <div className="rounded-2xl border border-border/60 bg-surface-muted px-4 py-3 text-sm text-ink-muted">
        This is version {version}. It was replaced by a newer revision on {formatDate(supersededAt)} and
        can no longer be accepted or approved.
      </div>
    );
  }

  if (!approved && !acceptedAt) return null;

  /*
   * An order can exist without an acceptance on record: quotes approved before
   * the order moved to acceptance had theirs raised on approval. Either way the
   * customer has nothing left to do, so neither does this panel.
   */
  const awaitingCustomer = approved && !acceptedAt && !order;
  const acceptedLine = acceptedAt ? (
    <>
      Accepted by <strong className="font-semibold">{acceptedByName}</strong> on {formatDate(acceptedAt)}.
    </>
  ) : null;

  const state = order
    ? {
        tone: 'success' as const,
        title: 'Order raised',
        body: (
          <>
            {acceptedLine ?? 'Its sales order was raised when it was approved.'} The quote is locked; its sales
            order holds the billing from here.
          </>
        ),
      }
    : acceptedAt
      ? {
          tone: 'warning' as const,
          title: 'Accepted',
          body: <>{acceptedLine} The sales order wasn&apos;t raised. Fix what stopped it, then raise it here.</>,
        }
      : {
          tone: 'success' as const,
          title: 'Approved',
          body: (
            <>
              {version > 1 ? `Version ${version}. ` : ''}The price is signed off and locked. Send it to the
              customer; their acceptance raises the sales order.
            </>
          ),
        };
  const StateIcon = state.tone === 'warning' ? AlertTriangle : CheckCircle2;

  return (
    <section
      className="space-y-3 rounded-2xl border border-border/60 bg-surface px-4 py-3 shadow-2xs"
      aria-label="Customer"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5 text-sm">
          <StateIcon
            className={state.tone === 'warning' ? 'mt-0.5 size-5 shrink-0 text-warning' : 'mt-0.5 size-5 shrink-0 text-success'}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="font-semibold text-ink">{state.title}</p>
            <p className="text-xs text-pretty text-ink-muted">{state.body}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {order && (
            <Link
              href={`/orders/${order.id}`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-ink underline-offset-4 hover:underline"
            >
              <PackageCheck className="size-4" aria-hidden />
              {order.orderNumber}
            </Link>
          )}
          {awaitingCustomer && (
            <Can permission={PERMISSIONS.QUOTE_UPDATE}>
              {!hideSendButton && (
                <Button
                  type="button"
                  variant="primary"
                  loading={busy === 'send'}
                  disabled={busy !== null || hasUnsavedChanges}
                  onClick={() => onDialogChange('send')}
                  aria-describedby={hasUnsavedChanges ? 'quote-send-blocker' : undefined}
                >
                  <Send className="size-4" aria-hidden />
                  Send to customer
                </Button>
              )}
              {/* Still here for anyone who would rather send it their own way. */}
              <Button
                type="button"
                variant="outline"
                loading={busy === 'link'}
                disabled={busy !== null || hasUnsavedChanges}
                onClick={createLink}
              >
                <Link2 className="size-4" aria-hidden />
                {link ? 'New link' : 'Copy link'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => onDialogChange('accept')}
              >
                <UserCheck className="size-4" aria-hidden />
                Mark as accepted
              </Button>
            </Can>
          )}
          {acceptedAt && !order && (
            <Can permission={PERMISSIONS.QUOTE_APPROVE}>
              <Button
                type="button"
                variant="primary"
                loading={busy === 'order'}
                disabled={busy !== null}
                onClick={raiseOrder}
              >
                <PackageCheck className="size-4" aria-hidden />
                Raise the order
              </Button>
            </Can>
          )}
          {/* Before there is an order, a customer who wants changes gets a new version. */}
          {awaitingCustomer && (
            <Can permission={PERMISSIONS.QUOTE_CREATE}>
              <Button
                type="button"
                variant="ghost"
                loading={busy === 'revise'}
                disabled={busy !== null}
                onClick={revise}
              >
                <GitBranch className="size-4" aria-hidden />
                Revise
              </Button>
            </Can>
          )}
        </div>
      </div>

      {link && (
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(link.url).then(() => toast.success('Copied'))}
          className="inline-flex max-w-full items-center gap-1 truncate rounded bg-surface-sunk px-2 py-0.5 font-mono text-xs text-ink-muted hover:text-ink"
          title={`Expires ${formatDate(link.expiresAt)}`}
          aria-label="Copy the acceptance link"
        >
          <Copy className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{link.url}</span>
        </button>
      )}

      {awaitingCustomer && hasUnsavedChanges && (
        <p id="quote-send-blocker" className="text-xs text-ink-muted">
          Save your changes first. Only the saved quote is sent.
        </p>
      )}

      <Dialog
        open={dialog === 'send'}
        onClose={closeDialog}
        title={`Send ${summary.quoteNumber || 'this quote'} to ${summary.customerName || 'the customer'}?`}
        description="They get an email with a link to review and accept it online. Any earlier link stops working."
        size="sm"
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={busy === 'send'}
              disabled={!summary.customerEmail}
              onClick={sendToCustomer}
            >
              <Send className="size-4" aria-hidden />
              Send quote
            </Button>
          </>
        }
      >
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">To</dt>
            <dd className="min-w-0 truncate text-end font-medium text-ink">
              {summary.customerEmail ?? (
                <span className="text-danger">No email on the quote. Revise it to add one.</span>
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Total</dt>
            <dd className="font-semibold tabular-nums text-ink">
              {formatCurrency(summary.totals.totalAmount, summary.currency)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Valid until</dt>
            <dd className="text-end tabular-nums text-ink">
              {summary.validUntil ? (
                formatDate(summary.validUntil)
              ) : (
                <span className="text-warning">No date. The customer sees no expiry.</span>
              )}
            </dd>
          </div>
          {canSeeCost && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-ink-muted">Margin</dt>
              <dd>
                <MarginBadge totals={summary.totals} status={summary.margin} />
              </dd>
            </div>
          )}
        </dl>
      </Dialog>

      <Dialog
        open={dialog === 'accept'}
        onClose={closeDialog}
        title={`Record that ${summary.customerName || 'the customer'} accepted?`}
        description="For a yes that came another way: a signed copy, a purchase order or a call. This raises the sales order."
        size="sm"
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={busy === 'accept'}
              disabled={acceptName.trim().length < 2}
              onClick={markAccepted}
            >
              <UserCheck className="size-4" aria-hidden />
              Record acceptance
            </Button>
          </>
        }
      >
        {/* What the order will be raised for, before it is. */}
        <dl className="mb-4 space-y-2 rounded-xl bg-surface-muted px-3 py-2.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Quote</dt>
            <dd className="text-end font-medium text-ink">
              {summary.quoteNumber || 'This quote'} · {summary.lineCount}{' '}
              {summary.lineCount === 1 ? 'line' : 'lines'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Order total</dt>
            <dd className="font-semibold tabular-nums text-ink">
              {formatCurrency(summary.totals.totalAmount, summary.currency)}
            </dd>
          </div>
        </dl>
        <Input
          label="Who accepted it?"
          hint="As they signed or said it, e.g. Fatima Al Noor, by purchase order 4471."
          value={acceptName}
          onChange={(event) => setAcceptName(event.target.value)}
          required
        />
      </Dialog>
    </section>
  );
}
