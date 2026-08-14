'use client';

import { Printer, X, Download, ShieldCheck, Building, CheckCircle2 } from 'lucide-react';
import type { QuoteLineItem, QuoteTotals } from '@saas/shared';
import { Button } from '@/components/ui/button';
import { formatCurrency } from './quote-lines-table';
import { QuoteStatusBadge } from '../quote-status-badge';
import type { QuoteHeaderFormData } from './quote-header-form';

interface QuotePrintModalProps {
  open: boolean;
  onClose: () => void;
  headerData: QuoteHeaderFormData;
  items: QuoteLineItem[];
  totals: QuoteTotals;
  termsAndConditions?: string | null;
  status?: string;
  organizationName?: string;
}

export function QuotePrintModal({
  open,
  onClose,
  headerData,
  items,
  totals,
  termsAndConditions,
  status = 'DRAFT',
  organizationName = 'AI CRM Enterprise',
}: QuotePrintModalProps) {
  if (!open) return null;

  const handlePrint = () => {
    window.print();
  };

  const currency = headerData.currency || 'USD';
  let productIdx = 0;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      {/* Modal Container */}
      <div className="relative w-full max-w-4xl rounded-2xl bg-surface shadow-2xl border border-border flex flex-col max-h-[90vh] overflow-hidden">
        {/* Top Control Bar (Hidden during print) */}
        <div className="flex items-center justify-between border-b border-border bg-surface-muted/50 px-6 py-4 print:hidden">
          <div className="flex items-center gap-2">
            <Printer className="size-5 text-brand" />
            <h2 className="text-base font-bold text-ink">Quotation Document Preview</h2>
            <span className="text-xs text-ink-subtle">({headerData.quoteNumber || 'Draft'})</span>
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" variant="primary" size="sm" onClick={handlePrint} className="gap-2">
              <Printer className="size-4" />
              Print / Save as PDF
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Printable Document Body */}
        <div className="flex-1 overflow-y-auto p-8 sm:p-12 print:p-0 print:overflow-visible bg-white text-slate-900 scrollbar-thin">
          <div id="quotation-print-sheet" className="space-y-8 max-w-3xl mx-auto">
            {/* Header: Company & Quote Info */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6 border-b border-slate-200 pb-6">
              <div>
                <div className="flex items-center gap-2">
                  <div className="grid size-9 place-items-center rounded-lg bg-slate-900 text-white font-bold text-lg">
                    CRM
                  </div>
                  <span className="text-xl font-extrabold tracking-tight text-slate-900">
                    {organizationName}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500 max-w-xs leading-relaxed">
                  Enterprise Cloud & AI Solutions
                  <br />
                  100 Tech Boulevard, Suite 500
                  <br />
                  contact@aicrm.io • +1 (800) 555-0199
                </p>
              </div>

              <div className="text-left sm:text-right space-y-1">
                <h1 className="text-2xl font-black tracking-tight text-slate-900 uppercase">
                  Quotation
                </h1>
                <p className="font-mono text-sm font-semibold text-slate-700">
                  {headerData.quoteNumber || 'QT-DRAFT'}
                </p>
                <div className="pt-2 text-xs text-slate-500 space-y-0.5">
                  <p>
                    <strong className="text-slate-700">Date:</strong>{' '}
                    {new Date().toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                  {headerData.validUntil && (
                    <p>
                      <strong className="text-slate-700">Valid Until:</strong>{' '}
                      {new Date(headerData.validUntil).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  )}
                  <p>
                    <strong className="text-slate-700">Payment Terms:</strong>{' '}
                    <span className="uppercase">{headerData.paymentTerms.replace('_', ' ')}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Recipient / Bill To */}
            <div className="grid sm:grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-200/80 text-xs">
              <div>
                <span className="font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Prepared For:
                </span>
                <p className="text-sm font-bold text-slate-900">
                  {headerData.customerName || 'Valued Customer'}
                </p>
                {headerData.customerEmail && (
                  <p className="text-slate-600 mt-0.5">{headerData.customerEmail}</p>
                )}
              </div>

              <div>
                <span className="font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Quotation Subject:
                </span>
                <p className="text-sm font-semibold text-slate-800">
                  {headerData.title || 'Untitled Deliverable Scope'}
                </p>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider">
                    <th className="py-2.5 px-3 w-8 text-center">#</th>
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-3 w-16 text-right">Qty</th>
                    <th className="py-2.5 px-3 w-20">UoM</th>
                    <th className="py-2.5 px-3 w-24 text-right">Unit Price</th>
                    <th className="py-2.5 px-3 w-16 text-right">Disc.</th>
                    <th className="py-2.5 px-3 w-16">Tax</th>
                    <th className="py-2.5 px-3 w-28 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {items.map((item) => {
                    if (item.type === 'section') {
                      return (
                        <tr key={item.id} className="bg-slate-50 font-bold text-slate-900">
                          <td className="py-2 px-3 text-center">•</td>
                          <td colSpan={7} className="py-2 px-3 tracking-wide">
                            {item.description}
                          </td>
                        </tr>
                      );
                    }

                    if (item.type === 'note') {
                      return (
                        <tr key={item.id} className="bg-slate-50/50 italic text-slate-600">
                          <td className="py-1.5 px-3 text-center"></td>
                          <td colSpan={7} className="py-1.5 px-3">
                            {item.description}
                          </td>
                        </tr>
                      );
                    }

                    productIdx += 1;
                    const qty = Number(item.quantity) || 1;
                    const price = Number(item.unitPrice) || 0;
                    const disc = Number(item.discount) || 0;
                    const subtotal = item.subtotal ?? qty * price * (1 - disc / 100);

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-3 text-center text-slate-400 font-mono">
                          {productIdx}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {item.description}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                          {qty}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">{item.uom || 'Units'}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                          {formatCurrency(price, currency)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                          {disc > 0 ? `${disc}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">
                          {item.taxRate ? `${item.taxRate}%` : '0%'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-slate-900 tabular-nums">
                          {formatCurrency(subtotal, currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Financial Summary Breakdown */}
            <div className="flex justify-end pt-2">
              <div className="w-72 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Untaxed Amount:</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {formatCurrency(totals.subtotalAmount, currency)}
                  </span>
                </div>

                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>Discount Applied:</span>
                    <span className="tabular-nums">
                      -{formatCurrency(totals.discountAmount, currency)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between text-slate-600">
                  <span>Taxes:</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {formatCurrency(totals.taxAmount, currency)}
                  </span>
                </div>

                <div className="border-t-2 border-slate-900 pt-2 flex justify-between text-sm font-black text-slate-900">
                  <span>Grand Total ({currency}):</span>
                  <span className="tabular-nums text-base">
                    {formatCurrency(totals.totalAmount, currency)}
                  </span>
                </div>
              </div>
            </div>

            {/* Terms & Conditions */}
            {termsAndConditions && (
              <div className="border-t border-slate-200 pt-5 space-y-1.5 text-xs text-slate-600">
                <h4 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                  Terms & Conditions
                </h4>
                <p className="leading-relaxed whitespace-pre-wrap">{termsAndConditions}</p>
              </div>
            )}

            {/* Client Signature Acceptance Block */}
            <div className="border-t border-slate-200 pt-8 mt-8">
              <div className="grid grid-cols-2 gap-12 text-xs text-slate-600">
                <div className="space-y-8">
                  <p className="font-medium text-slate-700">
                    For <strong className="text-slate-900">{organizationName}</strong>:
                  </p>
                  <div className="border-b border-slate-400 pt-4"></div>
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Authorized Signature</span>
                    <span>Date</span>
                  </div>
                </div>

                <div className="space-y-8">
                  <p className="font-medium text-slate-700">
                    Accepted by <strong className="text-slate-900">{headerData.customerName || 'Client'}</strong>:
                  </p>
                  <div className="border-b border-slate-400 pt-4"></div>
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Client Signature / Stamp</span>
                    <span>Date</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
