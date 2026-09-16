'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Sparkles,
  Save,
  Send,
  Printer,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  FileCheck,
  AlertCircle,
  PackagePlus,
} from 'lucide-react';
import type {
  BillingStage,
  QuoteDto,
  QuoteLineItem,
  QuoteStatus,
  QuoteCreatedBy,
  CreateQuotePayload,
  UpdateQuotePayload,
  GuardrailViolation,
} from '@saas/shared';
import { calculateQuoteTotals, evaluateGuardrails } from '@saas/shared';
import { useCostingPolicy } from '@/hooks/use-catalog';
import { useTaxCodes } from '@/hooks/use-credits';
import { api } from '@/lib/api/endpoints';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

import { QuoteStatusPipeline } from '../quote-status-pipeline';
import { QuoteHeaderForm, type QuoteHeaderFormData } from './quote-header-form';
import { QuoteLinesTable } from './quote-lines-table';
import { QuoteTotalsCard } from './quote-totals-card';
import { QuoteTabsSection } from './quote-tabs-section';
import { QuoteAiDrawer, type GeneratedQuoteDraft } from './quote-ai-drawer';
import { QuotePrintModal } from './quote-print-modal';
import { AddLineFlow } from './add-line-flow';
import { QuoteMarginCard } from './quote-margin-card';
import { QuoteBillingCard } from './quote-billing-card';
import { AttachmentsPanel } from '@/components/platform/attachments-panel';
import { ActivityTimeline } from '@/components/platform/activity-timeline';
import { QuoteCustomerPanel } from './quote-customer-panel';

interface QuoteEditorPageProps {
  quoteId?: string;
  initialQuote?: QuoteDto;
  onBack?: () => void;
}

export function QuoteEditorPage({
  quoteId,
  initialQuote,
  onBack,
}: QuoteEditorPageProps) {
  const router = useRouter();

  // Loading & Saving States
  const [isLoading, setIsLoading] = useState(!initialQuote && Boolean(quoteId));
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSignaling, setIsSignaling] = useState<'APPROVE' | 'REJECT' | null>(null);

  // Modals & Drawers
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isAddLineOpen, setIsAddLineOpen] = useState(false);

  // Quote State
  const [id, setId] = useState<string | undefined>(initialQuote?.id || quoteId);
  const [status, setStatus] = useState<QuoteStatus>(initialQuote?.status || 'DRAFT');
  const [createdBy, setCreatedBy] = useState<QuoteCreatedBy>(initialQuote?.createdBy || 'HUMAN');
  const [prompt, setPrompt] = useState<string | null>(initialQuote?.prompt || null);

  const [headerData, setHeaderData] = useState<QuoteHeaderFormData>({
    title: initialQuote?.title || '',
    quoteNumber: initialQuote?.quoteNumber || '',
    customerId: initialQuote?.customerId || null,
    customerName: initialQuote?.customerName || '',
    customerEmail: initialQuote?.customerEmail || null,
    validUntil: initialQuote?.validUntil || null,
    paymentTerms: initialQuote?.paymentTerms || 'immediate',
    currency: initialQuote?.currency || 'USD',
  });

  // The rates offered on a line come from the organisation's own sales tax
  // codes, so a code configured under Finance → Tax actually reaches a quote.
  const { data: taxCodes } = useTaxCodes();
  const salesTaxCodes = useMemo(
    () =>
      (taxCodes ?? [])
        .filter((code) => code.isActive && code.kind !== 'PURCHASE')
        .map((code) => ({
          id: code.id,
          code: code.code,
          name: code.name,
          rate: code.rate,
        })),
    [taxCodes],
  );

  const [items, setItems] = useState<QuoteLineItem[]>(initialQuote?.items || [
    {
      id: 'line-1',
      type: 'product',
      description: '',
      quantity: 1,
      uom: 'Units',
      unitPrice: 0,
      discount: 0,
      taxRate: 0,
      subtotal: 0,
    },
  ]);

  const [termsAndConditions, setTermsAndConditions] = useState<string | null>(
    initialQuote?.termsAndConditions ||
      '1. Payment due according to agreed payment terms.\n2. All deliverables are subject to acceptance testing within 14 days of delivery.\n3. Quote is valid for 30 days from issue date.',
  );
  const [notes, setNotes] = useState<string | null>(initialQuote?.notes || null);
  const [billingSchedule, setBillingSchedule] = useState<BillingStage[] | null>(
    initialQuote?.billingSchedule ?? null,
  );
  const [acceptance, setAcceptance] = useState({
    acceptedAt: initialQuote?.acceptedAt ?? null,
    acceptedByName: initialQuote?.acceptedByName ?? null,
    supersededAt: initialQuote?.supersededAt ?? null,
    version: initialQuote?.version ?? 1,
  });

  // Fetch initial quote or next quote number on mount
  useEffect(() => {
    let ignore = false;

    if (quoteId && !initialQuote) {
      setIsLoading(true);
      api.quotes
        .get(quoteId)
        .then((q) => {
          if (!ignore && q) {
            setId(q.id);
            setStatus(q.status);
            setCreatedBy(q.createdBy);
            setPrompt(q.prompt || null);
            setHeaderData({
              title: q.title || '',
              quoteNumber: q.quoteNumber || '',
              customerId: q.customerId || null,
              customerName: q.customerName || '',
              customerEmail: q.customerEmail || null,
              validUntil: q.validUntil || null,
              paymentTerms: q.paymentTerms || 'immediate',
              currency: q.currency || 'USD',
            });
            setItems(q.items?.length ? q.items : []);
            setTermsAndConditions(q.termsAndConditions || null);
            setNotes(q.notes || null);
            setBillingSchedule(q.billingSchedule ?? null);
            setAcceptance({
              acceptedAt: q.acceptedAt ?? null,
              acceptedByName: q.acceptedByName ?? null,
              supersededAt: q.supersededAt ?? null,
              version: q.version ?? 1,
            });
          }
        })
        .catch((err) => {
          if (!ignore) {
            toast.error(err instanceof Error ? err.message : 'Failed to load quote');
          }
        })
        .finally(() => {
          if (!ignore) setIsLoading(false);
        });
    } else if (!quoteId && !initialQuote) {
      // Create mode: fetch next quote number
      api.quotes
        .getNextNumber()
        .then((res) => {
          if (!ignore && res?.nextNumber) {
            setHeaderData((prev) => ({ ...prev, quoteNumber: res.nextNumber }));
          }
        })
        .catch(() => {
          // fallback
        });
    }

    return () => {
      ignore = true;
    };
  }, [quoteId, initialQuote]);

  // Live Totals Calculation
  const totals = useMemo(() => calculateQuoteTotals(items), [items]);

  /**
   * Live guardrail check, using the same pure function the API enforces with.
   * This is a courtesy so the rep sees the problem while they can still fix
   * it — the server re-costs from the catalog and re-checks on approval, and
   * that copy is the one that decides.
   */
  const { policy } = useCostingPolicy();
  const violations = useMemo<GuardrailViolation[]>(
    () => (policy ? evaluateGuardrails(items, totals, policy) : []),
    [items, totals, policy],
  );

  // A superseded version is history; edit the revision instead.
  const isReadOnly = status === 'APPROVED' || Boolean(acceptance.supersededAt);

  // ⌘K / Ctrl-K opens the catalog picker, the way every other palette works.
  useEffect(() => {
    if (isReadOnly) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsAddLineOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isReadOnly]);

  const handleAddLines = useCallback((lines: QuoteLineItem[]) => {
    setItems((prev) => {
      // Drop the empty starter row the editor seeds a new quote with.
      const meaningful = prev.filter(
        (item) => item.type !== 'product' || item.description.trim() || (item.unitPrice ?? 0) > 0,
      );
      return [...meaningful, ...lines];
    });
  }, []);

  // Handle header data updates
  const handleHeaderChange = useCallback((patch: Partial<QuoteHeaderFormData>) => {
    setHeaderData((prev) => ({ ...prev, ...patch }));
  }, []);

  // Handle AI Draft Application
  const handleApplyAiDraft = useCallback((draft: GeneratedQuoteDraft) => {
    if (draft.title) {
      setHeaderData((prev) => ({
        ...prev,
        title: draft.title || prev.title,
        paymentTerms: draft.paymentTerms || prev.paymentTerms,
        currency: draft.currency || prev.currency,
      }));
    }
    setItems(draft.items);
    if (draft.termsAndConditions) {
      setTermsAndConditions(draft.termsAndConditions);
    }
    if (draft.notes) {
      setNotes(draft.notes);
    }
    if (draft.prompt) {
      setPrompt(draft.prompt);
    }
    setCreatedBy('AI');
  }, []);

  // Save Draft
  const handleSaveDraft = async () => {
    if (!headerData.title.trim()) {
      toast.error('Please enter a quotation title');
      return;
    }

    setIsSaving(true);
    try {
      if (id) {
        // Update existing quote
        const payload: UpdateQuotePayload = {
          title: headerData.title.trim(),
          quoteNumber: headerData.quoteNumber,
          customerId: headerData.customerId,
          customerName: headerData.customerName || 'General Customer',
          customerEmail: headerData.customerEmail,
          validUntil: headerData.validUntil,
          paymentTerms: headerData.paymentTerms,
          currency: headerData.currency,
          items,
          subtotalAmount: totals.subtotalAmount,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          termsAndConditions,
          billingSchedule,
          notes,
          prompt,
          createdBy,
        };

        const updated = await api.quotes.update(id, payload);
        setId(updated.id);
        // The server re-prices and re-taxes lines from the customer's address;
        // show what was stored, not what was typed.
        if (updated.items) setItems(updated.items);
        setStatus(updated.status);
        toast.success('Quotation draft updated');
      } else {
        // Create new quote
        const payload: CreateQuotePayload = {
          title: headerData.title.trim(),
          quoteNumber: headerData.quoteNumber,
          customerId: headerData.customerId,
          customerName: headerData.customerName || 'General Customer',
          customerEmail: headerData.customerEmail,
          validUntil: headerData.validUntil,
          paymentTerms: headerData.paymentTerms,
          currency: headerData.currency,
          items,
          subtotalAmount: totals.subtotalAmount,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          termsAndConditions,
          billingSchedule,
          notes,
          prompt,
          createdBy,
        };

        const created = await api.quotes.create(payload);
        setId(created.id);
        setStatus(created.status);
        if (created.items) setItems(created.items);
        toast.success('New quotation created');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save quotation');
    } finally {
      setIsSaving(false);
    }
  };

  // Submit for Approval
  const handleSubmitForApproval = async () => {
    if (!headerData.title.trim()) {
      toast.error('Please enter a quotation title');
      return;
    }

    setIsSubmitting(true);
    try {
      let targetId = id;

      // Save first if newly created or edited
      if (!targetId) {
        const payload: CreateQuotePayload = {
          title: headerData.title.trim(),
          quoteNumber: headerData.quoteNumber,
          customerId: headerData.customerId,
          customerName: headerData.customerName || 'General Customer',
          customerEmail: headerData.customerEmail,
          validUntil: headerData.validUntil,
          paymentTerms: headerData.paymentTerms,
          currency: headerData.currency,
          items,
          subtotalAmount: totals.subtotalAmount,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          termsAndConditions,
          billingSchedule,
          notes,
          prompt,
          createdBy,
        };
        const created = await api.quotes.create(payload);
        targetId = created.id;
        setId(created.id);
      } else {
        await api.quotes.update(targetId, {
          title: headerData.title.trim(),
          quoteNumber: headerData.quoteNumber,
          customerId: headerData.customerId,
          customerName: headerData.customerName || 'General Customer',
          customerEmail: headerData.customerEmail,
          validUntil: headerData.validUntil,
          paymentTerms: headerData.paymentTerms,
          currency: headerData.currency,
          items,
          subtotalAmount: totals.subtotalAmount,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          termsAndConditions,
          billingSchedule,
          notes,
          prompt,
          status: 'AWAITING_APPROVAL',
        });
      }

      // Update status locally
      setStatus('AWAITING_APPROVAL');
      toast.success('Quotation submitted for review & approval');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit quotation');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Approval Signal (Approve / Reject)
  const handleSignal = async (action: 'APPROVE' | 'REJECT') => {
    if (!id) return;
    setIsSignaling(action);
    try {
      const updated = await api.quotes.signal(id, { action });
      setStatus(updated.status);
      toast.success(
        action === 'APPROVE'
          ? 'Quotation confirmed & approved!'
          : 'Quotation rejected for revision',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action.toLowerCase()} quote`);
    } finally {
      setIsSignaling(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <Loader2 className="size-8 animate-spin text-brand" />
        <p className="text-sm font-medium text-ink-muted">Loading quotation details...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      {/* Top Sticky Header & Actions Ribbon */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 border-b border-border/30 bg-surface/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Left: Back button + Title & Pipeline */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => (onBack ? onBack() : router.push('/quotes'))}
              className="flex size-8 items-center justify-center rounded-full border border-border/40 bg-surface/80 text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
              aria-label="Back to Quotes"
            >
              <ArrowLeft className="size-4" />
            </button>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-ink sm:text-xl">
                  {headerData.title || 'New Quotation'}
                </h1>
              </div>
              <p className="text-xs text-ink-muted">
                {headerData.quoteNumber ? `${headerData.quoteNumber} • ` : ''}
                {headerData.customerName || 'Draft'}
              </p>
            </div>

            {/* Visual Status Pipeline */}
            <div className="lg:ml-2">
              <QuoteStatusPipeline status={status} />
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Catalog picker — the primary way to add a priced line */}
            {!isReadOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddLineOpen(true)}
                className="rounded-full px-4 text-xs gap-1.5 shadow-2xs border-border/40 hover:border-border font-semibold"
              >
                <PackagePlus className="size-4 text-ink-subtle" />
                <span>Add from catalog</span>
                <kbd className="ml-1 hidden rounded border border-border/40 px-1 py-0.5 text-[10px] font-medium text-ink-subtle sm:inline">
                  ⌘K
                </kbd>
              </Button>
            )}

            {/* AI Copilot Button */}
            {!isReadOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAiDrawerOpen(true)}
                className="rounded-full px-4 text-xs border-brand/40 bg-brand-soft text-brand-hover hover:bg-brand-soft/80 hover:border-brand gap-1.5 shadow-2xs font-semibold"
              >
                <Sparkles className="size-4 text-brand-hover" />
                <span>AI Copilot ✨</span>
              </Button>
            )}

            {/* Print / Preview */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsPrintModalOpen(true)}
              className="rounded-full px-4 text-xs gap-1.5 shadow-2xs border-border/40 hover:border-border"
            >
              <Printer className="size-4 text-ink-subtle" />
              <span>Preview / Print</span>
            </Button>

            {/* Manager Actions if Awaiting Approval */}
            {status === 'AWAITING_APPROVAL' && (
              <div className="flex items-center gap-2 pl-2 border-l border-border/30">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={isSignaling === 'APPROVE'}
                  disabled={Boolean(isSignaling)}
                  onClick={() => handleSignal('APPROVE')}
                  className="rounded-full px-4 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 font-semibold"
                >
                  <CheckCircle2 className="size-4" />
                  <span>Approve Quote</span>
                </Button>

                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  loading={isSignaling === 'REJECT'}
                  disabled={Boolean(isSignaling)}
                  onClick={() => handleSignal('REJECT')}
                  className="rounded-full px-4 text-xs gap-1.5 font-semibold"
                >
                  <XCircle className="size-4" />
                  <span>Reject</span>
                </Button>
              </div>
            )}

            {/* Standard Draft / Submit Buttons */}
            {!isReadOnly && status !== 'AWAITING_APPROVAL' && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={isSaving}
                  disabled={isSaving || isSubmitting}
                  onClick={handleSaveDraft}
                  className="rounded-full px-4 text-xs gap-1.5 shadow-2xs border-border/40 hover:border-border"
                >
                  <Save className="size-4 text-ink-subtle" />
                  <span>Save Draft</span>
                </Button>

                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={isSubmitting}
                  disabled={isSaving || isSubmitting}
                  onClick={handleSubmitForApproval}
                  className="rounded-full px-4 text-xs gap-1.5 shadow-xs font-semibold"
                >
                  <Send className="size-4" />
                  <span>Submit for Approval</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Anything that will block approval, stated before the button is pressed */}
      {violations.length > 0 && !isReadOnly && (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger-soft/40 px-4 py-3 shadow-2xs">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              This quote breaks {violations.length === 1 ? 'a commercial rule' : `${violations.length} commercial rules`}
            </p>
            <ul className="mt-1 space-y-0.5">
              {violations.map((violation) => (
                <li
                  key={`${violation.code}-${violation.lineId ?? 'quote'}`}
                  className="text-xs text-ink-muted"
                >
                  {violation.message}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-ink-subtle">
              It can still be saved and sent for review — approval needs someone who can sign off
              below the floor.
            </p>
          </div>
        </div>
      )}

      {/* Read-Only Banner if Approved */}
      {isReadOnly && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300 shadow-2xs">
          <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div>
            <p className="font-semibold">Quotation Confirmed & Approved</p>
            <p className="text-xs text-emerald-800 dark:text-emerald-400">
              This quotation is locked. Its sales order holds the billing from here.
            </p>
          </div>
        </div>
      )}

      {id && (
        <QuoteCustomerPanel
          quoteId={id}
          status={status}
          acceptedAt={acceptance.acceptedAt}
          acceptedByName={acceptance.acceptedByName}
          supersededAt={acceptance.supersededAt}
          version={acceptance.version}
        />
      )}

      {/* Section 1: Customer Header & Meta Form */}
      <QuoteHeaderForm
        data={headerData}
        onChange={handleHeaderChange}
        readOnly={isReadOnly}
      />

      {/* Section 2: Polymorphic Order Lines Grid */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink uppercase tracking-wider">
            Order Lines & Deliverables
          </h2>
          <span className="text-xs text-ink-subtle">
            {items.filter((i) => i.type === 'product').length} products •{' '}
            {items.filter((i) => i.type === 'section').length} sections
          </span>
        </div>

        <QuoteLinesTable
          items={items}
          onChange={setItems}
          currency={headerData.currency}
          readOnly={isReadOnly}
          taxCodes={salesTaxCodes}
        />
      </div>

      {/* Section 3: Totals, with margin and policy checks alongside */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <QuoteTotalsCard totals={totals} currency={headerData.currency} />
        <QuoteMarginCard
          totals={totals}
          violations={violations}
          currency={headerData.currency}
        />
      </div>

      <QuoteBillingCard
        schedule={billingSchedule}
        onChange={setBillingSchedule}
        totals={totals}
        currency={headerData.currency}
        readOnly={isReadOnly}
      />

      {items.some((item) => item.taxReverseCharge) && (
        <p className="rounded-2xl border border-border/40 bg-surface-muted px-4 py-3 text-sm text-ink-muted">
          <strong className="text-ink">Reverse charge.</strong> This customer&apos;s address and tax number put
          these lines at 0%; the invoice will say the customer accounts for the tax.
        </p>
      )}

      {/* Files and history, once the quote exists to hang them off */}
      {id && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AttachmentsPanel ownerType="QUOTE" ownerId={id} canEdit={!isReadOnly} />
          <ActivityTimeline subjectType="QUOTE" subjectId={id} />
        </div>
      )}

      {/* Section 4: Terms & Internal Notes Tabs */}
      <QuoteTabsSection
        termsAndConditions={termsAndConditions}
        notes={notes}
        onChangeTerms={setTermsAndConditions}
        onChangeNotes={setNotes}
        readOnly={isReadOnly}
      />

      {/* Catalog picker → template configurator → resolved line */}
      <AddLineFlow
        open={isAddLineOpen}
        onClose={() => setIsAddLineOpen(false)}
        onAddLines={handleAddLines}
        currency={headerData.currency}
      />

      {/* Side-Over AI Copilot Drawer */}
      <QuoteAiDrawer
        open={isAiDrawerOpen}
        onClose={() => setIsAiDrawerOpen(false)}
        onApply={handleApplyAiDraft}
        currentCurrency={headerData.currency}
      />

      {/* Print & PDF Modal */}
      <QuotePrintModal
        open={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        headerData={headerData}
        items={items}
        totals={totals}
        termsAndConditions={termsAndConditions}
        status={status}
      />
    </div>
  );
}
