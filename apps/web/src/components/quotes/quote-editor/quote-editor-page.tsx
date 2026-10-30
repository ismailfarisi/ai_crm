'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  Send,
  Printer,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Undo2,
  ClipboardList,
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
import { calculateQuoteTotals, DEFAULT_UNIT, evaluateGuardrails, PERMISSIONS } from '@saas/shared';
import { useCostingPolicy } from '@/hooks/use-catalog';
import { useTaxCodes } from '@/hooks/use-credits';
import { useOrganization } from '@/hooks/use-organization';
import { useMediaQuery } from '@/hooks/use-media-query';
import { api } from '@/lib/api/endpoints';
import { useSession } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/field';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import { QuoteStatusPipeline } from '../quote-status-pipeline';
import { QuoteHeaderForm, type QuoteHeaderFormData } from './quote-header-form';
import { QuoteLinesTable, formatCurrency } from './quote-lines-table';
import { QuoteTotalsCard } from './quote-totals-card';
import { QuoteTabsSection } from './quote-tabs-section';
import { QuoteAiDrawer, type GeneratedQuoteDraft } from './quote-ai-drawer';
import { QuotePrintModal } from './quote-print-modal';
import { AddLineFlow } from './add-line-flow';
import { MarginBadge, QuoteMarginCard } from './quote-margin-card';
import { QuoteBillingCard } from './quote-billing-card';
import { QuoteActionMenu, type QuoteMenuAction } from './quote-action-menu';
import { lineMargin, linesWithoutCost, marginStatus } from './margin-status';
import { thirtyDaysFromToday } from './format';
import { useLiveRecost } from './use-live-recost';
import { AttachmentsPanel } from '@/components/platform/attachments-panel';
import { ActivityTimeline } from '@/components/platform/activity-timeline';
import { useQuoteSalesOrder } from '@/hooks/use-sales-orders';
import { QuoteCustomerPanel, type CustomerDialog } from './quote-customer-panel';

/** A field to focus once the line it belongs to is on screen. */
interface FocusTarget {
  lineId: string;
  field: 'description' | 'quantity';
}

interface QuoteEditorPageProps {
  quoteId?: string;
  initialQuote?: QuoteDto;
  onBack?: () => void;
}

interface EditableParts {
  headerData: QuoteHeaderFormData;
  items: QuoteLineItem[];
  termsAndConditions: string | null;
  notes: string | null;
  billingSchedule: BillingStage[] | null;
}

/**
 * The parts of a quote a person edits, compared against the last save to know
 * what is unsaved. The number is left out: the server assigns it.
 */
function editableSnapshot({ headerData, ...rest }: EditableParts): string {
  return JSON.stringify({ header: { ...headerData, quoteNumber: undefined }, ...rest });
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function QuoteEditorPage({
  quoteId,
  initialQuote,
  onBack,
}: QuoteEditorPageProps) {
  const router = useRouter();
  const isPhone = useMediaQuery('(max-width: 767.98px)');
  const { check } = useSession();
  const canSeeCost = check({ permission: PERMISSIONS.QUOTE_VIEW_COST });
  const canApprove = check({ permission: PERMISSIONS.QUOTE_APPROVE });
  const canCreate = check({ permission: PERMISSIONS.QUOTE_CREATE });
  const canUpdate = check({ permission: PERMISSIONS.QUOTE_UPDATE });

  // Loading & Saving States
  const [isLoading, setIsLoading] = useState(!initialQuote && Boolean(quoteId));
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSignaling, setIsSignaling] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [isReverting, setIsReverting] = useState(false);

  // Modals & Drawers
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isAddLineOpen, setIsAddLineOpen] = useState(false);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const openDecision = (next: 'APPROVE' | 'REJECT' | null) => {
    setDecisionError(null);
    setDecision(next);
  };

  // Quote State
  const [id, setId] = useState<string | undefined>(initialQuote?.id || quoteId);
  const [status, setStatus] = useState<QuoteStatus>(initialQuote?.status || 'DRAFT');
  const [createdBy, setCreatedBy] = useState<QuoteCreatedBy>(initialQuote?.createdBy || 'HUMAN');
  const [prompt, setPrompt] = useState<string | null>(initialQuote?.prompt || null);
  // The quote's issue date on the printed document; unset until it is first saved.
  const [createdAt, setCreatedAt] = useState<string | null>(initialQuote?.createdAt ?? null);

  const [headerData, setHeaderData] = useState<QuoteHeaderFormData>({
    title: initialQuote?.title || '',
    quoteNumber: initialQuote?.quoteNumber || '',
    customerId: initialQuote?.customerId || null,
    customerName: initialQuote?.customerName || '',
    customerEmail: initialQuote?.customerEmail || null,
    // A new quote is good for thirty days, matching the default terms.
    validUntil: initialQuote?.validUntil || (quoteId ? null : thirtyDaysFromToday()),
    paymentTerms: initialQuote?.paymentTerms || 'immediate',
    // Empty until chosen: a new quote is in the organisation's own currency.
    currency: initialQuote?.currency || '',
  });

  // The rates offered on a line come from the organisation's own sales tax
  // codes, so a code configured under Finance → Tax actually reaches a quote.
  const { data: taxCodes } = useTaxCodes();
  const { data: organization } = useOrganization();
  const currency = headerData.currency || organization?.baseCurrency || 'AED';
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
      uom: DEFAULT_UNIT,
      unitPrice: 0,
      discount: 0,
      taxRate: 0,
      subtotal: 0,
    },
  ]);

  const [termsAndConditions, setTermsAndConditions] = useState<string | null>(
    initialQuote?.termsAndConditions ||
      '1. Prices are for the quantity quoted. Overs and unders of up to 10% are charged at the unit price.\n2. Lead time runs from artwork approval.\n3. This quote is valid for 30 days from the issue date.',
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
  // Shared with the customer panel, which fetches the same order.
  const { data: orderResult } = useQuoteSalesOrder(id, status === 'APPROVED' || Boolean(acceptance.acceptedAt));
  const existingOrder = orderResult?.order ?? null;
  const [customerDialog, setCustomerDialog] = useState<CustomerDialog>(null);

  /*
   * Unsaved changes: the editable parts as they stood at the last load or
   * save, against what is on screen now. A save re-prices lines on the
   * server, so the baseline takes the lines the server sent back, not the
   * ones that were sent.
   */
  const current: EditableParts = { headerData, items, termsAndConditions, notes, billingSchedule };
  const snapshot = editableSnapshot(current);
  const [baseline, setBaseline] = useState<string | null>(() =>
    quoteId && !initialQuote ? null : editableSnapshot(current),
  );
  const markSaved = (saved: Partial<EditableParts> = {}) =>
    setBaseline(editableSnapshot({ ...current, ...saved }));
  const hasUnsavedChanges = baseline !== null && snapshot !== baseline;

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
            setCreatedAt(q.createdAt ?? null);
            setPrompt(q.prompt || null);
            const loaded: EditableParts = {
              headerData: {
                title: q.title || '',
                quoteNumber: q.quoteNumber || '',
                customerId: q.customerId || null,
                customerName: q.customerName || '',
                customerEmail: q.customerEmail || null,
                validUntil: q.validUntil || null,
                paymentTerms: q.paymentTerms || 'immediate',
                // Empty falls back to the organisation's own currency below.
                currency: q.currency || '',
              },
              items: q.items?.length ? q.items : [],
              termsAndConditions: q.termsAndConditions || null,
              notes: q.notes || null,
              billingSchedule: q.billingSchedule ?? null,
            };
            setHeaderData(loaded.headerData);
            setItems(loaded.items);
            setTermsAndConditions(loaded.termsAndConditions);
            setNotes(loaded.notes);
            setBillingSchedule(loaded.billingSchedule);
            setBaseline(editableSnapshot(loaded));
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
  const recost = useLiveRecost(setItems);
  const uncostedLines = linesWithoutCost(items);
  const margin = marginStatus(totals, policy, uncostedLines, recost.recosting.size);
  const marginFloor = policy?.enforce ? policy.minMarginPct : null;

  // An edit in the table, with each changed quantity's cost brought into line.
  const handleLinesChange = (next: QuoteLineItem[]) => setItems(recost.apply(items, next));

  /*
   * After a line is added or removed, focus goes where the work continues: the
   * new line's quantity or description, or the line that took a removed one's
   * place. Without this it fell to the page body and Tab started from the top.
   */
  const focusTarget = useRef<FocusTarget | null>(null);
  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    const field = document.querySelector<HTMLElement>(
      `[data-line-id="${target.lineId}"] [data-line-field="${target.field}"]`,
    );
    if (field) {
      focusTarget.current = null;
      field.focus();
    }
  });

  const handleAddTypedLine = (line: QuoteLineItem) => {
    focusTarget.current = { lineId: line.id, field: 'description' };
    setItems((prev) => [...prev, line]);
  };

  // Removing a line is instant, so it can be taken back.
  const handleRemoveLine = (lineId: string) => {
    const index = items.findIndex((item) => item.id === lineId);
    if (index < 0) return;
    const removed = items[index];
    const neighbour = items[index + 1] ?? items[index - 1];
    if (neighbour) focusTarget.current = { lineId: neighbour.id, field: 'description' };
    recost.forget([lineId]);
    setItems((prev) => prev.filter((item) => item.id !== lineId));
    toast(removed.description ? `Removed "${removed.description}"` : 'Line removed', {
      action: {
        label: 'Undo',
        onClick: () =>
          setItems((prev) =>
            prev.some((item) => item.id === lineId)
              ? prev
              : [...prev.slice(0, index), removed, ...prev.slice(index)],
          ),
      },
    });
  };

  // A superseded version is history; edit the revision instead. Someone who
  // may only read quotes sees them read-only too, not a form that fails on save.
  const isReadOnly =
    status === 'APPROVED' || Boolean(acceptance.supersededAt) || !(id ? canUpdate : canCreate);

  // ⌘K / Ctrl-K opens the catalog picker, the way every other palette works,
  // and ⌘S / Ctrl-S saves instead of saving the web page.
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (isReadOnly) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setIsAddLineOpen(true);
      } else if (key === 's') {
        event.preventDefault();
        saveRef.current();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isReadOnly]);

  // Closing the tab or reloading with unsaved edits asks first.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  // The typed line a catalog pick will replace, when the picker was opened from one.
  const [replacingLineId, setReplacingLineId] = useState<string | null>(null);

  const handleAddLines = useCallback(
    (lines: QuoteLineItem[]) => {
      // A line from the picker arrives at quantity 1; the quantity is next.
      const firstProduct = lines.find((line) => line.type === 'product');
      if (firstProduct) focusTarget.current = { lineId: firstProduct.id, field: 'quantity' };
      setItems((prev) => {
        const target = replacingLineId ? prev.find((item) => item.id === replacingLineId) : undefined;
        if (target && lines.length > 0) {
          // Keep the quantity that was typed; the cost scales with it.
          const quantity = Number(target.quantity) || Number(lines[0].quantity) || 1;
          const [first, ...rest] = lines;
          const unitCost = first.cost ? Number(first.cost.unitCost) : undefined;
          const replacement: QuoteLineItem = {
            ...first,
            quantity,
            subtotal: Number(((Number(first.unitPrice) || 0) * quantity * (1 - (Number(first.discount) || 0) / 100)).toFixed(2)),
            ...(first.cost && unitCost !== undefined
              ? { cost: { ...first.cost, totalCost: Number((unitCost * quantity).toFixed(2)) } }
              : {}),
          };
          return prev.flatMap((item) => (item.id === target.id ? [replacement, ...rest] : [item]));
        }
        // Drop the empty starter row the editor seeds a new quote with.
        const meaningful = prev.filter(
          (item) => item.type !== 'product' || item.description.trim() || (item.unitPrice ?? 0) > 0,
        );
        return [...meaningful, ...lines];
      });
      setReplacingLineId(null);
    },
    [replacingLineId],
  );

  // Handle header data updates
  const handleHeaderChange = useCallback((patch: Partial<QuoteHeaderFormData>) => {
    setHeaderData((prev) => ({ ...prev, ...patch }));
  }, []);

  /**
   * Lines read from an enquiry are added to what is already on the quote —
   * never in place of it, which used to throw away costed catalog lines — and
   * fill in the title and payment terms only where nothing was set.
   */
  const handleApplyAiDraft = useCallback(
    (draft: GeneratedQuoteDraft) => {
      setHeaderData((prev) => ({
        ...prev,
        title: prev.title.trim() ? prev.title : draft.title || prev.title,
        paymentTerms: id ? prev.paymentTerms : draft.paymentTerms || prev.paymentTerms,
      }));
      handleAddLines(draft.items);
      if (draft.prompt && !prompt) setPrompt(draft.prompt);
    },
    [handleAddLines, id, prompt],
  );

  const basePayload = () => ({
    title: headerData.title.trim(),
    quoteNumber: headerData.quoteNumber,
    customerId: headerData.customerId,
    customerName: headerData.customerName || 'General Customer',
    customerEmail: headerData.customerEmail,
    validUntil: headerData.validUntil,
    paymentTerms: headerData.paymentTerms,
    currency,
    items,
    subtotalAmount: totals.subtotalAmount,
    discountAmount: totals.discountAmount,
    taxAmount: totals.taxAmount,
    totalAmount: totals.totalAmount,
    termsAndConditions,
    billingSchedule,
    notes,
    prompt,
  });

  // Save Draft
  const handleSaveDraft = async (): Promise<string | null> => {
    if (!headerData.title.trim()) {
      toast.error('Give the quote a title before saving it.');
      return null;
    }

    setIsSaving(true);
    try {
      if (id) {
        const payload: UpdateQuotePayload = { ...basePayload(), createdBy };
        const updated = await api.quotes.update(id, payload);
        setId(updated.id);
        // The server re-prices and re-taxes lines from the customer's address;
        // show what was stored, not what was typed.
        if (updated.items) setItems(updated.items);
        setStatus(updated.status);
        markSaved({ items: updated.items ?? items });
        toast.success('Quote saved');
        return updated.id;
      } else {
        const payload: CreateQuotePayload = { ...basePayload(), createdBy };
        const created = await api.quotes.create(payload);
        setId(created.id);
        setCreatedAt(created.createdAt ?? null);
        setStatus(created.status);
        if (created.items) setItems(created.items);
        markSaved({ items: created.items ?? items });
        toast.success('Quote created');
        return created.id;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save quotation');
      return null;
    } finally {
      setIsSaving(false);
    }
  };
  useEffect(() => {
    saveRef.current = () => {
      if (!isSaving) void handleSaveDraft();
    };
  });

  // Submit for Approval
  const handleSubmitForApproval = async () => {
    if (!headerData.title.trim()) {
      toast.error('Give the quote a title before submitting it.');
      return;
    }
    if (!(totals.subtotalAmount > 0)) {
      toast.error('Price at least one line before submitting the quote.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Save first if newly created or edited
      if (!id) {
        const payload: CreateQuotePayload = { ...basePayload(), createdBy };
        const created = await api.quotes.create(payload);
        setId(created.id);
        setCreatedAt(created.createdAt ?? null);
      } else {
        await api.quotes.update(id, { ...basePayload(), status: 'AWAITING_APPROVAL' });
      }

      // Update status locally
      setStatus('AWAITING_APPROVAL');
      markSaved();
      toast.success('Submitted for approval');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit quotation');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Approval Signal (Approve / Reject), confirmed in a dialog first
  const handleSignal = async (action: 'APPROVE' | 'REJECT') => {
    if (!id) return;
    setIsSignaling(action);
    setDecisionError(null);
    try {
      const reason = rejectReason.trim();
      const updated = await api.quotes.signal(
        id,
        action === 'REJECT' && reason ? { action, payload: { reason } } : { action },
      );
      setStatus(updated.status);
      setDecision(null);
      setRejectReason('');
      toast.success(action === 'APPROVE' ? 'Quote approved' : 'Quote sent back for changes');
    } catch (err) {
      // Said inside the dialog: a toast would sit behind it, unseen.
      setDecisionError(err instanceof Error ? err.message : `Could not ${action.toLowerCase()} the quote`);
    } finally {
      setIsSignaling(null);
    }
  };

  // Revert / Withdraw to Draft
  const handleRevertToDraft = async () => {
    if (!id) return;
    setIsReverting(true);
    try {
      const payload: UpdateQuotePayload = { ...basePayload(), createdBy, status: 'DRAFT' };
      const updated = await api.quotes.update(id, payload);
      setId(updated.id);
      if (updated.items) setItems(updated.items);
      setStatus(updated.status);
      markSaved({ items: updated.items ?? items });
      toast.success('Quote returned to draft');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to return quotation to draft');
    } finally {
      setIsReverting(false);
    }
  };

  const goBack = () => {
    if (hasUnsavedChanges && !window.confirm('Leave without saving? Your changes to this quote will be lost.')) {
      return;
    }
    if (onBack) onBack();
    else router.push('/quotes');
  };

  if (isLoading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <Loader2 className="size-8 animate-spin text-ink-subtle" aria-hidden />
        <p className="text-sm font-medium text-ink-muted">Loading the quote…</p>
      </div>
    );
  }

  const busy = isSaving || isSubmitting || Boolean(isSignaling) || isReverting;
  // An approved quote waiting on its customer: Send is its next step.
  const awaitingCustomer =
    status === 'APPROVED' && !acceptance.acceptedAt && !acceptance.supersededAt && !existingOrder && canUpdate;
  const awaiting = status === 'AWAITING_APPROVAL';
  const lineCount = items.filter((i) => i.type === 'product').length;
  const sectionCount = items.filter((i) => i.type === 'section').length;
  const shortcut = isMac() ? '⌘K' : 'Ctrl K';

  // The one primary action for where the quote is in its life. Approved
  // quotes hand the primary to "Send to customer" in the panel below, and on
  // a phone to the bottom bar.
  const sendButton = awaitingCustomer && (
    <Button
      type="button"
      variant="primary"
      size="lg"
      disabled={busy}
      onClick={() => setCustomerDialog('send')}
    >
      <Send className="size-4" aria-hidden />
      <span>Send to customer</span>
    </Button>
  );
  const primary = isReadOnly ? null : awaiting ? (
    canApprove ? (
      <Button
        type="button"
        variant="primary"
        size={isPhone ? 'lg' : 'md'}
        loading={isSignaling === 'APPROVE'}
        disabled={busy}
        onClick={() => openDecision('APPROVE')}
      >
        <CheckCircle2 className="size-4" aria-hidden />
        <span>Approve quote</span>
      </Button>
    ) : null
  ) : (
    <Button
      type="button"
      variant="primary"
      size={isPhone ? 'lg' : 'md'}
      loading={isSubmitting}
      disabled={busy}
      onClick={handleSubmitForApproval}
    >
      <Send className="size-4" aria-hidden />
      <span>{status === 'REJECTED' ? 'Resubmit for approval' : 'Submit for approval'}</span>
    </Button>
  );

  const saveLabel = status === 'DRAFT' ? 'Save draft' : 'Save changes';
  const saveButton = !isReadOnly && (
    <Button
      type="button"
      variant="outline"
      size={isPhone ? 'lg' : 'md'}
      loading={isSaving}
      disabled={busy}
      onClick={handleSaveDraft}
      title={`Save (${isMac() ? '⌘S' : 'Ctrl S'})`}
    >
      <Save className="size-4 text-ink-subtle" aria-hidden />
      <span>{saveLabel}</span>
    </Button>
  );

  const rejectButton = awaiting && canApprove && !isReadOnly && (
    <Button
      type="button"
      variant="outline"
      size={isPhone ? 'lg' : 'md'}
      loading={isSignaling === 'REJECT'}
      disabled={busy}
      onClick={() => openDecision('REJECT')}
      className="text-danger"
    >
      <XCircle className="size-4" aria-hidden />
      <span>Reject</span>
    </Button>
  );

  const menuActions: QuoteMenuAction[] = [
    ...(!isReadOnly
      ? [{ key: 'draft', label: 'Draft lines from an enquiry', icon: ClipboardList, onSelect: () => setIsAiDrawerOpen(true) }]
      : []),
    { key: 'print', label: 'Preview / Print', icon: Printer, onSelect: () => setIsPrintModalOpen(true) },
    // An approver on a phone has Approve in the bar; Save goes in the menu.
    ...(!isReadOnly && isPhone && awaiting && canApprove
      ? [{ key: 'save', label: saveLabel, icon: Save, onSelect: () => void handleSaveDraft(), disabled: busy }]
      : []),
    ...(awaiting && !isReadOnly
      ? [{ key: 'revert', label: 'Revert to draft', icon: Undo2, onSelect: handleRevertToDraft, disabled: busy }]
      : []),
    ...(awaiting && canApprove && !isReadOnly && isPhone
      ? [{ key: 'reject', label: 'Reject', icon: XCircle, onSelect: () => openDecision('REJECT'), disabled: busy, tone: 'danger' as const }]
      : []),
  ];

  const summary = (
    <div className="flex items-center gap-3">
      <div className="text-end leading-tight">
        <p className="text-xs text-ink-muted">Total</p>
        <p className="text-sm font-bold tabular-nums text-ink">
          {formatCurrency(totals.totalAmount, currency)}
        </p>
      </div>
      {canSeeCost && <MarginBadge totals={totals} status={margin} />}
    </div>
  );

  return (
    <div className="space-y-6 pb-36 md:pb-16">
      {/*
        Under the app header: what the quote is, what it is worth and what to do
        next, with where it stands on the line below. Two fixed rows, so the
        buttons never wrap into a ragged second row when the sidebar is open.
        On a phone it scrolls away; the bottom bar carries the total and the
        next step, and the screen keeps its height for the lines.
      */}
      <div className="z-20 -mx-4 -mt-6 space-y-2.5 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:sticky md:top-14 lg:-mx-8 lg:-mt-8 lg:px-8 print:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={goBack}
              className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
              aria-label="Back to Quotes"
            >
              <ArrowLeft className="size-4" aria-hidden />
            </button>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold tracking-tight text-ink">
                {headerData.title || 'New quote'}
              </h1>
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
                <span className="tabular-nums">{headerData.quoteNumber || 'Not saved yet'}</span>
                {headerData.customerName && <span>· {headerData.customerName}</span>}
                {hasUnsavedChanges && !isReadOnly && (
                  <span className="inline-flex items-center gap-1 font-medium text-warning" role="status">
                    <span className="size-1.5 rounded-full bg-warning" aria-hidden />
                    Unsaved changes
                  </span>
                )}
              </p>
            </div>
          </div>

          {!isPhone && (
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden lg:contents">
                {summary}
                <span className="mx-1 h-8 w-px bg-border" aria-hidden />
              </span>
              {saveButton}
              {rejectButton}
              {primary}
              <QuoteActionMenu actions={menuActions} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <QuoteStatusPipeline status={status} accepted={Boolean(acceptance.acceptedAt)} />
          {/* Below a laptop the total and margin move down here, beside the progress. */}
          {!isPhone && <span className="lg:hidden">{summary}</span>}
        </div>
      </div>

      {/* Anything that will block approval, stated before the button is pressed */}
      {violations.length > 0 && !isReadOnly && (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger-soft px-4 py-3 shadow-2xs" role="alert">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
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
            <p className="mt-1.5 text-xs text-ink-muted">
              It can still be saved and submitted, but only someone who can sign off below the floor
              can approve it.
            </p>
          </div>
        </div>
      )}

      {/* Approved, accepted or ordered: the customer panel says which, once. */}
      {id && (
        <QuoteCustomerPanel
          quoteId={id}
          status={status}
          acceptedAt={acceptance.acceptedAt}
          acceptedByName={acceptance.acceptedByName}
          supersededAt={acceptance.supersededAt}
          version={acceptance.version}
          hasUnsavedChanges={hasUnsavedChanges}
          onAccepted={(acceptedAt, acceptedByName) =>
            setAcceptance((prev) => ({ ...prev, acceptedAt, acceptedByName }))
          }
          dialog={customerDialog}
          onDialogChange={setCustomerDialog}
          hideSendButton={isPhone}
          summary={{
            quoteNumber: headerData.quoteNumber ?? '',
            customerName: headerData.customerName ?? '',
            customerEmail: headerData.customerEmail ?? null,
            validUntil: headerData.validUntil ?? null,
            currency: currency,
            totals,
            margin,
            lineCount,
          }}
        />
      )}

      {/* Section 1: Customer Header & Meta Form */}
      <QuoteHeaderForm
        data={{ ...headerData, currency }}
        onChange={handleHeaderChange}
        readOnly={isReadOnly}
      />

      {/* Section 2: The lines, costed from the catalog or typed */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink uppercase tracking-wider">Lines</h2>
          <span className="text-xs text-ink-muted tabular-nums">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
            {sectionCount > 0 && ` · ${sectionCount} ${sectionCount === 1 ? 'section' : 'sections'}`}
          </span>
        </div>

        <QuoteLinesTable
          items={items}
          onChange={handleLinesChange}
          onRemoveLine={handleRemoveLine}
          onAddTypedLine={handleAddTypedLine}
          canSeeCost={canSeeCost}
          marginFloor={marginFloor}
          recostingIds={recost.recosting}
          currency={currency}
          readOnly={isReadOnly}
          taxCodes={salesTaxCodes}
          onAddFromCatalog={() => {
            setReplacingLineId(null);
            setIsAddLineOpen(true);
          }}
          onFindInCatalog={(lineId) => {
            setReplacingLineId(lineId);
            setIsAddLineOpen(true);
          }}
          catalogShortcut={shortcut}
        />
      </div>

      {/* Section 3: Totals, with margin and policy checks alongside */}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <QuoteTotalsCard totals={totals} currency={currency} />
        <QuoteMarginCard
          totals={totals}
          violations={violations}
          status={margin}
          currency={currency}
        />
      </div>

      <QuoteBillingCard
        schedule={billingSchedule}
        onChange={setBillingSchedule}
        totals={totals}
        currency={currency}
        readOnly={isReadOnly}
      />

      {items.some((item) => item.taxReverseCharge) && (
        <p className="rounded-2xl border border-border bg-surface-muted px-4 py-3 text-sm text-ink-muted">
          <strong className="text-ink">Reverse charge.</strong> This customer&apos;s address and tax number put
          these lines at 0%; the invoice will say the customer accounts for the tax.
        </p>
      )}

      {/* Files and history, once the quote exists to hang them off */}
      {id && (
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
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

      {/* On a phone the total, the margin and the next step sit under the thumb */}
      {isPhone && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(0,0,0,0.05)] print:hidden">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className="text-base font-bold tabular-nums text-ink">
              <span className="me-1.5 text-xs font-medium text-ink-muted">Total</span>
              {formatCurrency(totals.totalAmount, currency)}
            </p>
            {canSeeCost && <MarginBadge totals={totals} status={margin} />}
          </div>
          <div className="flex items-center gap-2">
            {/* A draft keeps Save beside Submit; an approver's Save is in the menu. */}
            {primary && !isReadOnly && !(awaiting && canApprove) && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                loading={isSaving}
                disabled={busy}
                onClick={handleSaveDraft}
                className="px-4"
              >
                <Save className="size-4 text-ink-subtle" aria-hidden />
                <span>Save</span>
              </Button>
            )}
            <div className="min-w-0 flex-1 [&>button]:w-full">
              {primary ?? sendButton ?? (!isReadOnly ? saveButton : null)}
            </div>
            <QuoteActionMenu actions={menuActions} placement="up" />
          </div>
        </div>
      )}

      {/* Approve and reject are decisions; each gets a look at what is being decided */}
      {awaiting && canApprove && (
        <>
          <Dialog
            open={decision === 'APPROVE'}
            onClose={() => setDecision(null)}
            title={`Approve ${headerData.quoteNumber || 'this quote'}?`}
            description="Approving signs off the price so the quote can go to the customer. The sales order is raised when they accept."
            size="sm"
            footer={
              <>
                <Button type="button" variant="outline" onClick={() => setDecision(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  loading={isSignaling === 'APPROVE'}
                  onClick={() => handleSignal('APPROVE')}
                >
                  <CheckCircle2 className="size-4" aria-hidden />
                  Approve
                </Button>
              </>
            }
          >
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Customer</dt>
                <dd className="text-end font-medium text-ink">{headerData.customerName || '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Total</dt>
                <dd className="font-semibold tabular-nums text-ink">
                  {formatCurrency(totals.totalAmount, currency)}
                </dd>
              </div>
              {canSeeCost && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-ink-muted">Margin</dt>
                  <dd>
                    <MarginBadge totals={totals} status={margin} />
                  </dd>
                </div>
              )}
            </dl>
            <ul className="mt-4 divide-y divide-border/60 rounded-xl border border-border/60 text-sm">
              {items
                .filter((item) => item.type === 'product')
                .map((item, index) => {
                  // Which line pulls the margin down, not only the total.
                  const line = canSeeCost ? lineMargin(item, marginFloor) : null;
                  return (
                    <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{item.description || `Line ${index + 1}`}</span>
                        <span className="text-xs tabular-nums text-ink-muted">
                          {Number(item.quantity || 0).toLocaleString('en-GB')} {item.uom} ×{' '}
                          {formatCurrency(Number(item.unitPrice) || 0, currency)}
                          {Number(item.discount) > 0 && ` · ${item.discount}% off`}
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="block tabular-nums font-medium text-ink">
                          {formatCurrency(Number(item.subtotal) || 0, currency)}
                        </span>
                        {canSeeCost && (
                          <span
                            className={cn(
                              'block text-xs tabular-nums',
                              !line ? 'text-warning' : line.tone === 'danger' ? 'text-danger' : 'text-ink-muted',
                            )}
                          >
                            {!line
                              ? 'No cost'
                              : line.marginPct === null
                                ? 'Not priced'
                                : `${(line.marginPct * 100).toFixed(1).replace('-', '−')}% ${line.marginPct < 0 ? 'loss' : 'margin'}`}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
            </ul>
            {violations.length > 0 && (
              <div className="mt-4 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-xs text-ink">
                <p className="font-semibold">
                  You are approving a quote that breaks {violations.length === 1 ? 'a rule' : `${violations.length} rules`}:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 ps-4">
                  {violations.map((violation) => (
                    <li key={`${violation.code}-${violation.lineId ?? 'quote'}`}>{violation.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {decisionError && decision === 'APPROVE' && (
              <p role="alert" className="mt-4 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-ink">
                {decisionError}
              </p>
            )}
          </Dialog>

          <Dialog
            open={decision === 'REJECT'}
            onClose={() => setDecision(null)}
            title={`Send ${headerData.quoteNumber || 'this quote'} back for changes?`}
            description="It returns to the person who wrote it, with your note."
            size="sm"
            footer={
              <>
                <Button type="button" variant="outline" onClick={() => setDecision(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  loading={isSignaling === 'REJECT'}
                  onClick={() => handleSignal('REJECT')}
                >
                  <XCircle className="size-4" aria-hidden />
                  Reject
                </Button>
              </>
            }
          >
            <Textarea
              label="What needs to change?"
              hint="Optional, but it saves a phone call."
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={3}
            />
            {decisionError && decision === 'REJECT' && (
              <p role="alert" className="mt-4 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-ink">
                {decisionError}
              </p>
            )}
          </Dialog>
        </>
      )}

      {/* Catalog picker → template configurator → resolved line */}
      <AddLineFlow
        open={isAddLineOpen}
        onClose={() => setIsAddLineOpen(false)}
        onAddLines={handleAddLines}
        currency={currency}
      />

      {/* Lines read from a pasted or typed enquiry */}
      <QuoteAiDrawer
        open={isAiDrawerOpen}
        onClose={() => setIsAiDrawerOpen(false)}
        onApply={handleApplyAiDraft}
        currentCurrency={currency}
      />

      {/* Print & PDF Modal */}
      <QuotePrintModal
        open={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        quoteId={id}
        issuedAt={createdAt}
        onSaveBeforeDownload={handleSaveDraft}
        headerData={headerData}
        items={items}
        totals={totals}
        termsAndConditions={termsAndConditions}
        status={status}
      />
    </div>
  );
}
