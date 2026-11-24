'use client';

import { useState, type ReactNode } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import {
  DOCUMENT_LABELS,
  DOCUMENT_TIME_ZONE,
  documentLabel,
  isRtlDocument,
  localizedLabel,
  toArabicIndicDigits,
  type DocumentLabelKey,
  type DocumentTemplateConfig,
  type DocumentType,
} from '@saas/shared';
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

/**
 * The sample the preview is drawn with. Meridian Packaging Co is the demo
 * company; Al Noor Sweets is the demo customer. Every figure on the page is
 * worked out from these rows, so the arithmetic always adds up.
 */
export interface SampleLine {
  code: string;
  description: string;
  /** Shown on Arabic and bilingual previews. */
  descriptionAr?: string;
  quantity: number;
  unitPrice: number;
  /** Percent off the line. */
  discount: number;
  /** VAT percent. */
  taxRate: number;
}

export const SAMPLE_CURRENCY = 'AED';
export const SAMPLE_VAT_RATE = 5;

export const SAMPLE_SELLER = {
  name: 'Meridian Packaging Co',
  nameAr: 'ميريديان للتغليف',
  addressAr: 'قطعة 14، المنطقة الصناعية 13، الشارقة، الإمارات',
  tagline: 'Rigid boxes, cartons and print finishing',
  address: 'Plot 14, Industrial Area 13, Sharjah, UAE',
  phone: '+971 6 555 0142',
  email: 'accounts@meridianpackaging.example',
  trn: '100234567800003',
};

const SAMPLE_CUSTOMER = {
  name: 'Al Noor Sweets',
  nameAr: 'حلويات النور',
  addressAr: 'مستودع 7، القصيص الصناعية 2، دبي، الإمارات',
  address: 'Warehouse 7, Al Qusais Industrial Area 2, Dubai, UAE',
  email: 'accounts@alnoorsweets.example',
  phone: '+971 4 555 0186',
  trn: '100398765400003',
};

const SAMPLE_SUPPLIER = {
  name: 'Gulf Board Trading LLC',
  nameAr: 'الخليج لتجارة الكرتون ذ.م.م',
  addressAr: 'مستودع 22، الجرف الصناعية 2، عجمان، الإمارات',
  address: 'Warehouse 22, Al Jurf Industrial Area 2, Ajman, UAE',
  email: 'orders@gulfboard.example',
  phone: '+971 6 555 0177',
  trn: '100456789100003',
};

const SALES_LINES: SampleLine[] = [
  {
    code: 'RB-200-GF',
    description: 'Rigid box 200×150×60, gold foil lid',
    descriptionAr: 'علبة صلبة 200×150×60، غطاء بختم ذهبي',
    quantity: 5000,
    unitPrice: 4.6,
    discount: 0,
    taxRate: SAMPLE_VAT_RATE,
  },
  {
    code: 'EVA-2C',
    description: 'EVA foam insert, 2 cavities',
    descriptionAr: 'حشوة إسفنج EVA، تجويفان',
    quantity: 5000,
    unitPrice: 0.85,
    discount: 0,
    taxRate: SAMPLE_VAT_RATE,
  },
  {
    code: 'SLV-MATT',
    description: 'Printed paper sleeve, matt lamination',
    descriptionAr: 'غلاف ورقي مطبوع، تغليف مطفي',
    quantity: 5000,
    unitPrice: 0.4,
    discount: 5,
    taxRate: SAMPLE_VAT_RATE,
  },
];

const PURCHASE_LINES: SampleLine[] = [
  {
    code: 'GB-1200',
    description: 'Greyboard 1200 gsm, 700×1000 sheet',
    descriptionAr: 'كرتون رمادي 1200 غ/م²، لوح 700×1000',
    quantity: 2400,
    unitPrice: 3.15,
    discount: 0,
    taxRate: SAMPLE_VAT_RATE,
  },
  {
    code: 'ART-157',
    description: 'Art paper 157 gsm wrap, 700×1000 sheet',
    descriptionAr: 'ورق آرت 157 غ/م² للتغليف، لوح 700×1000',
    quantity: 2600,
    unitPrice: 0.95,
    discount: 10,
    taxRate: SAMPLE_VAT_RATE,
  },
];

/** The advance Al Noor paid against the sample invoice. */
const SAMPLE_AMOUNT_PAID = 15000;
/** What Al Noor owed before the sample invoice, all of it 1–30 days old. */
const SAMPLE_OPENING_BALANCE = 4200;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Before the line's discount. */
export const lineGross = (line: SampleLine) => round2(line.quantity * line.unitPrice);
/** After the line's discount, before VAT: the figure in the line's Total column. */
export const lineNet = (line: SampleLine) => round2(lineGross(line) * (1 - line.discount / 100));

/**
 * The totals block, worked out once from the rows. The line Total column is
 * already net of each line's discount, so the subtotal shown above a
 * Discount row is the gross (before discounts); without that row it is the
 * sum of the line totals. Either way the page adds up as printed.
 */
export function sampleTotals(lines: SampleLine[], amountPaid = 0) {
  const gross = round2(lines.reduce((sum, line) => sum + lineGross(line), 0));
  const net = round2(lines.reduce((sum, line) => sum + lineNet(line), 0));
  const discounts = round2(gross - net);
  const tax = round2(lines.reduce((sum, line) => sum + lineNet(line) * (line.taxRate / 100), 0));
  const total = round2(net + tax);
  return { gross, net, discounts, tax, total, amountPaid, balanceDue: round2(total - amountPaid) };
}

const money = new Intl.NumberFormat('en-AE', { style: 'currency', currency: SAMPLE_CURRENCY });
const formatMoney = (amount: number) => money.format(amount);
const unitMoney = new Intl.NumberFormat('en-AE', {
  style: 'currency',
  currency: SAMPLE_CURRENCY,
  maximumFractionDigits: 4,
});
const formatDate = (offsetDays = 0, arabic = false) =>
  new Date(Date.now() + offsetDays * 86400000).toLocaleDateString(arabic ? 'ar-AE-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: DOCUMENT_TIME_ZONE,
  });

/*
 * The paper is drawn in the PDF renderer's own print palette (white sheet,
 * slate greys, the template's brand colours) rather than the app's tokens: it
 * stands in for the printed document, which stays white in dark mode.
 */
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
  // The banner bleeds to the sheet's edge, so it pulls back the same padding.
  const bannerBleed = density === 'compact' ? '-mx-6 -mt-6' : density === 'relaxed' ? '-mx-10 -mt-10' : '-mx-8 -mt-8';

  const tableDensity = density === 'compact' ? 'py-1.5 px-2' : density === 'relaxed' ? 'py-3 px-3' : 'py-2 px-2.5';

  const language = config.localization?.language ?? 'en';
  const rtl = isRtlDocument(language);
  const toDigits = (text: string) =>
    language !== 'en' && config.localization?.digits === 'arabic-indic' ? toArabicIndicDigits(text) : text;
  const fmt = (amount: number, unit = false) =>
    toDigits(unit ? unitMoney.format(amount) : formatMoney(amount));
  const date = (offsetDays = 0) => toDigits(formatDate(offsetDays, language === 'ar'));
  // English previews keep the studio's own wording; Arabic and bilingual ones
  // use the labels the PDF prints.
  const lbl = (english: string, key: DocumentLabelKey) =>
    language === 'en' ? english : documentLabel(key, language);
  const both = (english: string, arabic?: string): ReactNode => {
    if (language === 'en' || !arabic) return english;
    if (language === 'ar') return arabic;
    return (
      <>
        {english}
        <span className="block" lang="ar" dir="rtl">
          {arabic}
        </span>
      </>
    );
  };

  const docTitleMap: Record<DocumentType, string> = {
    INVOICE: config.header.customLabels?.invoice || 'TAX INVOICE',
    QUOTE: config.header.customLabels?.quote || 'QUOTATION',
    STATEMENT: config.header.customLabels?.statement || 'STATEMENT OF ACCOUNT',
    DELIVERY_NOTE: config.header.customLabels?.deliveryNote || 'DELIVERY NOTE',
    PURCHASE_ORDER: config.header.customLabels?.purchaseOrder || 'PURCHASE ORDER',
  };
  const arabicTitles: Record<DocumentType, string> = {
    INVOICE: DOCUMENT_LABELS.taxInvoice.ar,
    QUOTE: DOCUMENT_LABELS.quote.ar,
    STATEMENT: DOCUMENT_LABELS.statement.ar,
    DELIVERY_NOTE: DOCUMENT_LABELS.deliveryNote.ar,
    PURCHASE_ORDER: DOCUMENT_LABELS.purchaseOrder.ar,
  };
  const docTitle = both(docTitleMap[activeType], arabicTitles[activeType]);

  const docNumberMap: Record<DocumentType, string> = {
    INVOICE: 'INV-2026-0042',
    QUOTE: 'QUO-2026-0019',
    STATEMENT: 'STM-2026-08',
    DELIVERY_NOTE: 'DEL-2026-0088',
    PURCHASE_ORDER: 'PO-2026-0155',
  };

  const isPurchase = activeType === 'PURCHASE_ORDER';
  const party = isPurchase ? SAMPLE_SUPPLIER : SAMPLE_CUSTOMER;
  const lines = isPurchase ? PURCHASE_LINES : SALES_LINES;
  const showsPayment = activeType === 'INVOICE';
  const totals = sampleTotals(lines, showsPayment ? SAMPLE_AMOUNT_PAID : 0);
  const showDiscountRow = config.totals.showDiscountTotal && totals.discounts > 0;
  // With the Discount row the subtotal is before discounts; without it, the
  // sum of the line totals, so the column above still adds up.
  const subtotal = showDiscountRow ? totals.gross : totals.net;

  // The sample statement: what was owed before, this invoice, the advance paid.
  const invoiceTotal = sampleTotals(SALES_LINES).total;
  const closingBalance = round2(SAMPLE_OPENING_BALANCE + invoiceTotal - SAMPLE_AMOUNT_PAID);
  const agedCurrent = round2(invoiceTotal - SAMPLE_AMOUNT_PAID);

  return (
    <div className="flex flex-col h-full rounded-2xl border border-border/60 bg-surface overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.015)]">
      {/* Header bar with Document Tabs and Download Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-surface-muted px-5 py-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {DOCUMENT_TABS.map((tab) => {
            const isActive = activeType === tab.type;
            return (
              <button
                key={tab.type}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveType(tab.type)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring ${
                  isActive
                    ? 'bg-surface text-ink font-semibold shadow-xs border border-border'
                    : 'text-ink-muted hover:text-ink hover:bg-surface'
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
              <Loader2 className="size-3.5 animate-spin me-1.5" />
            ) : (
              <Download className="size-3.5 me-1.5" />
            )}
            Download sample PDF
          </Button>
        )}
        <p className="w-full text-xs text-ink-muted">
          Sample figures: {SAMPLE_SELLER.name} (demo) {isPurchase ? `ordering from ${SAMPLE_SUPPLIER.name}` : `billing ${SAMPLE_CUSTOMER.name}`}, in {SAMPLE_CURRENCY} with {SAMPLE_VAT_RATE}% VAT.
        </p>
      </div>

      {/* Live Interactive Document Paper Area */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 bg-canvas flex justify-center items-start">
        <div
          data-testid="template-paper"
          dir={rtl ? 'rtl' : 'ltr'}
          lang={rtl ? 'ar' : 'en'}
          className={`w-full max-w-3xl bg-white text-slate-800 rounded-lg shadow-md border border-slate-200 transition-all ${fontFamilyClass} ${densityPadding}`}
          style={{ minHeight: '750px' }}
        >
          {/* Header Layout */}
          {config.header.layout === 'banner' && (
            <div
              className={`${bannerBleed} mb-6 p-6 rounded-t-lg flex justify-between items-center text-white`}
              style={{ backgroundColor: primaryColor }}
            >
              <div className="flex items-center gap-3">
                {config.header.showLogo && (
                  <div className="size-10 rounded bg-white/20 flex items-center justify-center font-bold text-white text-sm">
                    LOGO
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-bold">{both(SAMPLE_SELLER.name, SAMPLE_SELLER.nameAr)}</h2>
                  <p className="text-xs text-white/80">{SAMPLE_SELLER.tagline}</p>
                </div>
              </div>
              <div className="text-end">
                <h1 className="text-xl font-black uppercase tracking-wider">{docTitle}</h1>
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
              <h2 className="text-base font-bold text-slate-900">{both(SAMPLE_SELLER.name, SAMPLE_SELLER.nameAr)}</h2>
              <h1 className="text-xl font-extrabold uppercase mt-1" style={{ color: primaryColor }}>
                {docTitle}
              </h1>
              <p className="text-xs font-mono text-slate-500 font-semibold">{docNumberMap[activeType]}</p>
              <div className="mt-2 text-[11px] text-slate-500 flex flex-wrap justify-center gap-x-4">
                {config.header.showCompanyAddress && <span>{both(SAMPLE_SELLER.address, SAMPLE_SELLER.addressAr)}</span>}
                {config.header.showCompanyPhone && <span dir="ltr">{SAMPLE_SELLER.phone}</span>}
                {config.header.showCompanyEmail && <span dir="ltr">{SAMPLE_SELLER.email}</span>}
                {config.header.showCompanyTaxId && <span>{`${lbl('TRN', 'trn')} ${SAMPLE_SELLER.trn}`}</span>}
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
                  <h2 className="text-base font-bold text-slate-900">{both(SAMPLE_SELLER.name, SAMPLE_SELLER.nameAr)}</h2>
                  {config.header.showCompanyAddress && (
                    <p className="text-[11px] text-slate-500">{both(SAMPLE_SELLER.address, SAMPLE_SELLER.addressAr)}</p>
                  )}
                  <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3">
                    {config.header.showCompanyPhone && <span dir="ltr">{SAMPLE_SELLER.phone}</span>}
                    {config.header.showCompanyEmail && <span dir="ltr">{SAMPLE_SELLER.email}</span>}
                  </div>
                  {config.header.showCompanyTaxId && (
                    <p className="text-[11px] text-slate-500">{`${lbl('TRN', 'trn')} ${SAMPLE_SELLER.trn}`}</p>
                  )}
                </div>
              </div>

              <div className="text-end">
                <h1 className="text-xl font-extrabold uppercase" style={{ color: primaryColor }}>
                  {docTitle}
                </h1>
                <p className="text-xs font-mono font-semibold text-slate-600 mt-0.5">{docNumberMap[activeType]}</p>
                <div className="text-[11px] text-slate-500 mt-2 space-y-0.5 tabular-nums">
                  <p>{lbl('Issue date', 'issued')}: {date()}</p>
                  {activeType === 'INVOICE' && <p>{lbl('Due date', 'due')}: {date(30)}</p>}
                  {activeType === 'QUOTE' && <p>{lbl('Valid until', 'validUntil')}: {date(14)}</p>}
                  {activeType === 'STATEMENT' && <p>{lbl('Period: last 30 days', 'periodLast30')}</p>}
                </div>
              </div>
            </div>
          )}

          {/* Parties Section */}
          <div className="grid grid-cols-2 gap-6 pt-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: secondaryColor }}>
                {isPurchase
                  ? localizedLabel(config.parties.supplierLabel || 'Vendor', DOCUMENT_LABELS.vendor.ar, language)
                  : localizedLabel(config.parties.billToLabel || 'Bill To', DOCUMENT_LABELS.billTo.ar, language)}
              </p>
              <p className="font-semibold text-xs text-slate-900">{both(party.name, party.nameAr)}</p>
              {config.parties.showAddress && <p className="text-[11px] text-slate-500 mt-0.5">{both(party.address, party.addressAr)}</p>}
              {config.parties.showEmail && <p className="text-[11px] text-slate-500"><span dir="ltr">{party.email}</span></p>}
              {config.parties.showPhone && <p className="text-[11px] text-slate-500"><span dir="ltr">{party.phone}</span></p>}
              {config.parties.showTaxId && <p className="text-[11px] text-slate-500">{`${lbl('TRN', 'trn')} ${party.trn}`}</p>}
            </div>

            {activeType === 'DELIVERY_NOTE' && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: secondaryColor }}>
                  {localizedLabel(config.parties.shipToLabel || 'Ship To', DOCUMENT_LABELS.shipTo.ar, language)}
                </p>
                <p className="font-semibold text-xs text-slate-900">{both(`${SAMPLE_CUSTOMER.name}, receiving bay 2`, SAMPLE_CUSTOMER.nameAr)}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{both(SAMPLE_CUSTOMER.address, SAMPLE_CUSTOMER.addressAr)}</p>
                <p className="text-[11px] text-slate-500">{lbl('Carrier', 'carrier')}: own truck, DXB 4471</p>
              </div>
            )}
          </div>

          {/* Statement Summary Box if STATEMENT */}
          {activeType === 'STATEMENT' && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2 tabular-nums">
              <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 items-center text-xs">
                <span className="text-slate-600">{lbl('Opening balance', 'openingBalance')}: <strong className="text-slate-800">{fmt(SAMPLE_OPENING_BALANCE)}</strong></span>
                <span className="text-slate-600">{lbl('Invoices', 'invoices')}: <strong className="text-slate-800">{fmt(invoiceTotal)}</strong></span>
                <span className="text-slate-600">{lbl('Payments', 'payments')}: <strong className="text-slate-800">-{fmt(SAMPLE_AMOUNT_PAID)}</strong></span>
                <span className="text-slate-900 font-bold">{lbl('Closing balance', 'closingBalance')}: {fmt(closingBalance)}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-200 text-center text-[10px]">
                {[
                  [lbl('Current', 'agingCurrent'), agedCurrent],
                  [lbl('1–30 days', 'aging30'), SAMPLE_OPENING_BALANCE],
                  [lbl('31–60 days', 'aging60'), 0],
                  [lbl('Over 60 days', 'agingOver60'), 0],
                ].map(([label, amount]) => (
                  <div key={label} className="bg-white p-1.5 rounded border border-slate-200">
                    <p className="text-slate-500 font-medium">{label}</p>
                    <p className="font-bold text-slate-800">{fmt(amount as number)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Items Table */}
          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-start border-collapse text-xs">
              <thead
                style={{
                  backgroundColor: config.itemsTable.headerBackgroundColor || primaryColor,
                  color: config.itemsTable.headerTextColor || '#ffffff',
                }}
              >
                <tr>
                  {config.itemsTable.showItemCode && <th className={`${tableDensity} font-semibold w-24`}>{lbl('Code', 'itemCode')}</th>}
                  {config.itemsTable.showDescription && <th className={`${tableDensity} font-semibold`}>{lbl('Description', 'description')}</th>}
                  {config.itemsTable.showQuantity && <th className={`${tableDensity} font-semibold text-end w-16`}>{lbl('Qty', 'quantity')}</th>}
                  {config.itemsTable.showUnitPrice && <th className={`${tableDensity} font-semibold text-end w-24`}>{lbl('Unit Price', 'unitPrice')}</th>}
                  {config.itemsTable.showDiscount && <th className={`${tableDensity} font-semibold text-end w-16`}>{lbl('Disc %', 'discountPercent')}</th>}
                  {config.itemsTable.showTaxRate && <th className={`${tableDensity} font-semibold text-end w-16`}>{lbl('VAT %', 'taxPercent')}</th>}
                  {config.itemsTable.showLineTotal && <th className={`${tableDensity} font-semibold text-end w-28`}>{lbl('Amount', 'lineTotal')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {lines.map((row, idx) => (
                  <tr
                    key={row.code}
                    className={config.itemsTable.zebraStriping && idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'}
                  >
                    {config.itemsTable.showItemCode && (
                      <td className={`${tableDensity} font-mono text-[11px] text-slate-500`}>{row.code}</td>
                    )}
                    {config.itemsTable.showDescription && (
                      <td className={`${tableDensity} font-medium text-slate-800`}>{both(row.description, row.descriptionAr)}</td>
                    )}
                    {config.itemsTable.showQuantity && (
                      <td className={`${tableDensity} text-end text-slate-600`}>{toDigits(row.quantity.toLocaleString('en-AE'))}</td>
                    )}
                    {config.itemsTable.showUnitPrice && (
                      <td className={`${tableDensity} text-end text-slate-600`}>{fmt(row.unitPrice, true)}</td>
                    )}
                    {config.itemsTable.showDiscount && (
                      <td className={`${tableDensity} text-end text-slate-500`}>
                        {row.discount > 0 ? toDigits(`${row.discount}%`) : '-'}
                      </td>
                    )}
                    {config.itemsTable.showTaxRate && (
                      <td className={`${tableDensity} text-end text-slate-500`}>{toDigits(`${row.taxRate}%`)}</td>
                    )}
                    {config.itemsTable.showLineTotal && (
                      <td className={`${tableDensity} text-end font-medium text-slate-800`}>
                        {fmt(lineNet(row))}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals Section */}
          <div className="flex justify-end pt-1">
            <div data-testid="template-totals" className="w-72 space-y-1.5 text-xs tabular-nums">
              {config.totals.showSubtotal && (
                <div className="flex justify-between text-slate-600">
                  <span>{lbl('Subtotal', 'subtotal')}:</span>
                  <span>{fmt(subtotal)}</span>
                </div>
              )}
              {showDiscountRow && (
                <div className="flex justify-between text-slate-600">
                  <span>{lbl('Discount', 'discount')}:</span>
                  <span>-{fmt(totals.discounts)}</span>
                </div>
              )}
              {config.totals.showTaxSummary && (
                <div className="flex justify-between text-slate-600">
                  <span>{lbl('VAT', 'vat')} ({toDigits(`${SAMPLE_VAT_RATE}%`)}):</span>
                  <span>{fmt(totals.tax)}</span>
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
                <span className="text-sm">{lbl('Total', 'total')}:</span>
                <span className="text-sm">{fmt(totals.total)}</span>
              </div>
              {showsPayment && config.totals.showAmountPaid && (
                <div className="flex justify-between text-slate-600 text-[11px]">
                  <span>{lbl('Amount paid', 'amountPaid')}:</span>
                  <span>{fmt(totals.amountPaid)}</span>
                </div>
              )}
              {showsPayment && config.totals.showBalanceDue && (
                <div className="flex justify-between font-semibold text-slate-900 text-xs border-t border-slate-100 pt-1">
                  <span>{lbl('Balance due', 'balanceDue')}:</span>
                  <span style={{ color: primaryColor }}>{fmt(totals.balanceDue)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Footer Section */}
          <div className="pt-6 border-t border-slate-100 space-y-4 text-[11px] text-slate-500">
            {config.footer.paymentTerms && (
              <div>
                <p className="font-semibold text-slate-700">{lbl('Payment Terms', 'paymentTerms')}</p>
                <p className="mt-0.5">{config.footer.paymentTerms}</p>
              </div>
            )}

            {config.footer.bankDetails &&
              (config.footer.bankDetails.bankName || config.footer.bankDetails.accountNumber) && (
                <div className="rounded border border-slate-100 bg-slate-50 p-2.5 space-y-1">
                  <p className="font-semibold text-slate-700">{lbl('Bank & Wire Transfer Details', 'bankDetails')}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
                    {config.footer.bankDetails.bankName && (
                      <p>{lbl('Bank', 'bank')}: <span className="font-medium text-slate-800">{config.footer.bankDetails.bankName}</span></p>
                    )}
                    {config.footer.bankDetails.accountName && (
                      <p>{lbl('Beneficiary', 'accountName')}: <span className="font-medium text-slate-800">{config.footer.bankDetails.accountName}</span></p>
                    )}
                    {config.footer.bankDetails.accountNumber && (
                      <p>{lbl('Account #', 'accountNumber')}: <span className="font-mono text-slate-800">{config.footer.bankDetails.accountNumber}</span></p>
                    )}
                    {config.footer.bankDetails.routingOrIban && (
                      <p>{lbl('Routing / IBAN', 'iban')}: <span className="font-mono text-slate-800">{config.footer.bankDetails.routingOrIban}</span></p>
                    )}
                    {config.footer.bankDetails.swiftBic && (
                      <p>{lbl('SWIFT/BIC', 'swift')}: <span className="font-mono text-slate-800">{config.footer.bankDetails.swiftBic}</span></p>
                    )}
                  </div>
                </div>
              )}

            {config.footer.notes && (
              <div>
                <p className="font-semibold text-slate-700">{lbl('Notes', 'notes')}</p>
                <p className="mt-0.5 text-slate-500">{config.footer.notes}</p>
              </div>
            )}

            {config.footer.showSignatureBlock && (
              <div className="pt-4 flex justify-between items-end">
                <div className="w-56">
                  <div className="border-b border-slate-400 h-8" />
                  <p className="mt-1 text-[10px] text-slate-600 font-medium">
                    {localizedLabel(config.footer.signatureLabel || 'Authorized Signature', DOCUMENT_LABELS.authorizedSignature.ar, language)}
                  </p>
                </div>
                <div className="w-36">
                  <div className="border-b border-slate-400 h-8" />
                  <p className="mt-1 text-[10px] text-slate-600 font-medium">{lbl('Date', 'date')}</p>
                </div>
              </div>
            )}

            {config.footer.showPageNumbers && (
              <div className="text-center text-[10px] text-slate-500 pt-2 border-t border-slate-50">
                {toDigits(
                  localizedLabel('Page 1 of 1', `${DOCUMENT_LABELS.page.ar} 1 ${DOCUMENT_LABELS.of.ar} 1`, language),
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
