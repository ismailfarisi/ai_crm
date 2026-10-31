'use client';

import { useState } from 'react';
import { Receipt, Banknote, CheckCircle, type LucideIcon } from 'lucide-react';
import { formatOrganizationAddress, quoteDocumentTaxes, type InvoiceDto } from '@saas/shared';
import {
  useDownloadInvoicePdf,
  useInvoices,
  useRecordInvoicePayment,
  useSendInvoice,
  useVoidInvoice,
} from '@/hooks/use-invoices';
import { useFinanceAccounts } from '@/hooks/use-finance';
import { PageHeader } from '@/components/ui/primitives';
import { InvoicesTable } from '@/components/invoices/invoices-table';
import { RecordPaymentModal } from '@/components/invoices/record-payment-modal';
import { InvoicePaymentsModal } from '@/components/invoices/invoice-payments-modal';
import { VoidInvoiceModal } from '@/components/invoices/void-invoice-modal';
import { InvoiceCreditsDialog } from '@/components/credits/invoice-credits-dialog';
import { DocumentPrintModal } from '@/components/documents/document-print-modal';
import { useOrganization } from '@/hooks/use-organization';
import { api } from '@/lib/api/endpoints';
import { formatMoney } from '@/lib/utils';

const STAT_TONES = {
  neutral: 'bg-surface-muted text-ink-muted',
  success: 'bg-success-soft text-success',
} as const;

function Stat({
  label,
  value,
  note,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  /** What the figure leaves out, said under it rather than hidden. */
  note?: string;
  icon: LucideIcon;
  tone?: keyof typeof STAT_TONES;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${STAT_TONES[tone]}`}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div>
        <p className="text-xs font-semibold text-ink-muted">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-ink tracking-tight">{value}</p>
        {note && <p className="text-xs text-ink-subtle">{note}</p>}
      </div>
    </div>
  );
}

/**
 * What the invoices add up to. A voided invoice bills nothing, so it is left
 * out; one in another currency cannot be added without a rate, so it is
 * counted and named instead of being summed as if it were the base currency.
 */
export function summariseInvoices(invoices: InvoiceDto[], baseCurrency: string | null | undefined) {
  const live = invoices.filter((inv) => inv.status !== 'CANCELLED');
  const inBase = live.filter((inv) => !baseCurrency || !inv.currency || inv.currency === baseCurrency);
  return {
    liveCount: live.length,
    voidedCount: invoices.length - live.length,
    issued: inBase.reduce((acc, inv) => acc + (Number(inv.amount) || 0), 0),
    paid: inBase.reduce((acc, inv) => acc + (Number(inv.paidAmount) || 0), 0),
    otherCurrencies: live.length - inBase.length,
  };
}

export function InvoicesView() {
  const { invoices, isLoading } = useInvoices();
  const { data: orgProfile } = useOrganization();
  const { data: accounts = [] } = useFinanceAccounts();
  const recordPayment = useRecordInvoicePayment();
  const sendInvoice = useSendInvoice();
  const voidInvoice = useVoidInvoice();
  const downloadPdf = useDownloadInvoicePdf();

  const orgName = orgProfile?.name || 'Your Company';
  const orgAddress = orgProfile
    ? formatOrganizationAddress(orgProfile).join(', ') || undefined
    : undefined;
  // Totals across invoices are shown in the company's base currency.
  const baseCurrency = orgProfile?.baseCurrency;

  const [payingInvoice, setPayingInvoice] = useState<InvoiceDto | null>(null);
  const [historyInvoice, setHistoryInvoice] = useState<InvoiceDto | null>(null);
  const [voidingInvoice, setVoidingInvoice] = useState<InvoiceDto | null>(null);
  const [printingInvoice, setPrintingInvoice] = useState<InvoiceDto | null>(null);
  const [creditingId, setCreditingId] = useState<string | null>(null);
  // Looked up from the list so the dialog shows figures refreshed after each action.
  const creditingInvoice = invoices.find((i) => i.id === creditingId) ?? null;
  const [sendingId, setSendingId] = useState<string | null>(null);

  const summary = summariseInvoices(invoices, baseCurrency);
  const otherCurrencyNote =
    summary.otherCurrencies > 0
      ? `Plus ${summary.otherCurrencies} in other currencies`
      : undefined;

  const handleSend = async (invoice: InvoiceDto) => {
    setSendingId(invoice.id);
    try {
      await sendInvoice.mutateAsync(invoice.id);
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Invoices raised from sales orders, once customers accept their quotes."
      />

      <div className="flex flex-wrap items-center gap-x-12 gap-y-4 py-2">
        <Stat
          label="Invoices"
          value={summary.liveCount}
          note={summary.voidedCount > 0 ? `${summary.voidedCount} voided, not counted` : undefined}
          icon={Receipt}
        />
        <Stat
          label="Invoiced"
          value={formatMoney(summary.issued, baseCurrency)}
          note={otherCurrencyNote}
          icon={Banknote}
        />
        <Stat
          label="Paid"
          value={formatMoney(summary.paid, baseCurrency)}
          note={otherCurrencyNote}
          icon={CheckCircle}
          tone="success"
        />
      </div>

      <InvoicesTable
        invoices={invoices}
        isLoading={isLoading}
        onRecordPayment={setPayingInvoice}
        onSend={handleSend}
        onDownload={downloadPdf}
        onPrint={setPrintingInvoice}
        onViewHistory={setHistoryInvoice}
        onVoid={setVoidingInvoice}
        onCredit={(invoice) => setCreditingId(invoice.id)}
        sendingId={sendingId}
      />

      <RecordPaymentModal
        open={payingInvoice !== null}
        onClose={() => setPayingInvoice(null)}
        invoice={payingInvoice}
        accounts={accounts}
        isLoading={recordPayment.isPending}
        onSubmit={async (payload) => {
          if (!payingInvoice) return;
          await recordPayment.mutateAsync({ id: payingInvoice.id, payload });
        }}
      />

      <InvoicePaymentsModal
        open={historyInvoice !== null}
        onClose={() => setHistoryInvoice(null)}
        invoice={historyInvoice}
      />

      <InvoiceCreditsDialog invoice={creditingInvoice} onClose={() => setCreditingId(null)} />

      <VoidInvoiceModal
        open={voidingInvoice !== null}
        onClose={() => setVoidingInvoice(null)}
        invoice={voidingInvoice}
        isLoading={voidInvoice.isPending}
        onSubmit={async (payload) => {
          if (!voidingInvoice) return;
          await voidInvoice.mutateAsync({ id: voidingInvoice.id, payload });
        }}
      />

      {printingInvoice && (
        <DocumentPrintModal
          open={printingInvoice !== null}
          onClose={() => setPrintingInvoice(null)}
          documentType="INVOICE"
          data={{
            type: 'INVOICE',
            number: printingInvoice.invoiceNumber,
            status: printingInvoice.status,
            issuedAt: printingInvoice.issuedAt,
            dueDate: printingInvoice.dueDate || undefined,
            currency: printingInvoice.currency || baseCurrency || '',
            organization: {
              name: orgName,
              address: orgAddress,
              email: orgProfile?.email || undefined,
              phone: orgProfile?.phone || undefined,
              taxId: orgProfile?.taxId || undefined,
              website: orgProfile?.website || undefined,
              logoUrl: orgProfile?.logoUrl || undefined,
            },
            party: {
              name: printingInvoice.customerName || 'Customer',
              email: printingInvoice.customerEmail || undefined,
            },
            items: (printingInvoice.items || []).map((it) => ({
              code: (it as any).sku || (it as any).code || undefined,
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
              subtotal: Number(printingInvoice.subtotalAmount || printingInvoice.amount || 0),
              discounts: Number(printingInvoice.discountAmount || 0),
              taxes: quoteDocumentTaxes(
                printingInvoice.items,
                Number(printingInvoice.taxAmount || 0),
              ),
              total: Number(printingInvoice.amount || 0),
              amountPaid: Number(printingInvoice.paidAmount || 0),
              balanceDue: Math.max(
                0,
                Number(printingInvoice.amount || 0) - Number(printingInvoice.paidAmount || 0),
              ),
            },
            paymentTerms: printingInvoice.paymentTerms || undefined,
            notes: printingInvoice.notes || undefined,
          }}
          documentId={printingInvoice.id}
          downloadPdfFn={api.invoices.downloadPdf}
        />
      )}
    </div>
  );
}
