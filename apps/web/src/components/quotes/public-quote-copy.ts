import type { DocumentLanguage } from '@saas/shared';

/**
 * The public quote page's own words, in the customer's document language.
 * Short labels print side by side on bilingual quotes; sentences stack.
 */
const COPY = {
  item: { en: 'Item', ar: 'البند' },
  qty: { en: 'Qty', ar: 'الكمية' },
  price: { en: 'Price', ar: 'السعر' },
  amount: { en: 'Amount', ar: 'المبلغ' },
  subtotal: { en: 'Subtotal', ar: 'المجموع الفرعي' },
  tax: { en: 'VAT', ar: 'ضريبة القيمة المضافة' },
  total: { en: 'Total', ar: 'الإجمالي' },
  terms: { en: 'Terms', ar: 'الشروط والأحكام' },
  taxReg: { en: 'TRN', ar: 'رقم التسجيل الضريبي' },
  companyNo: { en: 'Co. no.', ar: 'رقم السجل التجاري' },
  preparedFor: { en: 'Prepared for', ar: 'مقدم إلى' },
  validUntil: { en: 'Valid until', ar: 'صالح حتى' },
  discount: { en: '{pct}% discount', ar: 'خصم {pct}%' },
  schedule: { en: 'How this will be invoiced', ar: 'جدول الفوترة' },
  yourName: { en: 'Your full name', ar: 'اسمك الكامل' },
  accept: { en: 'Accept quote', ar: 'قبول عرض السعر' },
  agree: {
    en: 'I accept this quote and its terms on behalf of {customer}.',
    ar: 'أوافق على عرض السعر هذا وشروطه نيابة عن {customer}.',
  },
  accepted: {
    en: 'Accepted by {name} on {date}. Thank you — {org} will be in touch.',
    ar: 'تم القبول من {name} بتاريخ {date}. شكرًا لك، سيتواصل معك {org}.',
  },
} as const;

export type PublicQuoteCopyKey = keyof typeof COPY;

export interface PublicQuoteCopy {
  /** English, Arabic, or both joined for bilingual quotes. */
  label: (key: PublicQuoteCopyKey) => string;
  /** One string per language to show, English first. */
  lines: (key: PublicQuoteCopyKey, values?: Record<string, string>) => string[];
}

function fill(text: string, values: Record<string, string> = {}): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}

export function publicQuoteCopy(language: DocumentLanguage = 'en'): PublicQuoteCopy {
  return {
    label: (key) =>
      language === 'en'
        ? COPY[key].en
        : language === 'ar'
          ? COPY[key].ar
          : `${COPY[key].en} / ${COPY[key].ar}`,
    lines: (key, values) => {
      const en = fill(COPY[key].en, values);
      const ar = fill(COPY[key].ar, values);
      if (language === 'en') return [en];
      if (language === 'ar') return [ar];
      return [en, ar];
    },
  };
}
