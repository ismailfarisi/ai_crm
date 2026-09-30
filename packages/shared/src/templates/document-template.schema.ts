import { z } from 'zod';

export const documentTypeSchema = z.enum([
  'INVOICE',
  'QUOTE',
  'STATEMENT',
  'DELIVERY_NOTE',
  'PURCHASE_ORDER',
]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const documentTemplateConfigSchema = z.object({
  branding: z.object({
    logoUrl: z.string().url().optional().or(z.literal('')),
    primaryColor: z.string().regex(hexColorRegex, 'Invalid hex color'),
    secondaryColor: z.string().regex(hexColorRegex, 'Invalid hex color'),
    fontFamily: z.enum(['Helvetica', 'Times-Roman', 'Courier']).default('Helvetica'),
    layoutDensity: z.enum(['compact', 'normal', 'relaxed']).default('normal'),
    margins: z.object({
      top: z.number().min(10).max(100).default(40),
      bottom: z.number().min(10).max(100).default(40),
      left: z.number().min(10).max(100).default(40),
      right: z.number().min(10).max(100).default(40),
    }),
  }),
  header: z.object({
    layout: z.enum(['split', 'centered', 'banner']).default('split'),
    showLogo: z.boolean().default(true),
    showCompanyTaxId: z.boolean().default(true),
    showCompanyPhone: z.boolean().default(true),
    showCompanyEmail: z.boolean().default(true),
    showCompanyAddress: z.boolean().default(true),
    customLabels: z
      .object({
        invoice: z.string().optional(),
        quote: z.string().optional(),
        statement: z.string().optional(),
        deliveryNote: z.string().optional(),
        purchaseOrder: z.string().optional(),
      })
      .default({}),
  }),
  parties: z.object({
    billToLabel: z.string().default('Bill To'),
    shipToLabel: z.string().default('Ship To'),
    supplierLabel: z.string().default('Vendor'),
    showTaxId: z.boolean().default(true),
    showEmail: z.boolean().default(true),
    showPhone: z.boolean().default(true),
    showAddress: z.boolean().default(true),
  }),
  itemsTable: z.object({
    showItemCode: z.boolean().default(true),
    showDescription: z.boolean().default(true),
    showQuantity: z.boolean().default(true),
    showUnitPrice: z.boolean().default(true),
    showDiscount: z.boolean().default(true),
    showTaxRate: z.boolean().default(true),
    showLineTotal: z.boolean().default(true),
    zebraStriping: z.boolean().default(false),
    headerBackgroundColor: z.string().regex(hexColorRegex, 'Invalid hex color').optional(),
    headerTextColor: z.string().regex(hexColorRegex, 'Invalid hex color').optional(),
  }),
  totals: z.object({
    showSubtotal: z.boolean().default(true),
    showDiscountTotal: z.boolean().default(true),
    showTaxSummary: z.boolean().default(true),
    showAmountPaid: z.boolean().default(true),
    showBalanceDue: z.boolean().default(true),
    highlightTotal: z.boolean().default(true),
  }),
  footer: z.object({
    bankDetails: z
      .object({
        bankName: z.string().optional(),
        accountName: z.string().optional(),
        accountNumber: z.string().optional(),
        routingOrIban: z.string().optional(),
        swiftBic: z.string().optional(),
      })
      .default({}),
    paymentTerms: z.string().optional(),
    notes: z.string().optional(),
    showSignatureBlock: z.boolean().default(false),
    signatureLabel: z.string().default('Authorized Signature'),
    showPageNumbers: z.boolean().default(true),
  }),
});

export type DocumentTemplateConfig = z.infer<typeof documentTemplateConfigSchema>;

export const DEFAULT_DOCUMENT_TEMPLATE_CONFIG: DocumentTemplateConfig = {
  branding: {
    primaryColor: '#1e3a8a',
    secondaryColor: '#64748b',
    fontFamily: 'Helvetica',
    layoutDensity: 'normal',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
  },
  header: {
    layout: 'split',
    showLogo: true,
    showCompanyTaxId: true,
    showCompanyPhone: true,
    showCompanyEmail: true,
    showCompanyAddress: true,
    customLabels: {},
  },
  parties: {
    billToLabel: 'Bill To',
    shipToLabel: 'Ship To',
    supplierLabel: 'Vendor',
    showTaxId: true,
    showEmail: true,
    showPhone: true,
    showAddress: true,
  },
  itemsTable: {
    showItemCode: true,
    showDescription: true,
    showQuantity: true,
    showUnitPrice: true,
    showDiscount: true,
    showTaxRate: true,
    showLineTotal: true,
    zebraStriping: false,
  },
  totals: {
    showSubtotal: true,
    showDiscountTotal: true,
    showTaxSummary: true,
    showAmountPaid: true,
    showBalanceDue: true,
    highlightTotal: true,
  },
  footer: {
    bankDetails: {},
    paymentTerms: 'Payment due within 30 days of issue date.',
    notes: 'Thank you for your business.',
    showSignatureBlock: false,
    signatureLabel: 'Authorized Signature',
    showPageNumbers: true,
  },
};

export const universalDocumentDataSchema = z.object({
  type: documentTypeSchema,
  number: z.string(),
  status: z.string(),
  issuedAt: z.union([z.string(), z.date()]),
  dueDate: z.union([z.string(), z.date()]).optional(),
  validUntil: z.union([z.string(), z.date()]).optional(),
  currency: z.string().default('USD'),
  organization: z.object({
    name: z.string(),
    logoUrl: z.string().optional(),
    address: z.string().optional(),
    taxId: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    website: z.string().optional(),
  }),
  party: z.object({
    name: z.string(),
    companyName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    taxId: z.string().optional(),
  }),
  secondaryParty: z
    .object({
      label: z.string(),
      name: z.string(),
      address: z.string().optional(),
      carrier: z.string().optional(),
      trackingReference: z.string().optional(),
    })
    .optional(),
  items: z
    .array(
      z.object({
        code: z.string().optional(),
        description: z.string(),
        quantity: z.number().optional(),
        unitPrice: z.number().optional(),
        discount: z.number().optional(),
        taxRate: z.number().optional(),
        amount: z.number().optional(),
      }),
    )
    .default([]),
  totals: z.object({
    subtotal: z.number().optional(),
    discounts: z.number().optional(),
    taxes: z
      .array(
        z.object({
          rate: z.number(),
          label: z.string(),
          amount: z.number(),
        }),
      )
      .optional(),
    total: z.number(),
    amountPaid: z.number().optional(),
    balanceDue: z.number().optional(),
  }),
  statementSummary: z
    .object({
      openingBalance: z.number(),
      closingBalance: z.number(),
      periodFrom: z.union([z.string(), z.date()]),
      periodTo: z.union([z.string(), z.date()]),
      aging: z.object({
        current: z.number(),
        days30: z.number(),
        days60: z.number(),
        days90: z.number().optional(),
        days90Plus: z.number(),
      }),
    })
    .optional(),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
});

export type UniversalDocumentData = z.infer<typeof universalDocumentDataSchema>;

export const generateTemplateAiSchema = z.object({
  prompt: z.string().min(3),
  baseConfig: documentTemplateConfigSchema.optional(),
});
export type GenerateTemplateAiInput = z.infer<typeof generateTemplateAiSchema>;
