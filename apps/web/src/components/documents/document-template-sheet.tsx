'use client';

import type { DocumentTemplateConfig, UniversalDocumentData, DocumentType } from '@saas/shared';

interface DocumentTemplateSheetProps {
  data: UniversalDocumentData;
  config: DocumentTemplateConfig;
  organizationName?: string;
}

export function formatDocCurrency(amount: number | undefined | null, currency = 'USD'): string {
  const val = Number(amount) || 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

export function formatDocDate(d: string | Date | undefined | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return String(d);
  }
}

export function DocumentTemplateSheet({
  data,
  config,
  organizationName,
}: DocumentTemplateSheetProps) {
  const primaryColor = config.branding?.primaryColor || '#1e3a8a';
  const secondaryColor = config.branding?.secondaryColor || '#64748b';
  const density = config.branding?.layoutDensity || 'normal';
  const fontFamilyClass =
    config.branding?.fontFamily === 'Courier'
      ? 'font-mono'
      : config.branding?.fontFamily === 'Times-Roman'
      ? 'font-serif'
      : 'font-sans';

  const densityPadding =
    density === 'compact'
      ? 'p-5 space-y-4 print:p-0 print:space-y-3'
      : density === 'relaxed'
      ? 'p-10 space-y-8 print:p-0 print:space-y-6'
      : 'p-8 space-y-6 print:p-0 print:space-y-5';

  const tableDensity =
    density === 'compact'
      ? 'py-1.5 px-2 text-[11px]'
      : density === 'relaxed'
      ? 'py-3 px-3 text-xs'
      : 'py-2 px-2.5 text-xs';

  const docTitleMap: Record<DocumentType, string> = {
    INVOICE: config.header?.customLabels?.invoice || 'TAX INVOICE',
    QUOTE: config.header?.customLabels?.quote || 'QUOTATION',
    STATEMENT: config.header?.customLabels?.statement || 'STATEMENT OF ACCOUNT',
    DELIVERY_NOTE: config.header?.customLabels?.deliveryNote || 'DELIVERY NOTE',
    PURCHASE_ORDER: config.header?.customLabels?.purchaseOrder || 'PURCHASE ORDER',
  };

  const docTitle = docTitleMap[data.type] || data.type;
  const currency = data.currency || 'USD';
  const orgName = data.organization?.name || organizationName || 'Your Company';

  return (
    <div
      id="document-template-sheet"
      className={`w-full max-w-3xl mx-auto bg-white text-slate-900 rounded-xl shadow-xs border border-slate-200 transition-all ${fontFamilyClass} ${densityPadding} print:shadow-none print:border-none print:rounded-none print:p-0 print:m-0 print:max-w-none`}
    >
      {/* 1. Header Section */}
      {config.header?.layout === 'banner' && (
        <div
          className="-mx-8 -mt-8 mb-6 p-6 rounded-t-xl flex flex-wrap justify-between items-center text-white print:rounded-none print:-mx-0 print:-mt-0 print:mb-5 print:p-5 print:break-inside-avoid"
          style={{ backgroundColor: primaryColor }}
        >
          <div className="flex items-center gap-3">
            {config.header?.showLogo && (
              <div className="size-11 rounded-lg bg-white/20 flex items-center justify-center font-bold text-white text-base shrink-0">
                {data.organization?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={data.organization.logoUrl}
                    alt={orgName}
                    className="max-h-9 max-w-9 object-contain"
                  />
                ) : (
                  orgName.slice(0, 3).toUpperCase()
                )}
              </div>
            )}
            <div>
              <h2 className="text-lg font-bold tracking-tight text-white">{orgName}</h2>
              {config.header?.showCompanyAddress && data.organization?.address && (
                <p className="text-xs text-white/80 leading-snug">{data.organization.address}</p>
              )}
              <div className="text-[11px] text-white/70 flex flex-wrap gap-x-3 mt-0.5">
                {config.header?.showCompanyPhone && data.organization?.phone && (
                  <span>{data.organization.phone}</span>
                )}
                {config.header?.showCompanyEmail && data.organization?.email && (
                  <span>{data.organization.email}</span>
                )}
                {config.header?.showCompanyTaxId && data.organization?.taxId && (
                  <span>Tax ID: {data.organization.taxId}</span>
                )}
              </div>
            </div>
          </div>

          <div className="text-right">
            <h1 className="text-xl font-black uppercase tracking-wider text-white">{docTitle}</h1>
            <p className="text-xs font-mono text-white/90 font-semibold">{data.number}</p>
            <div className="text-[11px] text-white/80 mt-1 space-y-0.5">
              <p>Issue Date: {formatDocDate(data.issuedAt)}</p>
              {data.validUntil && <p>Valid Until: {formatDocDate(data.validUntil)}</p>}
              {data.dueDate && <p>Due Date: {formatDocDate(data.dueDate)}</p>}
            </div>
          </div>
        </div>
      )}

      {config.header?.layout === 'centered' && (
        <div className="text-center pb-5 border-b border-slate-200 print:break-inside-avoid print:pb-4">
          {config.header?.showLogo && (
            <div
              className="mx-auto mb-2 size-12 rounded-lg flex items-center justify-center font-bold text-white text-sm"
              style={{ backgroundColor: primaryColor }}
            >
              {data.organization?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={data.organization.logoUrl}
                  alt={orgName}
                  className="max-h-10 max-w-10 object-contain"
                />
              ) : (
                orgName.slice(0, 3).toUpperCase()
              )}
            </div>
          )}
          <h2 className="text-base font-bold text-slate-900">{orgName}</h2>
          <h1 className="text-xl font-extrabold uppercase mt-1 tracking-tight" style={{ color: primaryColor }}>
            {docTitle}
          </h1>
          <p className="text-xs font-mono text-slate-600 font-semibold">{data.number}</p>
          <div className="mt-2 text-[11px] text-slate-500 flex flex-wrap justify-center gap-x-4">
            {config.header?.showCompanyAddress && data.organization?.address && (
              <span>{data.organization.address}</span>
            )}
            {config.header?.showCompanyPhone && data.organization?.phone && (
              <span>{data.organization.phone}</span>
            )}
            {config.header?.showCompanyEmail && data.organization?.email && (
              <span>{data.organization.email}</span>
            )}
            {config.header?.showCompanyTaxId && data.organization?.taxId && (
              <span>Tax ID: {data.organization.taxId}</span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 flex justify-center gap-x-4">
            <span>Issue Date: {formatDocDate(data.issuedAt)}</span>
            {data.validUntil && <span>Valid Until: {formatDocDate(data.validUntil)}</span>}
            {data.dueDate && <span>Due Date: {formatDocDate(data.dueDate)}</span>}
          </div>
        </div>
      )}

      {(!config.header?.layout || config.header?.layout === 'split') && (
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 pb-5 border-b border-slate-200 print:break-inside-avoid print:pb-4">
          <div className="flex items-start gap-3">
            {config.header?.showLogo && (
              <div
                className="size-11 rounded-lg flex items-center justify-center font-bold text-white text-xs shrink-0"
                style={{ backgroundColor: primaryColor }}
              >
                {data.organization?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={data.organization.logoUrl}
                    alt={orgName}
                    className="max-h-9 max-w-9 object-contain"
                  />
                ) : (
                  orgName.slice(0, 3).toUpperCase()
                )}
              </div>
            )}
            <div className="space-y-0.5">
              <h2 className="text-base font-bold text-slate-900 tracking-tight">{orgName}</h2>
              {config.header?.showCompanyAddress && data.organization?.address && (
                <p className="text-[11px] text-slate-500 max-w-xs">{data.organization.address}</p>
              )}
              <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3">
                {config.header?.showCompanyPhone && data.organization?.phone && (
                  <span>{data.organization.phone}</span>
                )}
                {config.header?.showCompanyEmail && data.organization?.email && (
                  <span>{data.organization.email}</span>
                )}
              </div>
              {config.header?.showCompanyTaxId && data.organization?.taxId && (
                <p className="text-[11px] text-slate-400">Tax ID: {data.organization.taxId}</p>
              )}
            </div>
          </div>

          <div className="text-left sm:text-right space-y-0.5">
            <h1 className="text-xl font-extrabold uppercase tracking-tight" style={{ color: primaryColor }}>
              {docTitle}
            </h1>
            <p className="text-xs font-mono font-semibold text-slate-700">{data.number}</p>
            <div className="text-[11px] text-slate-500 mt-2 space-y-0.5">
              <p>
                <strong className="text-slate-700">Issue Date:</strong> {formatDocDate(data.issuedAt)}
              </p>
              {data.validUntil && (
                <p>
                  <strong className="text-slate-700">Valid Until:</strong> {formatDocDate(data.validUntil)}
                </p>
              )}
              {data.dueDate && (
                <p>
                  <strong className="text-slate-700">Due Date:</strong> {formatDocDate(data.dueDate)}
                </p>
              )}
              {data.paymentTerms && (
                <p>
                  <strong className="text-slate-700">Terms:</strong>{' '}
                  <span className="uppercase">{data.paymentTerms.replace('_', ' ')}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Parties / Addresses Section */}
      <div className="grid sm:grid-cols-2 gap-4 text-xs pt-1 print:break-inside-avoid">
        <div className="rounded-lg bg-slate-50/80 p-3.5 border border-slate-200/80">
          <p
            className="text-[11px] font-bold uppercase tracking-wider mb-1"
            style={{ color: secondaryColor }}
          >
            {data.type === 'PURCHASE_ORDER'
              ? config.parties?.supplierLabel || 'Vendor'
              : config.parties?.billToLabel || 'Bill To'}
          </p>
          <p className="font-bold text-sm text-slate-900">{data.party?.name || 'Customer'}</p>
          {data.party?.companyName && (
            <p className="text-slate-700 font-medium">{data.party.companyName}</p>
          )}
          {config.parties?.showAddress && data.party?.address && (
            <p className="text-slate-600 mt-0.5 text-[11px] leading-relaxed">{data.party.address}</p>
          )}
          {config.parties?.showEmail && data.party?.email && (
            <p className="text-slate-500 text-[11px] mt-0.5">{data.party.email}</p>
          )}
          {config.parties?.showPhone && data.party?.phone && (
            <p className="text-slate-500 text-[11px]">{data.party.phone}</p>
          )}
          {config.parties?.showTaxId && data.party?.taxId && (
            <p className="text-slate-400 text-[10px] mt-0.5">Tax/VAT ID: {data.party.taxId}</p>
          )}
        </div>

        {data.secondaryParty && (
          <div className="rounded-lg bg-slate-50/80 p-3.5 border border-slate-200/80">
            <p
              className="text-[11px] font-bold uppercase tracking-wider mb-1"
              style={{ color: secondaryColor }}
            >
              {data.secondaryParty.label || config.parties?.shipToLabel || 'Ship To'}
            </p>
            <p className="font-bold text-sm text-slate-900">{data.secondaryParty.name}</p>
            {data.secondaryParty.address && (
              <p className="text-slate-600 mt-0.5 text-[11px] leading-relaxed">
                {data.secondaryParty.address}
              </p>
            )}
            {data.secondaryParty.carrier && (
              <p className="text-slate-500 text-[11px] mt-0.5">Carrier: {data.secondaryParty.carrier}</p>
            )}
            {data.secondaryParty.trackingReference && (
              <p className="text-slate-600 font-mono text-[11px]">
                Tracking: {data.secondaryParty.trackingReference}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 3. Statement Summary (if STATEMENT) */}
      {data.statementSummary && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-2 print:break-inside-avoid">
          <div className="flex flex-wrap justify-between items-center text-xs gap-2">
            <span className="text-slate-600">
              Opening Balance:{' '}
              <strong className="text-slate-800">
                {formatDocCurrency(data.statementSummary.openingBalance, currency)}
              </strong>
            </span>
            <span className="text-slate-900 font-bold">
              Closing Balance: {formatDocCurrency(data.statementSummary.closingBalance, currency)}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-200 text-center text-[11px]">
            <div className="bg-white p-2 rounded border border-slate-200">
              <p className="text-slate-500 text-[10px] uppercase font-semibold">Current</p>
              <p className="font-bold text-slate-800">
                {formatDocCurrency(data.statementSummary.aging.current, currency)}
              </p>
            </div>
            <div className="bg-white p-2 rounded border border-slate-200">
              <p className="text-slate-500 text-[10px] uppercase font-semibold">1-30 Days</p>
              <p className="font-bold text-slate-800">
                {formatDocCurrency(data.statementSummary.aging.days30, currency)}
              </p>
            </div>
            <div className="bg-white p-2 rounded border border-slate-200">
              <p className="text-slate-500 text-[10px] uppercase font-semibold">31-60 Days</p>
              <p className="font-bold text-amber-700">
                {formatDocCurrency(data.statementSummary.aging.days60, currency)}
              </p>
            </div>
            <div className="bg-white p-2 rounded border border-slate-200">
              <p className="text-slate-500 text-[10px] uppercase font-semibold">90+ Days</p>
              <p className="font-bold text-rose-700">
                {formatDocCurrency(data.statementSummary.aging.days90Plus, currency)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 4. Items Table */}
      {data.items && data.items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 print:rounded-lg print:border-slate-300">
          <table className="w-full text-left border-collapse text-xs">
            <thead
              style={{
                backgroundColor: config.itemsTable?.headerBackgroundColor || primaryColor,
                color: config.itemsTable?.headerTextColor || '#ffffff',
              }}
            >
              <tr className="uppercase tracking-wider font-semibold">
                {config.itemsTable?.showItemCode && <th className={`${tableDensity} w-20`}>Code</th>}
                {config.itemsTable?.showDescription && (
                  <th className={`${tableDensity}`}>Description</th>
                )}
                {config.itemsTable?.showQuantity && (
                  <th className={`${tableDensity} text-right w-16`}>Qty</th>
                )}
                {config.itemsTable?.showUnitPrice && (
                  <th className={`${tableDensity} text-right w-24`}>Unit Price</th>
                )}
                {config.itemsTable?.showDiscount && (
                  <th className={`${tableDensity} text-right w-16`}>Disc.</th>
                )}
                {config.itemsTable?.showTaxRate && (
                  <th className={`${tableDensity} text-right w-16`}>Tax</th>
                )}
                {config.itemsTable?.showLineTotal && (
                  <th className={`${tableDensity} text-right w-24`}>Total</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {data.items.map((item, idx) => (
                <tr
                  key={idx}
                  className={`${
                    config.itemsTable?.zebraStriping && idx % 2 === 1
                      ? 'bg-slate-50/70'
                      : 'bg-white'
                  } print:break-inside-avoid`}
                >
                  {config.itemsTable?.showItemCode && (
                    <td className={`${tableDensity} font-mono text-slate-500`}>
                      {item.code || `—`}
                    </td>
                  )}
                  {config.itemsTable?.showDescription && (
                    <td className={`${tableDensity} font-medium text-slate-900`}>
                      {item.description}
                    </td>
                  )}
                  {config.itemsTable?.showQuantity && (
                    <td className={`${tableDensity} text-right text-slate-700 tabular-nums`}>
                      {item.quantity ?? 1}
                    </td>
                  )}
                  {config.itemsTable?.showUnitPrice && (
                    <td className={`${tableDensity} text-right text-slate-700 tabular-nums`}>
                      {formatDocCurrency(item.unitPrice, currency)}
                    </td>
                  )}
                  {config.itemsTable?.showDiscount && (
                    <td className={`${tableDensity} text-right text-slate-600 tabular-nums`}>
                      {item.discount ? `${item.discount}%` : '—'}
                    </td>
                  )}
                  {config.itemsTable?.showTaxRate && (
                    <td className={`${tableDensity} text-right text-slate-500 tabular-nums`}>
                      {item.taxRate ? `${item.taxRate}%` : '0%'}
                    </td>
                  )}
                  {config.itemsTable?.showLineTotal && (
                    <td className={`${tableDensity} text-right font-semibold text-slate-900 tabular-nums`}>
                      {formatDocCurrency(
                        item.amount ??
                          (item.quantity ?? 1) * (item.unitPrice ?? 0) * (1 - (item.discount ?? 0) / 100),
                        currency,
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 5. Financial Summary Breakdown */}
      <div className="flex justify-end pt-2 print:break-inside-avoid">
        <div className="w-72 space-y-1.5 text-xs">
          {config.totals?.showSubtotal && (
            <div className="flex justify-between text-slate-600">
              <span>Subtotal:</span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {formatDocCurrency(data.totals?.subtotal, currency)}
              </span>
            </div>
          )}

          {config.totals?.showDiscountTotal && (data.totals?.discounts ?? 0) > 0 && (
            <div className="flex justify-between text-emerald-700 font-medium">
              <span>Discount Applied:</span>
              <span className="tabular-nums">
                -{formatDocCurrency(data.totals?.discounts, currency)}
              </span>
            </div>
          )}

          {config.totals?.showTaxSummary &&
            data.totals?.taxes?.map((tax, i) => (
              <div key={i} className="flex justify-between text-slate-600">
                <span>{tax.label || `Tax (${tax.rate}%)`}:</span>
                <span className="font-semibold text-slate-900 tabular-nums">
                  {formatDocCurrency(tax.amount, currency)}
                </span>
              </div>
            ))}

          <div
            className={`flex justify-between py-2 border-t font-black ${
              config.totals?.highlightTotal ? 'px-2 rounded-md' : ''
            }`}
            style={
              config.totals?.highlightTotal
                ? { backgroundColor: `${primaryColor}15`, color: primaryColor }
                : { borderColor: '#cbd5e1', color: '#0f172a' }
            }
          >
            <span className="text-sm">Total Due ({currency}):</span>
            <span className="text-base tabular-nums">
              {formatDocCurrency(data.totals?.total, currency)}
            </span>
          </div>

          {config.totals?.showAmountPaid && (data.totals?.amountPaid ?? 0) > 0 && (
            <div className="flex justify-between text-slate-600 text-[11px]">
              <span>Amount Paid:</span>
              <span className="tabular-nums">
                {formatDocCurrency(data.totals?.amountPaid, currency)}
              </span>
            </div>
          )}

          {config.totals?.showBalanceDue && data.totals?.balanceDue != null && (
            <div className="flex justify-between font-bold text-xs border-t border-slate-200 pt-1.5">
              <span>Balance Due:</span>
              <span className="tabular-nums text-sm" style={{ color: primaryColor }}>
                {formatDocCurrency(data.totals?.balanceDue, currency)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 6. Footer Section */}
      <div className="pt-6 border-t border-slate-200 space-y-4 text-[11px] text-slate-600 print:break-inside-avoid">
        {/* Payment Terms */}
        {(data.paymentTerms || config.footer?.paymentTerms) && (
          <div>
            <p className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
              Payment Terms
            </p>
            <p className="mt-0.5 leading-relaxed">
              {data.paymentTerms || config.footer?.paymentTerms}
            </p>
          </div>
        )}

        {/* Bank & Wire Transfer Details */}
        {config.footer?.bankDetails &&
          (config.footer.bankDetails.bankName || config.footer.bankDetails.accountNumber) && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1">
              <p className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                Bank & Wire Transfer Details
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                {config.footer.bankDetails.bankName && (
                  <p>
                    <span className="text-slate-500">Bank:</span>{' '}
                    <strong className="text-slate-900">{config.footer.bankDetails.bankName}</strong>
                  </p>
                )}
                {config.footer.bankDetails.accountName && (
                  <p>
                    <span className="text-slate-500">Beneficiary:</span>{' '}
                    <strong className="text-slate-900">{config.footer.bankDetails.accountName}</strong>
                  </p>
                )}
                {config.footer.bankDetails.accountNumber && (
                  <p>
                    <span className="text-slate-500">Account #:</span>{' '}
                    <strong className="font-mono text-slate-900">
                      {config.footer.bankDetails.accountNumber}
                    </strong>
                  </p>
                )}
                {config.footer.bankDetails.routingOrIban && (
                  <p>
                    <span className="text-slate-500">Routing / IBAN:</span>{' '}
                    <strong className="font-mono text-slate-900">
                      {config.footer.bankDetails.routingOrIban}
                    </strong>
                  </p>
                )}
                {config.footer.bankDetails.swiftBic && (
                  <p>
                    <span className="text-slate-500">SWIFT / BIC:</span>{' '}
                    <strong className="font-mono text-slate-900">
                      {config.footer.bankDetails.swiftBic}
                    </strong>
                  </p>
                )}
              </div>
            </div>
          )}

        {/* Notes / Disclaimers */}
        {(data.notes || config.footer?.notes) && (
          <div>
            <p className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">Notes</p>
            <p className="mt-0.5 leading-relaxed whitespace-pre-wrap">
              {data.notes || config.footer?.notes}
            </p>
          </div>
        )}

        {/* Signature Line */}
        {(config.footer?.showSignatureBlock ?? true) && (
          <div className="pt-6 mt-4 border-t border-slate-200">
            <div className="grid grid-cols-2 gap-12 text-xs">
              <div className="space-y-6">
                <p className="font-medium text-slate-700">
                  For <strong className="text-slate-900">{orgName}</strong>:
                </p>
                <div className="border-b border-slate-400 pt-3"></div>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>{config.footer?.signatureLabel || 'Authorized Signature'}</span>
                  <span>Date</span>
                </div>
              </div>

              <div className="space-y-6">
                <p className="font-medium text-slate-700">
                  Accepted by <strong className="text-slate-900">{data.party?.name || 'Client'}</strong>:
                </p>
                <div className="border-b border-slate-400 pt-3"></div>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Client Signature / Stamp</span>
                  <span>Date</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Page numbering */}
        {config.footer?.showPageNumbers && (
          <div className="text-center text-[10px] text-slate-400 pt-2 border-t border-slate-100">
            Page 1 of 1
          </div>
        )}
      </div>
    </div>
  );
}
