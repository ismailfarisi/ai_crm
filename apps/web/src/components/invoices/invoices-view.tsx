'use client';

import { useState } from 'react';
import { Receipt, DollarSign, CheckCircle, type LucideIcon } from 'lucide-react';
import type { InvoiceDto } from '@saas/shared';
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
import { api } from '@/lib/api/endpoints';

const STAT_TONES = {
  brand: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
} as const;

function Stat({
  label,
  value,
  icon: Icon,
  tone = 'brand',
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: keyof typeof STAT_TONES;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${STAT_TONES[tone]}`}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-ink tracking-tight">{value}</p>
      </div>
    </div>
  );
}

export function InvoicesView() {
  const { invoices, isLoading } = useInvoices();
  const { data: accounts = [] } = useFinanceAccounts();
  const recordPayment = useRecordInvoicePayment();
  const sendInvoice = useSendInvoice();
  const voidInvoice = useVoidInvoice();
  const downloadPdf = useDownloadInvoicePdf();

  const [payingInvoice, setPayingInvoice] = useState<InvoiceDto | null>(null);
  const [historyInvoice, setHistoryInvoice] = useState<InvoiceDto | null>(null);
  const [voidingInvoice, setVoidingInvoice] = useState<InvoiceDto | null>(null);
  const [printingInvoice, setPrintingInvoice] = useState<InvoiceDto | null>(null);
  const [creditingId, setCreditingId] = useState<string | null>(null);
  // Looked up from the list so the dialog shows figures refreshed after each action.
  const creditingInvoice = invoices.find((i) => i.id === creditingId) ?? null;
  const [sendingId, setSendingId] = useState<string | null>(null);

  const issuedInvoicesCount = invoices.length;
  const totalIssuedAmount = invoices.reduce((acc, inv) => acc + (inv.amount || 0), 0);
  const paidAmount = invoices.reduce((acc, inv) => acc + (inv.paidAmount || 0), 0);

  const formattedTotalIssued = `$${totalIssuedAmount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const formattedPaidAmount = `$${paidAmount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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
        description="Track issued and paid invoices generated from approved quotes."
      />

      <div className="flex flex-wrap items-center gap-x-12 gap-y-4 py-2">
        <Stat label="Issued Invoices" value={issuedInvoicesCount} icon={Receipt} tone="brand" />
        <Stat label="Total Issued Amount" value={formattedTotalIssued} icon={DollarSign} tone="info" />
        <Stat label="Paid Amount" value={formattedPaidAmount} icon={CheckCircle} tone="success" />
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
            currency: printingInvoice.currency || 'USD',
            organization: {
              name: 'AI CRM Enterprise',
              address: 'Enterprise Cloud & AI Solutions\n100 Tech Boulevard, Suite 500',
              email: 'contact@aicrm.io',
              phone: '+1 (800) 555-0199',
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
              taxes: printingInvoice.taxAmount
                ? [{ rate: 0, label: 'Taxes', amount: Number(printingInvoice.taxAmount) }]
                : undefined,
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
