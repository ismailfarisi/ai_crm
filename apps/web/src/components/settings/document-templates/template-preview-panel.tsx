'use client';

import { useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import type { DocumentTemplateConfig, DocumentType } from '@saas/shared';
import { Button } from '@/components/ui/button';

interface TemplatePreviewPanelProps {
  config: DocumentTemplateConfig;
  onDownloadPdf?: (docType: DocumentType) => Promise<Blob | void>;
}

const DOCUMENT_TABS: { type: DocumentType; label: string }[] = [
  { type: 'INVOICE', label: 'Invoice' },
  { type: 'QUOTE', label: 'Quote' },
  { type: 'STATEMENT', label: 'Statement' },
  { type: 'DELIVERY_NOTE', label: 'Delivery Note' },
  { type: 'PURCHASE_ORDER', label: 'Purchase Order' },
];

export function TemplatePreviewPanel({ config, onDownloadPdf }: TemplatePreviewPanelProps) {
  const [activeType, setActiveType] = useState<DocumentType>('INVOICE');
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!onDownloadPdf) return;
    setIsDownloading(true);
    try {
      const blob = await onDownloadPdf(activeType);
      if (blob instanceof Blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeType.toLowerCase()}-preview.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const primaryColor = config.branding.primaryColor || '#1e3a8a';
  const secondaryColor = config.branding.secondaryColor || '#64748b';
  const density = config.branding.layoutDensity || 'normal';
  const fontFamilyClass =
    config.branding.fontFamily === 'Courier'
      ? 'font-mono'
      : config.branding.fontFamily === 'Times-Roman'
      ? 'font-serif'
      : 'font-sans';

  const densityPadding =
    density === 'compact' ? 'p-6 space-y-4' : density === 'relaxed' ? 'p-10 space-y-8' : 'p-8 space-y-6';

  const tableDensity = density === 'compact' ? 'py-1.5 px-2' : density === 'relaxed' ? 'py-3 px-3' : 'py-2 px-2.5';

  const docTitleMap: Record<DocumentType, string> = {
    INVOICE: config.header.customLabels?.invoice || 'TAX INVOICE',
    QUOTE: config.header.customLabels?.quote || 'QUOTATION',
    STATEMENT: config.header.customLabels?.statement || 'STATEMENT OF ACCOUNT',
    DELIVERY_NOTE: config.header.customLabels?.deliveryNote || 'DELIVERY NOTE',
    PURCHASE_ORDER: config.header.customLabels?.purchaseOrder || 'PURCHASE ORDER',
  };

  const docNumberMap: Record<DocumentType, string> = {
    INVOICE: 'INV-2026-0042',
    QUOTE: 'QUO-2026-0019',
    STATEMENT: 'STM-2026-08',
    DELIVERY_NOTE: 'DEL-2026-0088',
    PURCHASE_ORDER: 'PO-2026-0155',
  };

  return (
    <div className="flex flex-col h-full rounded-2xl border border-border/30 bg-surface/50 backdrop-blur-xs overflow-hidden shadow-xs">
      {/* Header bar with Document Tabs and Download Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/25 bg-surface-muted/30 px-5 py-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {DOCUMENT_TABS.map((tab) => {
            const isActive = activeType === tab.type;
            return (
              <button
                key={tab.type}
                type="button"
                onClick={() => setActiveType(tab.type)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-surface text-ink font-semibold shadow-xs border border-border/40'
                    : 'text-ink-muted hover:text-ink hover:bg-surface/50'
                }`}
              >
                <FileText className="size-3.5" style={{ color: isActive ? primaryColor : undefined }} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {onDownloadPdf && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={isDownloading}
            className="text-xs shrink-0"
          >
            {isDownloading ? (
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
            ) : (
              <Download className="size-3.5 mr-1.5" />
            )}
            Download PDF Preview
          </Button>
        )}
      </div>

      {/* Live Interactive Document Paper Area */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 bg-surface-muted/20 flex justify-center items-start">
        <div
          className={`w-full max-w-3xl bg-white text-slate-800 rounded-lg shadow-md border border-slate-200 transition-all ${fontFamilyClass} ${densityPadding}`}
          style={{ minHeight: '750px' }}
        >
          {/* Header Layout */}
          {config.header.layout === 'banner' && (
            <div
              className="-mx-8 -mt-8 mb-6 p-6 rounded-t-lg flex justify-between items-center text-white"
              style={{ backgroundColor: primaryColor }}
            >
              <div className="flex items-center gap-3">
                {config.header.showLogo && (
                  <div className="size-10 rounded bg-white/20 flex items-center justify-center font-bold text-white text-sm">
                    LOGO
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-bold">Acme Corp Global</h2>
                  <p className="text-xs text-white/80">Premium Manufacturing & Supply</p>
                </div>
              </div>
              <div className="text-right">
                <h1 className="text-xl font-black uppercase tracking-wider">{docTitleMap[activeType]}</h1>
                <p className="text-xs font-mono text-white/90 font-medium">{docNumberMap[activeType]}</p>
              </div>
            </div>
          )}

          {config.header.layout === 'centered' && (
            <div className="text-center pb-5 border-b border-slate-100">
              {config.header.showLogo && (
                <div
                  className="mx-auto mb-2 size-12 rounded-lg flex items-center justify-center font-bold text-white text-sm"
                  style={{ backgroundColor: primaryColor }}
                >
                  LOGO
                </div>
              )}
              <h2 className="text-base font-bold text-slate-900">Acme Corp Global</h2>
              <h1 className="text-xl font-extrabold uppercase mt-1" style={{ color: primaryColor }}>
                {docTitleMap[activeType]}
              </h1>
              <p className="text-xs font-mono text-slate-500 font-semibold">{docNumberMap[activeType]}</p>
              <div className="mt-2 text-[11px] text-slate-500 flex flex-wrap justify-center gap-x-4">
                {config.header.showCompanyAddress && <span>742 Industrial Pkwy, Austin, TX 78701</span>}
                {config.header.showCompanyPhone && <span>+1 (512) 555-0199</span>}
                {config.header.showCompanyEmail && <span>billing@acmecorp.com</span>}
                {config.header.showCompanyTaxId && <span>Tax ID: US-99238411</span>}
              </div>
            </div>
          )}

          {config.header.layout === 'split' && (
            <div className="flex justify-between items-start pb-5 border-b border-slate-100">
              <div className="flex items-start gap-3">
                {config.header.showLogo && (
                  <div
                    className="size-11 rounded-lg flex items-center justify-center font-bold text-white text-xs shrink-0"
                    style={{ backgroundColor: primaryColor }}
                  >
                    LOGO
                  </div>
                )}
                <div className="space-y-0.5">
                  <h2 className="text-base font-bold text-slate-900">Acme Corp Global</h2>
                  {config.header.showCompanyAddress && (
                    <p className="text-[11px] text-slate-500">742 Industrial Pkwy, Austin, TX 78701</p>
                  )}
                  <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3">
                    {config.header.showCompanyPhone && <span>+1 (512) 555-0199</span>}
                    {config.header.showCompanyEmail && <span>billing@acmecorp.com</span>}
                  </div>
                  {config.header.showCompanyTaxId && (
                    <p className="text-[11px] text-slate-400">Tax ID: US-99238411</p>
                  )}
                </div>
              </div>

              <div className="text-right">
                <h1 className="text-xl font-extrabold uppercase" style={{ color: primaryColor }}>
                  {docTitleMap[activeType]}
                </h1>
                <p className="text-xs font-mono font-semibold text-slate-600 mt-0.5">{docNumberMap[activeType]}</p>
                <div className="text-[11px] text-slate-500 mt-2 space-y-0.5">
                  <p>Issue Date: {new Date().toLocaleDateString()}</p>
                  {activeType === 'INVOICE' && <p>Due Date: {new Date(Date.now() + 30 * 86400000).toLocaleDateString()}</p>}
                  {activeType === 'QUOTE' && <p>Valid Until: {new Date(Date.now() + 14 * 86400000).toLocaleDateString()}</p>}
                  {activeType === 'STATEMENT' && <p>Period: Last 30 Days</p>}
                </div>
              </div>
            </div>
          )}

          {/* Parties Section */}
          <div className="grid grid-cols-2 gap-6 pt-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: secondaryColor }}>
                {activeType === 'PURCHASE_ORDER'
                  ? config.parties.supplierLabel || 'Vendor'
                  : config.parties.billToLabel || 'Bill To'}
              </p>
              <p className="font-semibold text-xs text-slate-900">
                {activeType === 'PURCHASE_ORDER' ? 'Pulp & Board Paper Mill Co.' : 'Apex Industrial Supplies LLC'}
              </p>
              {config.parties.showAddress && (
                <p className="text-[11px] text-slate-500 mt-0.5">100 Logistics Way, Suite 400, Chicago, IL 60601</p>
              )}
              {config.parties.showEmail && (
                <p className="text-[11px] text-slate-500">accounts@apexsupplies.example</p>
              )}
              {config.parties.showPhone && <p className="text-[11px] text-slate-500">+1 (312) 555-0144</p>}
              {config.parties.showTaxId && <p className="text-[11px] text-slate-400">VAT/Tax ID: US-44556677</p>}
            </div>

            {activeType === 'DELIVERY_NOTE' && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: secondaryColor }}>
                  {config.parties.shipToLabel || 'Ship To'}
                </p>
                <p className="font-semibold text-xs text-slate-900">Apex Receiving Dock #4</p>
                <p className="text-[11px] text-slate-500 mt-0.5">900 Freightway Blvd, Bay 12, Chicago, IL 60602</p>
                <p className="text-[11px] text-slate-500">Carrier: Express Ground Freight</p>
                <p className="text-[11px] font-mono text-slate-600">Tracking: EXP-98234-US</p>
              </div>
            )}
          </div>

          {/* Statement Summary Box if STATEMENT */}
          {activeType === 'STATEMENT' && (
            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-600">Opening Balance: <strong className="text-slate-800">$450.00</strong></span>
                <span className="text-slate-600">Invoices: <strong className="text-slate-800">$1,348.11</strong></span>
                <span className="text-slate-600">Payments: <strong className="text-emerald-700">-$500.00</strong></span>
                <span className="text-slate-900 font-bold">Closing Balance: $1,298.11</span>
              </div>
              <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-200 text-center text-[10px]">
                <div className="bg-white p-1.5 rounded border border-slate-200">
                  <p className="text-slate-500 font-medium">Current</p>
                  <p className="font-bold text-slate-800">$848.11</p>
                </div>
                <div className="bg-white p-1.5 rounded border border-slate-200">
                  <p className="text-slate-500 font-medium">1-30 Days</p>
                  <p className="font-bold text-slate-800">$300.00</p>
                </div>
                <div className="bg-white p-1.5 rounded border border-slate-200">
                  <p className="text-slate-500 font-medium">31-60 Days</p>
                  <p className="font-bold text-amber-700">$150.00</p>
                </div>
                <div className="bg-white p-1.5 rounded border border-slate-200">
                  <p className="text-slate-500 font-medium">90+ Days</p>
                  <p className="font-bold text-slate-400">$0.00</p>
                </div>
              </div>
            </div>
          )}

          {/* Items Table */}
          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-left border-collapse text-xs">
              <thead
                style={{
                  backgroundColor: config.itemsTable.headerBackgroundColor || primaryColor,
                  color: config.itemsTable.headerTextColor || '#ffffff',
                }}
              >
                <tr>
                  {config.itemsTable.showItemCode && <th className={`${tableDensity} font-semibold w-24`}>Code</th>}
                  {config.itemsTable.showDescription && <th className={`${tableDensity} font-semibold`}>Description</th>}
                  {config.itemsTable.showQuantity && <th className={`${tableDensity} font-semibold text-right w-16`}>Qty</th>}
                  {config.itemsTable.showUnitPrice && <th className={`${tableDensity} font-semibold text-right w-20`}>Unit Price</th>}
                  {config.itemsTable.showDiscount && <th className={`${tableDensity} font-semibold text-right w-16`}>Disc %</th>}
                  {config.itemsTable.showTaxRate && <th className={`${tableDensity} font-semibold text-right w-16`}>Tax %</th>}
                  {config.itemsTable.showLineTotal && <th className={`${tableDensity} font-semibold text-right w-24`}>Total</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  {
                    code: 'COR-BX-12',
                    desc: 'Custom Rigid Corrugated Box (12" x 12" x 8")',
                    qty: 250,
                    price: 3.25,
                    disc: 0,
                    tax: 8.5,
                    total: 812.5,
                  },
                  {
                    code: 'FMS-INS-02',
                    desc: 'High-Density Anti-Static Foam Inserts',
                    qty: 250,
                    price: 1.2,
                    disc: 20,
                    tax: 8.5,
                    total: 240.0,
                  },
                  {
                    code: 'PRT-SPOT-UV',
                    desc: 'Spot UV Finish & Custom Exterior Logo Lamination',
                    qty: 1,
                    price: 150.0,
                    disc: 0,
                    tax: 8.5,
                    total: 150.0,
                  },
                ].map((row, idx) => (
                  <tr
                    key={row.code}
                    className={
                      config.itemsTable.zebraStriping && idx % 2 === 1
                        ? 'bg-slate-50/80'
                        : 'bg-white'
                    }
                  >
                    {config.itemsTable.showItemCode && (
                      <td className={`${tableDensity} font-mono text-[11px] text-slate-500`}>{row.code}</td>
                    )}
                    {config.itemsTable.showDescription && (
                      <td className={`${tableDensity} font-medium text-slate-800`}>{row.desc}</td>
                    )}
                    {config.itemsTable.showQuantity && (
                      <td className={`${tableDensity} text-right text-slate-600`}>{row.qty}</td>
                    )}
                    {config.itemsTable.showUnitPrice && (
                      <td className={`${tableDensity} text-right text-slate-600`}>${row.price.toFixed(2)}</td>
                    )}
                    {config.itemsTable.showDiscount && (
                      <td className={`${tableDensity} text-right text-slate-500`}>
                        {row.disc > 0 ? `${row.disc}%` : '-'}
                      </td>
                    )}
                    {config.itemsTable.showTaxRate && (
                      <td className={`${tableDensity} text-right text-slate-500`}>{row.tax}%</td>
                    )}
                    {config.itemsTable.showLineTotal && (
                      <td className={`${tableDensity} text-right font-medium text-slate-800`}>
                        ${row.total.toFixed(2)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals Section */}
          <div className="flex justify-end pt-1">
            <div className="w-64 space-y-1.5 text-xs">
              {config.totals.showSubtotal && (
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span>$1,202.50</span>
                </div>
              )}
              {config.totals.showDiscountTotal && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount:</span>
                  <span>-$60.00</span>
                </div>
              )}
              {config.totals.showTaxSummary && (
                <div className="flex justify-between text-slate-600">
                  <span>Estimated Tax (8.5%):</span>
                  <span>$97.11</span>
                </div>
              )}
              <div
                className={`flex justify-between py-2 border-t font-bold ${
                  config.totals.highlightTotal ? 'px-2 rounded' : ''
                }`}
                style={
                  config.totals.highlightTotal
                    ? { backgroundColor: `${primaryColor}15`, color: primaryColor }
                    : { borderColor: '#e2e8f0', color: '#0f172a' }
                }
              >
                <span className="text-sm">Total Due:</span>
                <span className="text-sm">$1,239.61</span>
              </div>
              {config.totals.showAmountPaid && (
                <div className="flex justify-between text-slate-600 text-[11px]">
                  <span>Amount Paid:</span>
                  <span>$500.00</span>
                </div>
              )}
              {config.totals.showBalanceDue && (
                <div className="flex justify-between font-semibold text-slate-900 text-xs border-t border-slate-100 pt-1">
                  <span>Balance Due:</span>
                  <span style={{ color: primaryColor }}>$739.61</span>
                </div>
              )}
            </div>
          </div>

          {/* Footer Section */}
          <div className="pt-6 border-t border-slate-100 space-y-4 text-[11px] text-slate-500">
            {config.footer.paymentTerms && (
              <div>
                <p className="font-semibold text-slate-700">Payment Terms</p>
                <p className="mt-0.5">{config.footer.paymentTerms}</p>
              </div>
            )}

            {config.footer.bankDetails &&
              (config.footer.bankDetails.bankName || config.footer.bankDetails.accountNumber) && (
                <div className="rounded border border-slate-100 bg-slate-50/50 p-2.5 space-y-1">
                  <p className="font-semibold text-slate-700">Bank & Wire Transfer Details</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
                    {config.footer.bankDetails.bankName && (
                      <p>Bank: <span className="font-medium text-slate-800">{config.footer.bankDetails.bankName}</span></p>
                    )}
                    {config.footer.bankDetails.accountName && (
                      <p>Beneficiary: <span className="font-medium text-slate-800">{config.footer.bankDetails.accountName}</span></p>
                    )}
                    {config.footer.bankDetails.accountNumber && (
                      <p>Account #: <span className="font-mono text-slate-800">{config.footer.bankDetails.accountNumber}</span></p>
                    )}
                    {config.footer.bankDetails.routingOrIban && (
                      <p>Routing / IBAN: <span className="font-mono text-slate-800">{config.footer.bankDetails.routingOrIban}</span></p>
                    )}
                    {config.footer.bankDetails.swiftBic && (
                      <p>SWIFT/BIC: <span className="font-mono text-slate-800">{config.footer.bankDetails.swiftBic}</span></p>
                    )}
                  </div>
                </div>
              )}

            {config.footer.notes && (
              <div>
                <p className="font-semibold text-slate-700">Notes</p>
                <p className="mt-0.5 text-slate-500">{config.footer.notes}</p>
              </div>
            )}

            {config.footer.showSignatureBlock && (
              <div className="pt-4 flex justify-between items-end">
                <div className="w-56">
                  <div className="border-b border-slate-400 h-8" />
                  <p className="mt-1 text-[10px] text-slate-600 font-medium">
                    {config.footer.signatureLabel || 'Authorized Signature'}
                  </p>
                </div>
                <div className="w-36">
                  <div className="border-b border-slate-400 h-8" />
                  <p className="mt-1 text-[10px] text-slate-600 font-medium">Date</p>
                </div>
              </div>
            )}

            {config.footer.showPageNumbers && (
              <div className="text-center text-[10px] text-slate-400 pt-2 border-t border-slate-50">
                Page 1 of 1
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
