'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Download,
  Loader2,
  Mail,
  Printer,
  RefreshCw,
  Undo2,
  Wallet,
} from 'lucide-react';
import {
  formatOrganizationAddress,
  formatPaymentTerms,
  invoiceBalanceDue,
  isInvoiceOverdue,
  PERMISSIONS,
  quoteDocumentTaxes,
} from '@saas/shared';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/session-context';
import { formatMoney, formatDate } from '@/lib/utils';
import { invoiceNextStep } from '@/lib/next-step';
import { NextStepCard } from '@/components/documents/next-step-card';
import {
  useDownloadInvoicePdf,
  useInvoice,
  useInvoicePayments,
  useRecordInvoicePayment,
  useReplaceInvoice,
  useSendInvoice,
  useVoidInvoice,
} from '@/hooks/use-invoices';
import { useFinanceAccounts } from '@/hooks/use-finance';
import { useOrganization } from '@/hooks/use-organization';
import { api } from '@/lib/api/endpoints';
import { InvoiceStatusBadge } from './invoices-table';
import { RecordPaymentModal } from './record-payment-modal';
import { ReplaceInvoiceModal } from './replace-invoice-modal';
import { VoidInvoiceModal } from './void-invoice-modal';
import { InvoiceCreditsDialog } from '@/components/credits/invoice-credits-dialog';
import { DocumentPrintModal } from '@/components/documents/document-print-modal';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-ink-subtle">{label}</dt>
      <dd className="text-end text-ink">{children}</dd>
    </div>
  );
}

const fmtDate = (value?: string | null) => formatDate(value);

export function InvoiceDetailPage({ invoiceId }: { invoiceId: string }) {
  const { data: invoice, isLoading, error } = useInvoice(invoiceId);
  const { data: payments = [] } = useInvoicePayments(invoiceId);
  const { data: accounts = [] } = useFinanceAccounts();
  const { data: orgProfile } = useOrganization();
  const router = useRouter();
  const recordPayment = useRecordInvoicePayment();
  const sendInvoice = useSendInvoice();
  const voidInvoice = useVoidInvoice();
  const replaceInvoice = useReplaceInvoice();
  const downloadPdf = useDownloadInvoicePdf();

  const canManage = useCan({ permission: PERMISSIONS.INVOICE_MANAGE });
  const canCredit = useCan({ permission: PERMISSIONS.CREDIT_NOTE_READ });
  const canReadOrders = useCan({ permission: PERMISSIONS.SALES_ORDER_READ });

  const [paying, setPaying] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const [sending, setSending] = useState(false);

  if (isLoading) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="size-6 animate-spin text-ink-subtle" aria-label="Loading" />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <p className="text-ink">This invoice could not be loaded.</p>
        <Link href="/invoices" className="mt-3 inline-block text-sm text-ink-muted underline">
          Back to invoices
        </Link>
      </div>
    );
  }

  const currency = invoice.currency || orgProfile?.baseCurrency || 'AED';
  const paid = Number(invoice.paidAmount ?? 0);
  const balanceDue = invoiceBalanceDue(invoice);
  const isFinal = invoice.status === 'PAID' || invoice.status === 'CANCELLED';
  const taxLines = quoteDocumentTaxes(invoice.items, Number(invoice.taxAmount || 0)) ?? [];
  const orgAddress = orgProfile
    ? formatOrganizationAddress(orgProfile).join(', ') || undefined
    : undefined;

  const nextStep = invoiceNextStep({ ...invoice, currency });
  const stepAction = nextStep.action;
  const stepButton =
    stepAction?.kind === 'send' && canManage ? (
      <Button size="sm" onClick={handleSendNow} loading={sending}>
        <Mail className="size-3.5" aria-hidden />
        Email to customer
      </Button>
    ) : stepAction?.kind === 'payment' && canManage ? (
      <Button size="sm" onClick={() => setPaying(true)}>
        <Wallet className="size-3.5" aria-hidden />
        Record payment
      </Button>
    ) : stepAction?.kind === 'openOrder' && canReadOrders ? (
      <Link
        href={`/orders/${stepAction.orderId}`}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-ink hover:bg-surface-muted"
      >
        Open the sales order
      </Link>
    ) : null;

  async function handleSendNow() {
    await handleSend();
  }

  const handleSend = async () => {
    setSending(true);
    try {
      await sendInvoice.mutateAsync(invoice.id);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        href="/invoices"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to invoices
      </Link>

      <PageHeader
        title={`Invoice ${invoice.invoiceNumber}`}
        description={`${invoice.customerName} · Issued ${fmtDate(invoice.issuedAt)}${
          invoice.dueDate ? ` · Due ${fmtDate(invoice.dueDate)}` : ''
        }`}
        actions={
          <>
            {canManage && !isFinal && (
              <Button size="sm" variant="outline" onClick={() => setPaying(true)}>
                <Wallet className="size-3.5" aria-hidden />
                Record payment
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setPrinting(true)}>
              <Printer className="size-3.5" aria-hidden />
              Preview and print
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadPdf(invoice)}>
              <Download className="size-3.5" aria-hidden />
              PDF
            </Button>
          </>
        }
      />

      <NextStepCard step={nextStep} action={stepButton} />

      <div className="flex items-center gap-2">
        <InvoiceStatusBadge status={invoice.status} />
        {isInvoiceOverdue(invoice) && (
          <Badge tone="danger" className="gap-1">
            <AlertTriangle className="size-3" />
            Overdue
          </Badge>
        )}
        {invoice.stageLabel && <Badge tone="neutral">{invoice.stageLabel}</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="overflow-hidden rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted/60 text-xs text-ink-subtle">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">Item</th>
                  <th className="px-4 py-2.5 text-start font-medium">Description</th>
                  <th className="px-3 py-2.5 text-end font-medium">Unit price</th>
                  <th className="px-3 py-2.5 text-end font-medium">Qty</th>
                  <th className="px-3 py-2.5 text-end font-medium">Tax</th>
                  <th className="px-4 py-2.5 text-end font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(invoice.items || []).map((item, i) =>
                  item.type && item.type !== 'product' ? (
                    <tr key={item.id || i}>
                      <td
                        colSpan={6}
                        className={`px-4 py-2 ${
                          item.type === 'section'
                            ? 'font-semibold text-ink'
                            : 'text-xs italic text-ink-subtle'
                        }`}
                      >
                        {item.description}
                      </td>
                    </tr>
                  ) : (
                    <tr key={item.id || i}>
                      <td className="px-4 py-2.5 align-top font-medium text-ink">
                        {item.sku || item.description}
                      </td>
                      <td className="px-4 py-2.5 align-top whitespace-pre-line text-ink-muted">
                        {item.sku ? item.description : ''}
                      </td>
                      <td className="px-3 py-2.5 align-top text-end tabular-nums text-ink">
                        {formatMoney(Number(item.unitPrice) || 0, currency)}
                      </td>
                      <td className="px-3 py-2.5 align-top text-end tabular-nums text-ink">
                        {Number(item.quantity) || 0}
                      </td>
                      <td className="px-3 py-2.5 align-top text-end tabular-nums text-ink">
                        {Number(item.taxRate) || 0}%
                      </td>
                      <td className="px-4 py-2.5 align-top text-end tabular-nums font-medium text-ink">
                        {formatMoney(
                          item.subtotal != null
                            ? Number(item.subtotal)
                            : (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
                          currency,
                        )}
                      </td>
                    </tr>
                  ),
                )}
                {(invoice.items || []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-ink-subtle">
                      No items on this invoice.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {(invoice.notes || invoice.paymentTerms) && (
            <section className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink">
                {invoice.paymentTerms ? 'Payment terms' : 'Notes'}
              </h2>
              {invoice.paymentTerms && (
                <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">
                  {formatPaymentTerms(invoice.paymentTerms)}
                </p>
              )}
              {invoice.notes && (
                <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">{invoice.notes}</p>
              )}
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Details</h2>
            <dl className="divide-y divide-line/60">
              <Field label="Customer">
                {invoice.customerId ? (
                  <Link href={`/customers/${invoice.customerId}`} className="hover:underline">
                    {invoice.customerName}
                  </Link>
                ) : (
                  invoice.customerName
                )}
              </Field>
              {invoice.customerEmail && <Field label="Email">{invoice.customerEmail}</Field>}
              <Field label="Issued">{fmtDate(invoice.issuedAt)}</Field>
              {invoice.dueDate && <Field label="Due">{fmtDate(invoice.dueDate)}</Field>}
              {invoice.paidAt && <Field label="Paid">{fmtDate(invoice.paidAt)}</Field>}
              {invoice.quoteId && (
                <Field label="Quote">
                  <Link
                    href={`/quotes/${invoice.quoteId}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {invoice.quoteNumber ?? 'View quote'}
                  </Link>
                </Field>
              )}
              {invoice.voidedAt && (
                <Field label="Voided">
                  {fmtDate(invoice.voidedAt)}
                  {invoice.voidReason ? ` — ${invoice.voidReason}` : ''}
                </Field>
              )}
            </dl>
          </section>

          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Totals</h2>
            <dl className="mt-1 space-y-1 text-sm">
              {/*
                The subtotal is already net of discount, so the discount is
                shown coming off the lines' own total, above it. Each row is
                then the sum so far, as on the quote.
              */}
              {Number(invoice.discountAmount) > 0 && (
                <>
                  <div className="flex justify-between text-ink-muted">
                    <dt>Lines</dt>
                    <dd className="tabular-nums">
                      {formatMoney(
                        (Number(invoice.subtotalAmount) || 0) + Number(invoice.discountAmount),
                        currency,
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between text-ink-muted">
                    <dt>Discount</dt>
                    <dd className="tabular-nums">
                      −{formatMoney(Number(invoice.discountAmount), currency)}
                    </dd>
                  </div>
                </>
              )}
              <div className="flex justify-between text-ink-muted">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">
                  {formatMoney(Number(invoice.subtotalAmount) || 0, currency)}
                </dd>
              </div>
              {taxLines.map((line, i) => (
                <div key={i} className="flex justify-between text-ink-muted">
                  <dt>{line.label}</dt>
                  <dd className="tabular-nums">{formatMoney(line.amount, currency)}</dd>
                </div>
              ))}
              {taxLines.length === 0 && Number(invoice.taxAmount) > 0 && (
                <div className="flex justify-between text-ink-muted">
                  <dt>Tax</dt>
                  <dd className="tabular-nums">
                    {formatMoney(Number(invoice.taxAmount), currency)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-2 font-semibold text-ink">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(Number(invoice.amount) || 0, currency)}</dd>
              </div>
              <div className="flex justify-between text-ink-muted">
                <dt>Paid to date</dt>
                <dd className="tabular-nums">{formatMoney(paid, currency)}</dd>
              </div>
              {Number(invoice.creditedAmount) > 0 && (
                <div className="flex justify-between text-ink-muted">
                  <dt>Credited</dt>
                  <dd className="tabular-nums">
                    −{formatMoney(Number(invoice.creditedAmount), currency)}
                  </dd>
                </div>
              )}
              {Number(invoice.refundedAmount) > 0 && (
                <div className="flex justify-between text-ink-muted">
                  <dt>Refunded to the customer</dt>
                  <dd className="tabular-nums">
                    +{formatMoney(Number(invoice.refundedAmount), currency)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold text-ink">
                <dt>Balance due</dt>
                <dd className="tabular-nums">{formatMoney(balanceDue, currency)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Payments</h2>
              {canManage && !isFinal && (
                <Button size="sm" variant="outline" onClick={() => setPaying(true)}>
                  Record
                </Button>
              )}
            </div>
            {payments.length === 0 ? (
              <p className="mt-2 text-sm text-ink-subtle">No payments recorded yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line/60">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink-muted">{fmtDate(p.paidAt)}</span>
                    <span className="tabular-nums font-medium text-ink">
                      {formatMoney(Number(p.amount) || 0, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(canManage || canCredit) && invoice.status !== 'CANCELLED' && (
            <section className="flex flex-wrap gap-2">
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSend}
                  disabled={sending || !invoice.customerEmail}
                  title={invoice.customerEmail ? undefined : 'The customer has no email address'}
                >
                  <Mail className="size-3.5" aria-hidden />
                  {sending ? 'Sending…' : 'Email to customer'}
                </Button>
              )}
              {canCredit && (
                <Button size="sm" variant="outline" onClick={() => setCrediting(true)}>
                  <Undo2 className="size-3.5" aria-hidden />
                  Credit or refund
                </Button>
              )}
              {canManage && !(invoice.creditedAmount ?? 0) && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReplacing(true)}
                    title="Void this invoice and open a draft quote with the same lines to correct and re-issue"
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                    Replace invoice
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setVoiding(true)}
                    className="text-danger"
                  >
                    <Ban className="size-3.5" aria-hidden />
                    Void invoice
                  </Button>
                </>
              )}
            </section>
          )}
        </div>
      </div>

      <RecordPaymentModal
        open={paying}
        onClose={() => setPaying(false)}
        invoice={invoice}
        accounts={accounts}
        isLoading={recordPayment.isPending}
        onSubmit={async (payload) => {
          await recordPayment.mutateAsync({ id: invoice.id, payload });
        }}
      />

      <ReplaceInvoiceModal
        open={replacing}
        onClose={() => setReplacing(false)}
        invoice={invoice}
        isLoading={replaceInvoice.isPending}
        onSubmit={async ({ reason }) => {
          const quote = await replaceInvoice.mutateAsync({ invoice, reason });
          setReplacing(false);
          router.push(`/quotes/${quote.id}`);
        }}
      />

      <VoidInvoiceModal
        open={voiding}
        onClose={() => setVoiding(false)}
        invoice={invoice}
        isLoading={voidInvoice.isPending}
        onSubmit={async (payload) => {
          await voidInvoice.mutateAsync({ id: invoice.id, payload });
        }}
      />

      <InvoiceCreditsDialog invoice={crediting ? invoice : null} onClose={() => setCrediting(false)} />

      {printing && (
        <DocumentPrintModal
          open={printing}
          onClose={() => setPrinting(false)}
          documentType="INVOICE"
          data={{
            type: 'INVOICE',
            number: invoice.invoiceNumber,
            status: invoice.status,
            issuedAt: invoice.issuedAt,
            dueDate: invoice.dueDate || undefined,
            currency,
            organization: {
              name: orgProfile?.name || 'Your Company',
              address: orgAddress,
              email: orgProfile?.email || undefined,
              phone: orgProfile?.phone || undefined,
              taxId: orgProfile?.taxId || undefined,
              website: orgProfile?.website || undefined,
              logoUrl: orgProfile?.logoUrl || undefined,
            },
            party: {
              name: invoice.customerName || 'Customer',
              email: invoice.customerEmail || undefined,
            },
            items: (invoice.items || []).map((it) => ({
              code: it.sku || undefined,
              description: it.description || '',
              quantity: Number(it.quantity) || 1,
              unitPrice: Number(it.unitPrice) || 0,
              discount: Number(it.discount) || 0,
              taxRate: Number(it.taxRate) || 0,
              amount:
                it.subtotal != null
                  ? Number(it.subtotal)
                  : (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0),
            })),
            totals: {
              subtotal: Number(invoice.subtotalAmount || invoice.amount || 0),
              discounts: Number(invoice.discountAmount || 0),
              taxes: quoteDocumentTaxes(invoice.items, Number(invoice.taxAmount || 0)),
              total: Number(invoice.amount || 0),
              amountPaid: paid,
              balanceDue,
            },
            paymentTerms: invoice.paymentTerms || undefined,
            notes: invoice.notes || undefined,
          }}
          documentId={invoice.id}
          downloadPdfFn={api.invoices.downloadPdf}
        />
      )}
    </div>
  );
}
