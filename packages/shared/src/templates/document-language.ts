import { z } from 'zod';

/**
 * The language a customer-facing document prints in. `bilingual` prints every
 * label in English and Arabic and shows the Arabic names, addresses and line
 * descriptions next to the English ones.
 */
export const documentLanguageSchema = z.enum(['en', 'ar', 'bilingual']);
export type DocumentLanguage = z.infer<typeof documentLanguageSchema>;

export const DOCUMENT_LANGUAGES = documentLanguageSchema.options;

export const DOCUMENT_LANGUAGE_LABELS: Record<DocumentLanguage, string> = {
  en: 'English',
  ar: 'Arabic',
  bilingual: 'English and Arabic',
};

/** Western digits by default: UAE invoices and bank transfers use them. */
export const documentDigitsSchema = z.enum(['western', 'arabic-indic']);
export type DocumentDigits = z.infer<typeof documentDigitsSchema>;

/** The customer's preference wins; a customer without one gets the template's. */
export function resolveDocumentLanguage(
  customerLanguage: DocumentLanguage | null | undefined,
  templateLanguage: DocumentLanguage | null | undefined,
): DocumentLanguage {
  return customerLanguage ?? templateLanguage ?? 'en';
}

export function isRtlDocument(language: DocumentLanguage): boolean {
  return language === 'ar';
}

/** Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) for the ASCII ones. Separators are left as they are. */
export function toArabicIndicDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
}

/**
 * Every fixed label a customer document prints, in both languages. Arabic
 * follows UAE commercial usage (FTA wording for the tax invoice and TRN).
 */
export const DOCUMENT_LABELS = {
  quote: { en: 'QUOTATION', ar: 'عرض سعر' },
  invoice: { en: 'INVOICE', ar: 'فاتورة' },
  taxInvoice: { en: 'TAX INVOICE', ar: 'فاتورة ضريبية' },
  statement: { en: 'STATEMENT OF ACCOUNT', ar: 'كشف حساب' },
  deliveryNote: { en: 'PACKING SLIP', ar: 'إشعار تسليم' },
  purchaseOrder: { en: 'PURCHASE ORDER', ar: 'أمر شراء' },
  billTo: { en: 'Bill To', ar: 'فاتورة إلى' },
  shipTo: { en: 'Ship To', ar: 'الشحن إلى' },
  vendor: { en: 'Vendor', ar: 'المورد' },
  customer: { en: 'Customer', ar: 'العميل' },
  phone: { en: 'Phone', ar: 'الهاتف' },
  email: { en: 'Email', ar: 'البريد الإلكتروني' },
  taxId: { en: 'Tax ID', ar: 'رقم التسجيل الضريبي' },
  trn: { en: 'TRN', ar: 'رقم التسجيل الضريبي' },
  issued: { en: 'Issued', ar: 'تاريخ الإصدار' },
  due: { en: 'Due', ar: 'تاريخ الاستحقاق' },
  validUntil: { en: 'Valid Until', ar: 'صالح حتى' },
  carrier: { en: 'Carrier', ar: 'شركة الشحن' },
  tracking: { en: 'Tracking', ar: 'رقم التتبع' },
  itemCode: { en: 'Item / Code', ar: 'الرمز' },
  description: { en: 'Description', ar: 'الوصف' },
  quantity: { en: 'Qty', ar: 'الكمية' },
  unitPrice: { en: 'Unit Price', ar: 'سعر الوحدة' },
  discountPercent: { en: 'Disc %', ar: 'الخصم %' },
  taxPercent: { en: 'Tax %', ar: 'الضريبة %' },
  lineTotal: { en: 'Amount', ar: 'المبلغ' },
  noItems: { en: 'No line items recorded.', ar: 'لا توجد بنود.' },
  accountSummary: { en: 'ACCOUNT SUMMARY', ar: 'ملخص الحساب' },
  statementPeriod: { en: 'STATEMENT PERIOD', ar: 'فترة الكشف' },
  openingBalance: { en: 'OPENING BALANCE', ar: 'الرصيد الافتتاحي' },
  closingBalance: { en: 'CLOSING BALANCE', ar: 'الرصيد الختامي' },
  agingBreakdown: { en: 'AGING BREAKDOWN', ar: 'أعمار الديون' },
  agingCurrent: { en: 'Current', ar: 'الحالي' },
  aging30: { en: '1-30 Days', ar: '1-30 يومًا' },
  aging60: { en: '31-60 Days', ar: '31-60 يومًا' },
  aging90: { en: '61-90 Days', ar: '61-90 يومًا' },
  aging90Plus: { en: '90+ Days', ar: 'أكثر من 90 يومًا' },
  subtotal: { en: 'Subtotal', ar: 'المجموع الفرعي' },
  discount: { en: 'Discount', ar: 'الخصم' },
  vat: { en: 'VAT', ar: 'ضريبة القيمة المضافة' },
  total: { en: 'Total', ar: 'الإجمالي' },
  amountPaid: { en: 'Amount Paid', ar: 'المبلغ المدفوع' },
  balanceDue: { en: 'Balance Due', ar: 'الرصيد المستحق' },
  paymentTerms: { en: 'Payment Terms', ar: 'شروط الدفع' },
  notes: { en: 'Notes', ar: 'ملاحظات' },
  bankDetails: { en: 'BANK DETAILS', ar: 'تفاصيل البنك' },
  bank: { en: 'Bank', ar: 'البنك' },
  accountName: { en: 'Account Name', ar: 'اسم الحساب' },
  accountNumber: { en: 'Account Number', ar: 'رقم الحساب' },
  iban: { en: 'IBAN / Routing', ar: 'رقم الآيبان' },
  swift: { en: 'SWIFT / BIC', ar: 'رمز السويفت' },
  for: { en: 'For', ar: 'عن' },
  acceptedBy: { en: 'Accepted by', ar: 'قبول من' },
  authorizedSignature: { en: 'Authorized Signature', ar: 'التوقيع المعتمد' },
  authorizedSignatureDate: { en: 'Authorized Signature / Date', ar: 'التوقيع المعتمد / التاريخ' },
  clientSignature: { en: 'Client Signature / Stamp / Date', ar: 'توقيع العميل / الختم / التاريخ' },
  page: { en: 'Page', ar: 'صفحة' },
  of: { en: 'of', ar: 'من' },
  date: { en: 'Date', ar: 'التاريخ' },
  invoices: { en: 'Invoices', ar: 'الفواتير' },
  payments: { en: 'Payments', ar: 'المدفوعات' },
  agingOver60: { en: 'Over 60 days', ar: 'أكثر من 60 يومًا' },
  periodLast30: { en: 'Period: last 30 days', ar: 'الفترة: آخر 30 يومًا' },
} as const satisfies Record<string, { en: string; ar: string }>;

export type DocumentLabelKey = keyof typeof DOCUMENT_LABELS;

/** Status words a document badge shows. Anything else prints as stored. */
export const DOCUMENT_STATUS_LABELS_AR: Record<string, string> = {
  DRAFT: 'مسودة',
  SENT: 'مرسل',
  ISSUED: 'صادر',
  OPEN: 'مفتوح',
  PENDING: 'قيد الانتظار',
  APPROVED: 'معتمد',
  ACCEPTED: 'مقبول',
  REJECTED: 'مرفوض',
  EXPIRED: 'منتهي',
  PAID: 'مدفوع',
  PARTIALLY_PAID: 'مدفوع جزئيًا',
  OVERDUE: 'متأخر',
  VOID: 'ملغى',
  CANCELLED: 'ملغى',
  DISPATCHED: 'تم الشحن',
  DELIVERED: 'تم التسليم',
  RECEIVED: 'تم الاستلام',
  COMPLETED: 'مكتمل',
};

/**
 * A fixed label in the document's language. Bilingual labels are English then
 * Arabic, joined by `joiner` (a slash inline, a newline where there is room to
 * stack them).
 */
export function documentLabel(
  key: DocumentLabelKey,
  language: DocumentLanguage,
  joiner = ' / ',
): string {
  const label = DOCUMENT_LABELS[key];
  if (language === 'en') return label.en;
  if (language === 'ar') return label.ar;
  return `${label.en}${joiner}${label.ar}`;
}

/** Same as `documentLabel` for a label the template may have renamed in English. */
export function localizedLabel(
  english: string,
  arabic: string,
  language: DocumentLanguage,
  joiner = ' / ',
): string {
  if (language === 'en') return english;
  if (language === 'ar') return arabic;
  return `${english}${joiner}${arabic}`;
}

/**
 * "VAT 5%" / "ضريبة القيمة المضافة 5%". Tax codes are named in English by the
 * tenant; the UAE ones start with VAT and untaxed-code lines say Tax. Only
 * that leading word is translated.
 */
export function arabicTaxLabel(label: string): string {
  return label.replace(/^(VAT|Tax)\b/i, DOCUMENT_LABELS.vat.ar);
}
