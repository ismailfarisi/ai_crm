'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import type { PublicInvoiceDto } from '@saas/shared';
import { PayButton } from './pay-button';
import { money, publicCall } from './public-fetch';
import { formatDate } from '@/lib/utils';
import { formatPaymentTerms } from '@saas/shared';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; invoice: PublicInvoiceDto }
  | { kind: 'refused'; message: string };

/** The customer's view of an invoice from its pay link. */
export function PublicInvoiceView({ token, justPaid }: { token: string; justPaid: boolean }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let ignore = false;
    const load = (attempt: number) =>
      publicCall<PublicInvoiceDto>(`payments/invoices/${encodeURIComponent(token)}`)
        .then((invoice) => {
          if (ignore) return;
          setState({ kind: 'ready', invoice });
          // Back from checkout, the provider's confirmation can trail by a few seconds.
          if (justPaid && invoice.balanceDue > 0 && attempt < 5) {
            setTimeout(() => void load(attempt + 1), 2000);
          }
        })
        .catch((err: Error) => !ignore && setState({ kind: 'refused', message: err.message }));
    void load(0);
    return () => {
      ignore = true;
    };
  }, [token, justPaid]);

  if (state.kind === 'loading') {
    return (
      <main className="grid min-h-screen place-items-center bg-surface-muted">
        <Loader2 className="size-6 animate-spin text-ink-subtle" aria-label="Loading" />
      </main>
    );
  }

  if (state.kind === 'refused') {
    return (
      <main className="grid min-h-screen place-items-center bg-surface-muted px-4">
        <div className="max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
          <CircleAlert className="mx-auto mb-3 size-8 text-ink-subtle" />
          <p className="text-ink">{state.message}</p>
        </div>
      </main>
    );
  }

  const { invoice } = state;
  const paid = invoice.balanceDue <= 0;

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-8 sm:py-12">
      <article className="mx-auto max-w-3xl rounded-2xl border border-line bg-surface shadow-sm">
        <header className="border-b border-line p-6">
          <p className="text-sm text-ink-subtle">{invoice.organizationName}</p>
          {invoice.sellerTaxId && <p className="text-xs text-ink-subtle">TRN {invoice.sellerTaxId}</p>}
          <h1 className="mt-4 text-xl font-semibold text-ink">
            {invoice.stageLabel ? `${invoice.stageLabel} invoice` : 'Tax invoice'} {invoice.invoiceNumber}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            For {invoice.customerName} · Issued {formatDate(invoice.issuedAt)}
            {invoice.dueDate ? ` · Due ${formatDate(invoice.dueDate)}` : ''}
          </p>
          {invoice.paymentTerms && (
            <p className="mt-1 text-sm text-ink-muted">
              Payment terms: {formatPaymentTerms(invoice.paymentTerms)}
            </p>
          )}
        </header>

        {invoice.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-start text-xs text-ink-subtle">
                <tr>
                  <th className="px-6 py-2 text-start font-medium">Item</th>
                  <th className="px-3 py-2 text-end font-medium">Qty</th>
                  <th className="px-3 py-2 text-end font-medium">Unit price</th>
                  <th className="px-6 py-2 text-end font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoice.items.map((item, index) => (
                  <tr key={index}>
                    <td className="px-6 py-2 text-ink">{item.description}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{item.quantity}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{money(item.unitPrice, invoice.currency)}</td>
                    <td className="px-6 py-2 text-end tabular-nums">{money(item.subtotal, invoice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <dl className="ms-auto max-w-xs space-y-1 p-6 text-sm">
          {/* The subtotal is already net of discount: the discount comes off above it. */}
          {invoice.discountAmount > 0 && (
            <>
              <Row label="Lines" value={money(invoice.subtotalAmount + invoice.discountAmount, invoice.currency)} />
              <Row label="Discount" value={`−${money(invoice.discountAmount, invoice.currency)}`} />
            </>
          )}
          <Row label="Subtotal" value={money(invoice.subtotalAmount, invoice.currency)} />
          {invoice.taxAmount > 0 && <Row label="VAT" value={money(invoice.taxAmount, invoice.currency)} />}
          <div className="flex justify-between border-t border-line pt-2 font-semibold text-ink">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(invoice.totalAmount, invoice.currency)}</dd>
          </div>
          {invoice.paidAmount > 0 && <Row label="Paid" value={`−${money(invoice.paidAmount, invoice.currency)}`} />}
          {invoice.creditedAmount > 0 && (
            <Row label="Credited" value={`−${money(invoice.creditedAmount, invoice.currency)}`} />
          )}
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold text-ink">
            <dt>Balance due</dt>
            <dd className="tabular-nums">{money(invoice.balanceDue, invoice.currency)}</dd>
          </div>
        </dl>

        <footer className="border-t border-line p-6">
          {paid ? (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-5" />
              Paid in full. Thank you.
            </p>
          ) : justPaid ? (
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <Loader2 className="size-4 animate-spin" />
              Thank you. Your payment is being confirmed.
            </p>
          ) : invoice.canPayOnline ? (
            <PayButton
              path={`payments/invoices/${encodeURIComponent(token)}/checkout`}
              label={`Pay ${money(invoice.balanceDue, invoice.currency)}`}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              To pay, contact {invoice.organizationName || 'the sender'}
              {invoice.sellerEmail ? ` at ${invoice.sellerEmail}` : ''}.
            </p>
          )}
        </footer>
      </article>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-ink-muted">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
