'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Plus, FileText, Clock, CheckCircle, Banknote, Sparkles, type LucideIcon } from 'lucide-react';
import { formatOrganizationAddress, PERMISSIONS, quoteDocumentTaxes } from '@saas/shared';
import { useQuotes, type Quote } from '@/hooks/use-quotes';
import { useCostingPolicy } from '@/hooks/use-catalog';
import { useSession } from '@/lib/session-context';
import { api } from '@/lib/api/endpoints';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/primitives';
import { QuotesTable } from '@/components/quotes/quotes-table';
import { CreateQuoteModal } from '@/components/quotes/create-quote-modal';
import { QuoteDecisionDialog, type QuoteDecision } from '@/components/quotes/quote-decision-dialog';
import { DocumentPrintModal } from '@/components/documents/document-print-modal';
import { useOrganization } from '@/hooks/use-organization';
import { DataViewContainer } from '@/components/views/data-view-container';
import { KanbanBoard, type KanbanColumnDef } from '@/components/views/kanban-board';
import { toast } from 'sonner';

const STAT_TONES = {
  neutral: 'bg-surface-muted text-ink-muted',
  warning: 'bg-warning-soft text-warning',
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
      <span className={`grid size-9 place-items-center rounded-xl ${STAT_TONES[tone]}`}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div>
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-ink tracking-tight">{value}</p>
        {note && <p className="text-xs text-ink-subtle">{note}</p>}
      </div>
    </div>
  );
}

/**
 * Open means a price is out or about to go out: awaiting approval, or approved
 * and not yet accepted. A draft is not a number anyone has committed to, a
 * rejected quote is dead, an accepted one is already an order, and an old
 * version is counted once, through the revision that replaced it.
 */
export function isOpenQuote(quote: Quote): boolean {
  return (
    (quote.status === 'AWAITING_APPROVAL' || quote.status === 'APPROVED') &&
    !quote.acceptedAt &&
    !quote.supersededAt
  );
}

/**
 * Adds amounts in the base currency only. Quotes in another currency cannot be
 * added to them without a rate, so they are counted and named instead.
 */
export function sumInBaseCurrency(
  quotes: Quote[],
  baseCurrency: string | null | undefined,
): { total: number; otherCurrencies: number } {
  let total = 0;
  let otherCurrencies = 0;
  for (const quote of quotes) {
    if (baseCurrency && quote.currency && quote.currency !== baseCurrency) {
      otherCurrencies += 1;
    } else {
      total += Number(quote.totalAmount) || 0;
    }
  }
  return { total, otherCurrencies };
}

const otherCurrencyNote = (count: number) =>
  count > 0 ? `Plus ${count} ${count === 1 ? 'quote' : 'quotes'} in other currencies` : undefined;

export function QuotesView() {
  const { quotes, isLoading, createQuote, sendSignal, refresh } = useQuotes();
  const { data: orgProfile } = useOrganization();
  const { check } = useSession();
  const canApprove = check({ permission: PERMISSIONS.QUOTE_APPROVE });
  const canSeeCost = check({ permission: PERMISSIONS.QUOTE_VIEW_COST });
  const canUpdate = check({ permission: PERMISSIONS.QUOTE_UPDATE });
  const { policy } = useCostingPolicy();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [printingQuote, setPrintingQuote] = useState<Quote | null>(null);
  const [decision, setDecision] = useState<{ quote: Quote; action: QuoteDecision } | null>(null);
  const [search, setSearch] = useState('');

  const orgName = orgProfile?.name || 'Your Company';
  const orgAddress = orgProfile
    ? formatOrganizationAddress(orgProfile).join(', ') || undefined
    : undefined;
  // Totals across quotes are shown in the company's base currency.
  const baseCurrency = orgProfile?.baseCurrency;

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

  // Every figure follows the search, so the numbers describe the rows shown.
  const awaitingApproval = filteredQuotes.filter((q) => q.status === 'AWAITING_APPROVAL').length;
  const approvedNotAccepted = filteredQuotes.filter(
    (q) => q.status === 'APPROVED' && !q.acceptedAt && !q.supersededAt,
  ).length;
  const openValue = sumInBaseCurrency(filteredQuotes.filter(isOpenQuote), baseCurrency);

  const QUOTE_STAGES: KanbanColumnDef[] = useMemo(() => {
    const calcTotal = (status: string) => {
      const { total, otherCurrencies } = sumInBaseCurrency(
        filteredQuotes.filter((q) => q.status === status),
        baseCurrency,
      );
      const sum = `Total ${formatMoney(total, baseCurrency, { decimals: 0 })}`;
      return otherCurrencies > 0 ? `${sum}, plus ${otherCurrencies} in other currencies` : sum;
    };

    return [
      { key: 'DRAFT', label: 'Draft', summaryTotal: calcTotal('DRAFT') },
      { key: 'AWAITING_APPROVAL', label: 'Awaiting approval', summaryTotal: calcTotal('AWAITING_APPROVAL') },
      { key: 'APPROVED', label: 'Approved', summaryTotal: calcTotal('APPROVED') },
      { key: 'REJECTED', label: 'Rejected', summaryTotal: calcTotal('REJECTED') },
    ];
  }, [filteredQuotes, baseCurrency]);

  const nameOf = (quote: Quote) => quote.quoteNumber || quote.title || 'This quote';

  const submitForApproval = async (quote: Quote) => {
    if (!canUpdate) {
      toast.error('Your role cannot submit quotes for approval.');
      return;
    }
    if (!quote.title?.trim()) {
      toast.error(`Give ${nameOf(quote)} a title before submitting it.`);
      return;
    }
    if (!(Number(quote.subtotalAmount) > 0)) {
      toast.error(`Price at least one line on ${nameOf(quote)} before submitting it.`);
      return;
    }
    try {
      await api.quotes.update(quote.id, { status: 'AWAITING_APPROVAL' });
      await refresh();
      toast.success(`${nameOf(quote)} submitted for approval`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not submit ${nameOf(quote)}`);
    }
  };

  /**
   * A drop is a request, and each one either does the real thing or says why
   * not. Approve and reject open the same confirmation as the table row.
   */
  const handleKanbanMoveStage = async (quoteId: string, nextStageKey: string) => {
    const quote = quotes.find((q) => q.id === quoteId);
    if (!quote) return;
    if (quote.status === nextStageKey) return;

    if (nextStageKey === 'APPROVED' || nextStageKey === 'REJECTED') {
      if (!canApprove) {
        toast.error('Only someone who can approve quotes can approve or reject one.');
        return;
      }
      if (quote.status !== 'AWAITING_APPROVAL') {
        toast.error(
          quote.status === 'DRAFT'
            ? `Submit ${nameOf(quote)} for approval first.`
            : `${nameOf(quote)} has already been decided. Open it to make a revision.`,
        );
        return;
      }
      setDecision({ quote, action: nextStageKey === 'APPROVED' ? 'APPROVE' : 'REJECT' });
      return;
    }

    if (nextStageKey === 'AWAITING_APPROVAL') {
      if (quote.status === 'DRAFT' || quote.status === 'REJECTED') {
        await submitForApproval(quote);
      } else {
        toast.error(`${nameOf(quote)} is approved. Open it to make a revision.`);
      }
      return;
    }

    if (nextStageKey === 'DRAFT') {
      toast.error(`${nameOf(quote)} cannot be moved back to draft from here. Open it to change it.`);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotes"
        description="Every quote from draft to approval. Open value counts only what is out with customers."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="rounded-full px-4 text-xs"
              onClick={() => setIsModalOpen(true)}
            >
              <Sparkles className="size-3.5 mr-1.5 text-ink-muted" aria-hidden />
              Draft with AI
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
        <Stat label="Quotes" value={filteredQuotes.length} icon={FileText} />
        <Stat label="Awaiting approval" value={awaitingApproval} icon={Clock} tone="warning" />
        <Stat label="Approved, not accepted" value={approvedNotAccepted} icon={CheckCircle} tone="success" />
        <Stat
          label="Open value"
          value={formatMoney(openValue.total, baseCurrency)}
          note={otherCurrencyNote(openValue.otherCurrencies)}
          icon={Banknote}
        />
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
                    <span className="font-mono text-xs bg-surface-muted px-1.5 py-0.5 rounded text-ink-muted">
                      {q.quoteNumber || 'DRAFT'}
                    </span>
                    <span className="text-xs font-semibold text-ink">
                      {formatMoney(Number(q.totalAmount || 0), q.currency)}
                    </span>
                  </div>
                  <Link
                    href={`/quotes/${q.id}`}
                    className="font-medium text-xs text-ink hover:underline underline-offset-2 line-clamp-1"
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
              onDecide={canApprove ? (quote, action) => setDecision({ quote, action }) : undefined}
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

      <QuoteDecisionDialog
        quote={decision?.quote ?? null}
        action={decision?.action ?? null}
        onClose={() => setDecision(null)}
        onConfirm={(quote, action) => sendSignal(quote.id, action)}
        canSeeCost={canSeeCost}
        policy={policy}
      />

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
            currency: printingQuote.currency || baseCurrency || '',
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
              taxes: quoteDocumentTaxes(
                printingQuote.items,
                Number(printingQuote.taxAmount || 0),
              ),
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
