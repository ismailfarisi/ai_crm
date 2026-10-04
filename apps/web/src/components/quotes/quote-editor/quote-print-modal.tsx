'use client';

import { useMemo } from 'react';
import type { QuoteLineItem, QuoteTotals, UniversalDocumentData } from '@saas/shared';
import type { QuoteHeaderFormData } from './quote-header-form';
import { api } from '@/lib/api/endpoints';
import { DocumentPrintModal } from '@/components/documents/document-print-modal';
import { useOrganization } from '@/hooks/use-organization';

export interface QuotePrintModalProps {
  open: boolean;
  onClose: () => void;
  headerData: QuoteHeaderFormData;
  items: QuoteLineItem[];
  totals: QuoteTotals;
  termsAndConditions?: string | null;
  status?: string;
  organizationName?: string;
  quoteId?: string | null;
  onSaveBeforeDownload?: () => Promise<string | null>;
}

export function QuotePrintModal({
  open,
  onClose,
  headerData,
  items,
  totals,
  termsAndConditions,
  status = 'DRAFT',
  organizationName,
  quoteId,
  onSaveBeforeDownload,
}: QuotePrintModalProps) {
  const { data: orgProfile } = useOrganization();
  const currency = headerData.currency || 'USD';

  const effectiveOrgName = organizationName || orgProfile?.name || 'Your Company';
  const effectiveOrgAddress = [
    orgProfile?.addressLine1,
    orgProfile?.addressLine2,
    [orgProfile?.city, orgProfile?.region, orgProfile?.postalCode].filter(Boolean).join(' '),
    orgProfile?.country,
  ].filter(Boolean).join(', ') || undefined;

  const universalData = useMemo<UniversalDocumentData>(() => {
    return {
      type: 'QUOTE',
      number: headerData.quoteNumber || 'QT-DRAFT',
      status: status || 'DRAFT',
      issuedAt: new Date(),
      validUntil: headerData.validUntil ? new Date(headerData.validUntil) : undefined,
      currency,
      organization: {
        name: effectiveOrgName,
        address: effectiveOrgAddress,
        email: orgProfile?.email || undefined,
        phone: orgProfile?.phone || undefined,
        taxId: orgProfile?.taxId || undefined,
        website: orgProfile?.website || undefined,
        logoUrl: orgProfile?.logoUrl || undefined,
      },
      party: {
        name: headerData.customerName || 'Valued Customer',
        email: headerData.customerEmail || undefined,
      },
      items: items
        .filter((it) => it.type === 'product' || !it.type)
        .map((it) => {
          const qty = Number(it.quantity) || 1;
          const price = Number(it.unitPrice) || 0;
          const disc = Number(it.discount) || 0;
          return {
            code: it.id,
            description: it.description,
            quantity: qty,
            unitPrice: price,
            discount: disc,
            taxRate: Number(it.taxRate) || 0,
            amount: it.subtotal ?? qty * price * (1 - disc / 100),
          };
        }),
      totals: {
        subtotal: totals.subtotalAmount,
        discounts: totals.discountAmount,
        taxes: totals.taxAmount
          ? [{ rate: 0, label: 'Taxes', amount: totals.taxAmount }]
          : undefined,
        total: totals.totalAmount,
      },
      paymentTerms: headerData.paymentTerms,
      notes: termsAndConditions ?? undefined,
    };
  }, [headerData, items, totals, termsAndConditions, status, effectiveOrgName, effectiveOrgAddress, orgProfile, currency]);

  return (
    <DocumentPrintModal
      open={open}
      onClose={onClose}
      documentType="QUOTE"
      data={universalData}
      documentId={quoteId}
      downloadPdfFn={api.quotes.downloadPdf}
      onSaveBeforeDownload={onSaveBeforeDownload}
      organizationName={effectiveOrgName}
    />
  );
}
