'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Plus, FileText, Clock, CheckCircle, DollarSign, Sparkles, type LucideIcon } from 'lucide-react';
import { useQuotes, type Quote } from '@/hooks/use-quotes';
import { api } from '@/lib/api/endpoints';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/primitives';
import { QuotesTable } from '@/components/quotes/quotes-table';
import { CreateQuoteModal } from '@/components/quotes/create-quote-modal';
import { DocumentPrintModal } from '@/components/documents/document-print-modal';
import { useOrganization } from '@/hooks/use-organization';
import { DataViewContainer } from '@/components/views/data-view-container';
import { KanbanBoard, type KanbanColumnDef } from '@/components/views/kanban-board';
import { toast } from 'sonner';

const STAT_TONES = {
  brand: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400',
  success: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400',
  info: 'bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400',
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
      <span className={`grid size-9 place-items-center rounded-xl ${STAT_TONES[tone]}`}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-ink tracking-tight">{value}</p>
      </div>
    </div>
  );
}

export function QuotesView() {
  const { quotes, isLoading, createQuote, sendSignal } = useQuotes();
  const { data: orgProfile } = useOrganization();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [printingQuote, setPrintingQuote] = useState<Quote | null>(null);
  const [confirmApproveQuote, setConfirmApproveQuote] = useState<Quote | null>(null);
  const [search, setSearch] = useState('');

  const orgName = orgProfile?.name || 'Your Company';
  const orgAddress = [
    orgProfile?.addressLine1,
    orgProfile?.addressLine2,
    [orgProfile?.city, orgProfile?.region, orgProfile?.postalCode].filter(Boolean).join(' '),
    orgProfile?.country,
  ].filter(Boolean).join(', ') || undefined;

  const totalQuotes = quotes.length;
  const awaitingApproval = quotes.filter((q) => q.status === 'AWAITING_APPROVAL').length;
  const approved = quotes.filter((q) => q.status === 'APPROVED').length;
  const totalValue = quotes.reduce((acc, q) => acc + (Number(q.totalAmount) || 0), 0);

  const formattedTotalValue = `$${totalValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const filteredQuotes = useMemo(() => {
    if (!search.trim()) return quotes;
    const q = search.toLowerCase();
    return quotes.filter(
      (item) =>
        item.title?.toLowerCase().includes(q) ||
        item.quoteNumber?.toLowerCase().includes(q) ||
        item.customerName?.toLowerCase().includes(q),
    );
  }, [quotes, search]);

  const QUOTE_STAGES: KanbanColumnDef[] = useMemo(() => {
    const calcTotal = (status: string) => {
      const sum = quotes
        .filter((q) => q.status === status)
        .reduce((acc, q) => acc + (Number(q.totalAmount) || 0), 0);
      return `$${sum.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    };

    return [
      { key: 'DRAFT', label: 'Quotation (Draft)', summaryTotal: `Total: ${calcTotal('DRAFT')}` },
      { key: 'AWAITING_APPROVAL', label: 'Awaiting Approval', summaryTotal: `Total: ${calcTotal('AWAITING_APPROVAL')}` },
      { key: 'APPROVED', label: 'Confirmed', summaryTotal: `Total: ${calcTotal('APPROVED')}` },
      { key: 'REJECTED', label: 'Rejected', summaryTotal: `Total: ${calcTotal('REJECTED')}` },
    ];
  }, [quotes]);

  const handleKanbanMoveStage = async (quoteId: string, nextStageKey: string) => {
    const quote = quotes.find((q) => q.id === quoteId);
    if (!quote) return;
    if (quote.status === nextStageKey) return;

    if (nextStageKey === 'APPROVED') {
      setConfirmApproveQuote(quote);
      return;
    }

    if (nextStageKey === 'REJECTED') {
      await sendSignal(quote.id, 'REJECT');
      toast.success(`Quote ${quote.quoteNumber || quote.title} rejected`);
      return;
    }

    if (nextStageKey === 'AWAITING_APPROVAL' && quote.status === 'DRAFT') {
      toast.info(`Quote ${quote.quoteNumber || quote.title} submitted for approval`);
      return;
    }

    if (quote.status === 'APPROVED' && nextStageKey === 'DRAFT') {
      toast.error('Approved quotes cannot be reverted to draft');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotes & Workflow Orchestration"
        description="Manage AI-generated and human quotes with automated approval workflows."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="rounded-full px-4 text-xs"
              onClick={() => setIsModalOpen(true)}
            >
              <Sparkles className="size-3.5 mr-1.5 text-brand" />
              Quick AI Modal
            </Button>
            <Link href="/quotes/new">
              <Button variant="primary" className="rounded-full px-5 text-xs font-semibold">
                <Plus className="size-3.5 mr-1.5" />
                New Quotation
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-12 gap-y-4 py-2">
        <Stat label="Total Quotes" value={totalQuotes} icon={FileText} tone="brand" />
        <Stat label="Awaiting Approval" value={awaitingApproval} icon={Clock} tone="warning" />
        <Stat label="Approved" value={approved} icon={CheckCircle} tone="success" />
        <Stat label="Total Value" value={formattedTotalValue} icon={DollarSign} tone="info" />
      </div>

      <DataViewContainer
        entityType="quotes"
        search={search}
        onSearchChange={setSearch}
      >
        {({ viewType }) =>
          viewType === 'kanban' ? (
            <KanbanBoard<Quote>
              columns={QUOTE_STAGES}
              items={filteredQuotes}
              getItemId={(q) => q.id}
              getStageKey={(q) => q.status}
              onMoveStage={handleKanbanMoveStage}
              renderCard={(q) => (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] bg-surface-muted px-1.5 py-0.5 rounded text-ink-muted">
                      {q.quoteNumber || 'DRAFT'}
                    </span>
                    <span className="text-xs font-semibold text-ink">
                      ${Number(q.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <Link
                    href={`/quotes/${q.id}`}
                    className="font-medium text-xs text-ink hover:text-brand line-clamp-1"
                  >
                    {q.title}
                  </Link>
                  <span className="text-[11px] text-ink-muted line-clamp-1">
                    {q.customerName || 'No customer'}
                  </span>
                </div>
              )}
            />
          ) : (
            <QuotesTable
              quotes={filteredQuotes}
              isLoading={isLoading}
              onSignal={async (id, action) => {
                await sendSignal(id, action);
              }}
              onPrint={setPrintingQuote}
            />
          )
        }
      </DataViewContainer>

      <CreateQuoteModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={async (payload) => {
          await createQuote(payload);
        }}
      />

      {confirmApproveQuote && (
        <Dialog
          open={Boolean(confirmApproveQuote)}
          onClose={() => setConfirmApproveQuote(null)}
          title="Confirm Quote Approval"
          description={`Approve quote ${confirmApproveQuote.quoteNumber || confirmApproveQuote.title} for $${Number(confirmApproveQuote.totalAmount || 0).toLocaleString()}? This locks pricing and enables production execution.`}
        >
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setConfirmApproveQuote(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                await sendSignal(confirmApproveQuote.id, 'APPROVE');
                toast.success(`Quote ${confirmApproveQuote.quoteNumber || confirmApproveQuote.title} approved`);
                setConfirmApproveQuote(null);
              }}
            >
              Approve Quote
            </Button>
          </div>
        </Dialog>
      )}

      {printingQuote && (
        <DocumentPrintModal
          open={true}
          onClose={() => setPrintingQuote(null)}
          documentType="QUOTE"
          data={{
            type: 'QUOTE',
            number: printingQuote.quoteNumber || `QUO-${printingQuote.id.slice(0, 8).toUpperCase()}`,
            issuedAt: (printingQuote as any).createdAt || new Date(),
            validUntil: printingQuote.validUntil ? new Date(printingQuote.validUntil) : undefined,
            currency: printingQuote.currency || 'USD',
            status: printingQuote.status,
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
              name: printingQuote.customerName || 'Valued Customer',
              email: printingQuote.customerEmail || undefined,
            },
            items: (printingQuote.items || []).map((it) => ({
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
              subtotal: Number(printingQuote.subtotalAmount || printingQuote.totalAmount || 0),
              discounts: Number(printingQuote.discountAmount || 0),
              taxes: printingQuote.taxAmount
                ? [{ rate: 0, label: 'Taxes', amount: Number(printingQuote.taxAmount) }]
                : undefined,
              total: Number(printingQuote.totalAmount || 0),
            },
            paymentTerms: printingQuote.paymentTerms || undefined,
            notes:
              [printingQuote.notes, printingQuote.termsAndConditions]
                .filter(Boolean)
                .join('\n\n') || undefined,
          }}
          documentId={printingQuote.id}
          downloadPdfFn={api.quotes.downloadPdf}
        />
      )}
    </div>
  );
}
