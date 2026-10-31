'use client';

import { useState, useId, useRef } from 'react';
import { X, Check, Layers, FileText, ListPlus, RotateCcw, ClipboardList } from 'lucide-react';
import type { QuoteLineItem } from '@saas/shared';
import { calculateQuoteTotals, DEFAULT_UNIT } from '@saas/shared';
import { Button } from '@/components/ui/button';
import { ModalShell } from '@/components/ui/modal-shell';
import { formatCurrency } from './quote-lines-table';
import { toast } from 'sonner';

export interface GeneratedQuoteDraft {
  title?: string;
  items: QuoteLineItem[];
  paymentTerms?: string;
  termsAndConditions?: string;
  notes?: string;
  currency?: string;
  prompt: string;
}

interface QuoteAiDrawerProps {
  open: boolean;
  onClose: () => void;
  onApply: (draft: GeneratedQuoteDraft) => void;
  currentCurrency?: string;
}

const EXAMPLES = [
  {
    title: 'Rigid gift boxes',
    description: 'Boxes, inserts and sleeves for a seasonal run.',
    prompt:
      'Ramadan gift boxes for Al Noor Sweets\nSection: Boxes\n- Rigid box 200x150x60, gold foil lid: 5000 boxes @ AED 4.60\n- EVA foam insert, 2 cavities: 5000 pcs @ AED 0.85\nSection: Finishing\n- Printed paper sleeve, matt lamination: 5000 pcs @ AED 0.40 with 5% discount\nNote: Artwork to be approved before production.\nPayment terms: Net 30.',
  },
  {
    title: 'Corrugated shipping cartons',
    description: 'Printed cartons with dividers, delivered on pallets.',
    prompt:
      'Shipping cartons for Gulf Dates\n- Double-wall carton 400x300x300, 1-colour flexo: 2000 boxes @ AED 3.20\n- Cardboard divider, 12 cells: 2000 pcs @ AED 0.55\n- Palletising and stretch wrap: 10 pallets @ AED 45\nNote: Overs and unders of 10% apply.\nPayment terms: Net 15.',
  },
  {
    title: 'Shop signage',
    description: 'Fascia sign, lightbox and installation.',
    prompt:
      'Signage for Marina Bakery\n- Aluminium fascia sign with acrylic letters: 1 set @ AED 6,500\n- Double-sided LED lightbox, 600mm: 2 pcs @ AED 1,800\n- Installation, two installers: 8 hours @ AED 150 with 5% VAT\nNote: Municipality permit by the customer.\nPayment terms: Immediate.',
  },
];

/** Units the reader recognises, mapped to how the quote writes them. */
const UNIT_WORDS: Array<[RegExp, string]> = [
  [/^(boxes|box|cartons?)$/, 'boxes'],
  [/^(pcs|pieces?|pc|units?)$/, 'pcs'],
  [/^(sheets?)$/, 'sheets'],
  [/^(labels?)$/, 'labels'],
  [/^(rolls?)$/, 'rolls'],
  [/^(sets?)$/, 'sets'],
  [/^(pallets?)$/, 'pallets'],
  [/^(kg|kgs|kilos?)$/, 'kg'],
  [/^(m2|sqm)$/, 'm²'],
  [/^(hours?|hrs?)$/, 'hours'],
  [/^(days?)$/, 'days'],
];

const UNIT_PATTERN =
  'boxes|box|cartons?|pcs|pieces?|pc|units?|sheets?|labels?|rolls?|sets?|pallets?|kgs?|kilos?|m2|sqm|hours?|hrs?|days?';

/**
 * Reads quote lines out of plain text, one item per line.
 *
 * This is a pattern reader, not a model: it picks out a quantity with its
 * unit, a price after "@" or a currency code, and any "% discount" or
 * "% VAT". Anything it cannot read as a priced line is left out rather than
 * guessed, and the person reviews every line before it reaches the quote.
 */
function parsePromptToQuote(promptText: string, defaultCurrency = 'AED'): GeneratedQuoteDraft {
  const lines = promptText.split('\n').map((l) => l.trim()).filter(Boolean);
  const items: QuoteLineItem[] = [];

  let title: string | undefined;
  let paymentTerms: string | undefined;

  // The first line is the title unless it is itself a line item or a section.
  if (lines.length > 0 && !/[:@]|^(section|note)\b/i.test(lines[0])) {
    const firstLineClean = lines[0].replace(/^(quote for|proposal for|rfq:?)\s*/i, '').trim();
    if (firstLineClean.length > 3 && firstLineClean.length < 80) title = firstLineClean;
  }

  const lowerText = promptText.toLowerCase();
  if (lowerText.includes('immediate') || lowerText.includes('due on receipt')) paymentTerms = 'immediate';
  else if (/net ?15|15 days/.test(lowerText)) paymentTerms = 'net_15';
  else if (/net ?30|30 days/.test(lowerText)) paymentTerms = 'net_30';
  else if (/net ?60|60 days/.test(lowerText)) paymentTerms = 'net_60';
  else if (lowerText.includes('end of month')) paymentTerms = 'end_of_month';

  let lineCounter = 1;

  for (const [index, line] of lines.entries()) {
    if (index === 0 && title) continue;
    const cleanLine = line.replace(/^[-*•]\s*/, '');

    if (/^payment terms?\b/i.test(cleanLine)) continue;

    const section = cleanLine.match(/^(section|part)\s*\d*\s*[:\-]\s*(.+)$/i);
    if (section) {
      items.push({ id: `draft_sec_${lineCounter++}`, type: 'section', description: section[2].trim() });
      continue;
    }

    if (/^note\s*[:\-]/i.test(cleanLine)) {
      items.push({
        id: `draft_note_${lineCounter++}`,
        type: 'note',
        description: cleanLine.replace(/^note\s*[:\-]\s*/i, ''),
      });
      continue;
    }

    const priceMatch = cleanLine.match(/(?:@|\bat\b|\$|\b[A-Z]{3}\b)\s*(?:[A-Z]{3}\s*)?([\d,]+(?:\.\d+)?)/);
    if (!priceMatch) continue;
    const unitPrice = parseFloat(priceMatch[1].replace(/,/g, ''));

    let quantity = 1;
    let uom = DEFAULT_UNIT;
    const qtyMatch = cleanLine.match(new RegExp(`([\\d,]+)\\s*(${UNIT_PATTERN})\\b`, 'i'));
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1].replace(/,/g, ''), 10);
      const word = qtyMatch[2].toLowerCase();
      uom = UNIT_WORDS.find(([pattern]) => pattern.test(word))?.[1] ?? DEFAULT_UNIT;
    }

    const discount = Number(cleanLine.match(/(\d+(?:\.\d+)?)%\s*(?:discount|off)/i)?.[1] ?? 0);
    const taxRate = Number(cleanLine.match(/(\d+(?:\.\d+)?)%\s*(?:vat|tax)/i)?.[1] ?? 0);

    // The description is everything before the quantity or price.
    const cut = Math.min(
      ...[qtyMatch?.index, priceMatch.index].filter((at): at is number => typeof at === 'number'),
    );
    const description =
      cleanLine.slice(0, cut).replace(/[:\-–,\s]+$/g, '').trim() || `Line ${lineCounter}`;

    const gross = quantity * unitPrice;
    const subtotal = Number((gross - gross * (discount / 100)).toFixed(2));

    items.push({
      id: `draft_item_${lineCounter++}`,
      type: 'product',
      description,
      quantity,
      uom,
      unitPrice,
      discount,
      taxRate,
      subtotal,
    });
  }

  return {
    title,
    items,
    paymentTerms,
    currency: defaultCurrency,
    prompt: promptText,
  };
}

export function QuoteAiDrawer({
  open,
  onClose,
  onApply,
  currentCurrency = 'USD',
}: QuoteAiDrawerProps) {
  const [prompt, setPrompt] = useState('');
  const [generatedDraft, setGeneratedDraft] = useState<GeneratedQuoteDraft | null>(null);
  const titleId = useId();
  const promptId = useId();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // The examples and the hint are written in the quote's own currency.
  const inCurrency = (text: string) => text.replaceAll('AED', currentCurrency);

  const handleGenerate = () => {
    if (!prompt.trim()) {
      toast.error('Type or paste the job first, one item per line.');
      return;
    }
    const draft = parsePromptToQuote(prompt.trim(), currentCurrency);
    if (!draft.items.some((item) => item.type === 'product')) {
      setGeneratedDraft(null);
      toast.error('No priced lines found. Write each item with its quantity and price, e.g. "Rigid box: 5000 boxes @ AED 4.60".');
      return;
    }
    setGeneratedDraft(draft);
  };

  const handleApply = () => {
    if (!generatedDraft) return;
    onApply(generatedDraft);
    const count = generatedDraft.items.filter((item) => item.type === 'product').length;
    toast.success(`${count} ${count === 1 ? 'line' : 'lines'} added to the quote. Check them before saving.`);
    setGeneratedDraft(null);
    setPrompt('');
    onClose();
  };

  const totals = generatedDraft ? calculateQuoteTotals(generatedDraft.items) : null;
  const productCount = generatedDraft?.items.filter((item) => item.type === 'product').length ?? 0;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      placement="end"
      initialFocusRef={promptRef}
    >
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Drawer Header */}
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-muted text-ink">
                <ClipboardList className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 id={titleId} className="text-sm font-semibold tracking-tight text-ink">
                  Draft lines from an enquiry
                </h2>
                <p className="text-xs text-ink-muted">
                  Paste or type the job, one item per line. Kerf picks out quantities, prices,
                  discounts and VAT, and you check every line before it&apos;s added.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="grid size-10 shrink-0 place-items-center rounded-full text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
              aria-label="Close the enquiry drawer"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 scrollbar-thin">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink-muted">Start from an example</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {EXAMPLES.map((example) => (
                  <button
                    key={example.title}
                    type="button"
                    onClick={() => setPrompt(inCurrency(example.prompt))}
                    className="flex min-h-11 flex-col text-left p-3 rounded-xl border border-border bg-surface-muted/30 hover:border-border-strong hover:bg-surface-muted transition-colors text-xs cursor-pointer"
                  >
                    <span className="font-semibold text-ink">{example.title}</span>
                    <span className="text-xs text-ink-muted mt-0.5 line-clamp-2">{example.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor={promptId} className="text-sm font-medium text-ink">
                  The job
                </label>
                {prompt && (
                  <button
                    type="button"
                    onClick={() => {
                      setPrompt('');
                      setGeneratedDraft(null);
                    }}
                    className="flex min-h-10 items-center gap-1 px-2 text-xs text-ink-muted hover:text-ink transition-colors cursor-pointer"
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    Clear
                  </button>
                )}
              </div>
              <textarea
                ref={promptRef}
                id={promptId}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={inCurrency('Rigid box 200x150x60, gold foil lid: 5000 boxes @ AED 4.60\nEVA foam insert: 5000 pcs @ AED 0.85 with 5% discount')}
                rows={6}
                className="w-full rounded-xl border border-border-control bg-surface p-3.5 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:border-brand-ring focus:ring-1 focus:ring-brand-ring focus:outline-hidden"
              />
            </div>

            <Button type="button" variant={generatedDraft ? 'outline' : 'primary'} size="lg" onClick={handleGenerate} className="w-full">
              <ListPlus className="size-4" aria-hidden />
              {generatedDraft ? 'Read it again' : 'Read the lines'}
            </Button>

            {generatedDraft && totals && (
              <div className="space-y-4 rounded-2xl border border-border bg-surface-muted/30 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
                  <span className="text-sm font-semibold text-ink">Check before adding</span>
                  <span className="text-xs font-medium text-ink-muted">
                    {productCount} priced {productCount === 1 ? 'line' : 'lines'}
                  </span>
                </div>

                <div className="divide-y divide-border rounded-xl border border-border bg-surface overflow-hidden">
                  {generatedDraft.items.map((item) => {
                    if (item.type === 'section') {
                      return (
                        <div key={item.id} className="flex items-center gap-2 bg-surface-muted/60 px-3 py-2 text-xs font-semibold text-ink">
                          <Layers className="size-3.5 text-ink-subtle shrink-0" aria-hidden />
                          <span>{item.description}</span>
                        </div>
                      );
                    }
                    if (item.type === 'note') {
                      return (
                        <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-xs text-ink-muted">
                          <FileText className="size-3.5 text-ink-subtle shrink-0" aria-hidden />
                          <span>{item.description}</span>
                        </div>
                      );
                    }

                    return (
                      <div key={item.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-ink truncate">{item.description}</p>
                          <p className="text-xs text-ink-muted tabular-nums">
                            {item.quantity?.toLocaleString()} {item.uom} × {formatCurrency(item.unitPrice || 0, currentCurrency)}
                            {(item.discount || 0) > 0 && ` · ${item.discount}% off`}
                            {(item.taxRate || 0) > 0 && ` · ${item.taxRate}% VAT`}
                          </p>
                        </div>
                        <span className="font-semibold text-ink tabular-nums shrink-0">
                          {formatCurrency(item.subtotal || 0, currentCurrency)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-between text-sm font-semibold text-ink">
                  <span>Adds before tax</span>
                  <span className="tabular-nums">{formatCurrency(totals.subtotalAmount, currentCurrency)}</span>
                </div>

                <p className="text-xs text-ink-muted">
                  These lines are typed, not costed from the catalog, so the margin can&apos;t count
                  their cost until you swap them for catalog items.
                </p>

                <Button type="button" variant="primary" size="lg" onClick={handleApply} className="w-full">
                  <Check className="size-4 stroke-[2.5]" aria-hidden />
                  Add {productCount} {productCount === 1 ? 'line' : 'lines'} to the quote
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
