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
} from 'lucide-react';
import type {
  QuoteDto,
  QuoteLineItem,
  QuoteStatus,
  QuoteCreatedBy,
  CreateQuotePayload,
  UpdateQuotePayload,
} from '@saas/shared';
import { calculateQuoteTotals } from '@saas/shared';
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

  const isReadOnly = status === 'APPROVED';

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
          notes,
          prompt,
          createdBy,
        };

        const updated = await api.quotes.update(id, payload);
        setId(updated.id);
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
          notes,
          prompt,
          createdBy,
        };

        const created = await api.quotes.create(payload);
        setId(created.id);
        setStatus(created.status);
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
      <div className="sticky top-0 z-20 -mx-4 -mt-4 border-b border-border bg-surface/95 px-4 py-3.5 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Left: Back button + Title & Pipeline */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => (onBack ? onBack() : router.push('/quotes'))}
              className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors shadow-2xs"
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
            {/* AI Copilot Button */}
            {!isReadOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAiDrawerOpen(true)}
                className="border-brand/40 bg-brand-soft/20 text-brand hover:bg-brand-soft hover:border-brand gap-1.5 shadow-2xs font-semibold"
              >
                <Sparkles className="size-4 text-brand" />
                <span>AI Copilot ✨</span>
              </Button>
            )}

            {/* Print / Preview */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsPrintModalOpen(true)}
              className="gap-1.5 shadow-2xs"
            >
              <Printer className="size-4 text-ink-subtle" />
              <span>Preview / Print</span>
            </Button>

            {/* Manager Actions if Awaiting Approval */}
            {status === 'AWAITING_APPROVAL' && (
              <div className="flex items-center gap-2 pl-2 border-l border-border">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={isSignaling === 'APPROVE'}
                  disabled={Boolean(isSignaling)}
                  onClick={() => handleSignal('APPROVE')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
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
                  className="gap-1.5"
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
                  className="gap-1.5 shadow-2xs"
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
                  className="gap-1.5 shadow-sm font-semibold"
                >
                  <Send className="size-4" />
                  <span>Submit for Approval</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Read-Only Banner if Approved */}
      {isReadOnly && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 shadow-2xs">
          <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div>
            <p className="font-semibold">Quotation Confirmed & Approved</p>
            <p className="text-xs text-emerald-800 dark:text-emerald-400">
              This quotation is locked and ready for billing / invoicing.
            </p>
          </div>
        </div>
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
        />
      </div>

      {/* Section 3: Totals Summary Card */}
      <QuoteTotalsCard totals={totals} currency={headerData.currency} />

      {/* Section 4: Terms & Internal Notes Tabs */}
      <QuoteTabsSection
        termsAndConditions={termsAndConditions}
        notes={notes}
        onChangeTerms={setTermsAndConditions}
        onChangeNotes={setNotes}
        readOnly={isReadOnly}
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
