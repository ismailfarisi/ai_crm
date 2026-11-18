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
  team: { en: 'the team', ar: 'الفريق' },
  genericError: { en: 'Something went wrong. Please try again.', ar: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.' },
  yourResponse: { en: 'Your response', ar: 'ردك' },
  tabAccept: { en: 'Accept', ar: 'قبول' },
  requestChanges: { en: 'Request changes', ar: 'طلب تعديلات' },
  tabDecline: { en: 'Decline', ar: 'رفض' },
  sendRequest: { en: 'Send request', ar: 'إرسال الطلب' },
  declineQuote: { en: 'Decline quote', ar: 'رفض عرض السعر' },
  changesQuestion: { en: 'What would you like changed?', ar: 'ما التعديلات التي تريدها؟' },
  reasonOptional: { en: 'Reason (optional)', ar: 'السبب (اختياري)' },
  declined: {
    en: 'You declined this quote. Contact {org} if you change your mind.',
    ar: 'لقد رفضت عرض السعر هذا. تواصل مع {org} إذا غيرت رأيك.',
  },
  declinedOn: {
    en: 'You declined this quote on {date}. Contact {org} if you change your mind.',
    ar: 'لقد رفضت عرض السعر هذا بتاريخ {date}. تواصل مع {org} إذا غيرت رأيك.',
  },
  changesAsked: {
    en: 'You asked for changes. {org} will send an updated quote. You can still accept this one.',
    ar: 'لقد طلبت تعديلات. سيرسل {org} عرض سعر محدثًا، ولا يزال بإمكانك قبول هذا العرض.',
  },
  changesAskedOn: {
    en: 'You asked for changes on {date}. {org} will send an updated quote. You can still accept this one.',
    ar: 'لقد طلبت تعديلات بتاريخ {date}. سيرسل {org} عرض سعر محدثًا، ولا يزال بإمكانك قبول هذا العرض.',
  },
  approveProofFirst: {
    en: 'Please approve the artwork proof above first. You can accept the quote once the latest proof is approved.',
    ar: 'يرجى اعتماد نموذج التصميم أعلاه أولًا. يمكنك قبول عرض السعر بعد اعتماد أحدث نموذج.',
  },
  proofComing: {
    en: '{org} will send an artwork proof for you to approve. You can accept the quote once it is approved.',
    ar: 'سيرسل {org} نموذج تصميم لتعتمده. يمكنك قبول عرض السعر بعد اعتماده.',
  },
  proofHeading: { en: 'Artwork proof v{version}', ar: 'نموذج التصميم، الإصدار {version}' },
  proofName: { en: 'Proof v{version}', ar: 'النموذج، الإصدار {version}' },
  proofPending: { en: 'Waiting for you', ar: 'بانتظار ردك' },
  proofApproved: { en: 'Approved', ar: 'معتمد' },
  proofChangesRequested: { en: 'Changes requested', ar: 'مطلوب تعديلات' },
  proofApprovedBy: { en: 'Approved by {name}.', ar: 'اعتمده {name}.' },
  proofApprovedByOn: { en: 'Approved by {name} on {date}.', ar: 'اعتمده {name} بتاريخ {date}.' },
  proofChangesBy: { en: 'Changes requested by {name}.', ar: 'طلب {name} تعديلات.' },
  proofChangesByOn: { en: 'Changes requested by {name} on {date}.', ar: 'طلب {name} تعديلات بتاريخ {date}.' },
  proofUnavailable: { en: 'This file is no longer available.', ar: 'هذا الملف لم يعد متاحًا.' },
  openFile: { en: 'Open {filename}', ar: 'فتح {filename}' },
  proofChangeQuestion: { en: 'What needs to change?', ar: 'ما الذي يجب تعديله؟' },
  sendChanges: { en: 'Send changes', ar: 'إرسال التعديلات' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  approveProof: { en: 'Approve proof', ar: 'اعتماد النموذج' },
  earlierVersions: { en: 'Earlier versions ({count})', ar: 'الإصدارات السابقة ({count})' },
  depositInvoice: { en: 'Invoice {number} · {amount}', ar: 'الفاتورة {number} · {amount}' },
  depositPaid: { en: 'Deposit paid. Thank you.', ar: 'تم دفع العربون. شكرًا لك.' },
  paymentConfirming: { en: 'Thank you. Your payment is being confirmed.', ar: 'شكرًا لك. جارٍ تأكيد دفعتك.' },
  payDeposit: { en: 'Pay deposit {amount}', ar: 'دفع العربون {amount}' },
  depositDue: {
    en: '{amount} is due before work starts. The invoice has the payment details.',
    ar: 'يستحق دفع {amount} قبل بدء العمل. تجد تفاصيل الدفع في الفاتورة.',
  },
} as const;

export type PublicQuoteCopyKey = keyof typeof COPY;

export interface PublicQuoteCopy {
  /** English, Arabic, or both joined for bilingual quotes. */
  label: (key: PublicQuoteCopyKey, values?: Record<string, string>) => string;
  /** One string per language to show, English first. */
  lines: (key: PublicQuoteCopyKey, values?: Record<string, string>) => string[];
}

function fill(text: string, values: Record<string, string> = {}): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}

export function publicQuoteCopy(language: DocumentLanguage = 'en'): PublicQuoteCopy {
  return {
    label: (key, values) =>
      language === 'en'
        ? fill(COPY[key].en, values)
        : language === 'ar'
          ? fill(COPY[key].ar, values)
          : `${fill(COPY[key].en, values)} / ${fill(COPY[key].ar, values)}`,
    lines: (key, values) => {
      const en = fill(COPY[key].en, values);
      const ar = fill(COPY[key].ar, values);
      if (language === 'en') return [en];
      if (language === 'ar') return [ar];
      return [en, ar];
    },
  };
}
