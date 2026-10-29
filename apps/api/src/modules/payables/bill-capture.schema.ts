import { z } from 'zod';
import type { CapturedField } from '@saas/shared';

const CAPTURED_FIELDS: CapturedField[] = [
  'supplier',
  'supplierInvoiceNumber',
  'purchaseOrderReference',
  'billDate',
  'dueDate',
  'currency',
  'taxAmount',
  'totalAmount',
  'lines',
];

const text = z
  .string()
  .nullish()
  .transform((v) => (v == null || v.trim() === '' ? null : v.trim()));

/** A date the model could not put in YYYY-MM-DD is as good as unread. */
const day = z
  .string()
  .nullish()
  .transform((v) =>
    v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null,
  );

const amount = z
  .number()
  .finite()
  .nullish()
  .transform((v) => v ?? null);

/**
 * Validates the model's read of an invoice before anything trusts it. Lines
 * that cannot be a bill line (no description, nothing billed) are dropped
 * rather than failing the whole read.
 */
export const capturedInvoiceSchema = z.object({
  isInvoice: z.boolean(),
  supplierName: text,
  supplierTaxId: text,
  supplierInvoiceNumber: text,
  purchaseOrderReference: text,
  billDate: day,
  dueDate: day,
  currency: z
    .string()
    .nullish()
    .transform((v) =>
      v && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : null,
    ),
  subtotalAmount: amount,
  taxAmount: amount,
  totalAmount: amount,
  lines: z
    .array(
      z.object({
        description: z.string(),
        qty: z.number().finite(),
        unitCost: z.number().finite(),
        lineTotal: z.number().finite(),
      }),
    )
    .default([])
    .transform((lines) =>
      lines
        .map((l) => ({ ...l, description: l.description.trim().slice(0, 255) }))
        .filter((l) => l.description && l.qty > 0 && l.unitCost >= 0),
    ),
  confidence: z.number().min(0).max(1),
  uncertainFields: z
    .array(z.string())
    .default([])
    .transform((fields) =>
      fields.filter((f): f is CapturedField =>
        (CAPTURED_FIELDS as string[]).includes(f),
      ),
    ),
});

const nullable = (type: 'string' | 'number', description?: string) => ({
  type: [type, 'null'],
  ...(description ? { description } : {}),
});

/** Hand-kept mirror of `capturedInvoiceSchema` for structured output. Keep the two in step. */
export const capturedInvoiceJsonSchema = {
  type: 'object',
  properties: {
    isInvoice: {
      type: 'boolean',
      description:
        'True only for a supplier invoice or tax invoice asking us to pay. False for a quotation, proforma, statement of account, delivery note or payment receipt.',
    },
    supplierName: nullable(
      'string',
      'The company that issued the invoice, as printed.',
    ),
    supplierTaxId: nullable(
      'string',
      'The supplier’s tax registration number (TRN in the UAE), as printed.',
    ),
    supplierInvoiceNumber: nullable(
      'string',
      'The invoice number the supplier gave this invoice.',
    ),
    purchaseOrderReference: nullable(
      'string',
      'Our purchase order number if the supplier quoted it — often labelled "Your PO", "LPO", "Order ref" or "Customer PO".',
    ),
    billDate: nullable('string', 'Invoice date as YYYY-MM-DD.'),
    dueDate: nullable(
      'string',
      'Payment due date as YYYY-MM-DD, only if printed.',
    ),
    currency: nullable(
      'string',
      '3-letter ISO code. AED for dirhams (AED, Dhs, د.إ).',
    ),
    subtotalAmount: nullable('number', 'Total before VAT, as printed.'),
    taxAmount: nullable('number', 'Total VAT, as printed.'),
    totalAmount: nullable('number', 'Total payable including VAT, as printed.'),
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          qty: { type: 'number' },
          unitCost: {
            type: 'number',
            description: 'Price per unit before VAT.',
          },
          lineTotal: { type: 'number', description: 'Line amount before VAT.' },
        },
        required: ['description', 'qty', 'unitCost', 'lineTotal'],
        additionalProperties: false,
      },
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'How sure you are of the read as a whole.',
    },
    uncertainFields: {
      type: 'array',
      items: { type: 'string', enum: CAPTURED_FIELDS },
      description: 'Fields that were unclear, cut off or guessed.',
    },
  },
  required: [
    'isInvoice',
    'supplierName',
    'supplierTaxId',
    'supplierInvoiceNumber',
    'purchaseOrderReference',
    'billDate',
    'dueDate',
    'currency',
    'subtotalAmount',
    'taxAmount',
    'totalAmount',
    'lines',
    'confidence',
    'uncertainFields',
  ],
  additionalProperties: false,
} as const;

export const BILL_CAPTURE_PROMPT_VERSION = 'bill-capture/1';

export const BILL_CAPTURE_INSTRUCTION = [
  'Read this supplier invoice: a bill a supplier has sent us to pay.',
  'Copy values exactly as printed. Do not calculate, correct or invent anything; use null for anything not printed.',
  'Dates on UAE invoices are usually day first (DD/MM/YYYY); convert them to YYYY-MM-DD.',
  'In the UAE an LPO (local purchase order) number is our purchase order number.',
  'Give one entry in lines for each billed line, with its quantity, unit price and line amount before VAT. Delivery, cutting or other charges are lines too.',
  'List in uncertainFields every field you could not read clearly, that was cut off, or that you had to guess.',
].join('\n');
