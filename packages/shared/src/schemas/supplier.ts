import { z } from 'zod';

/**
 * Deliberately the same shape as `customer.ts`, field for field where the two
 * overlap. A supplier and a customer are the same kind of record pointing in
 * opposite directions, and two subtly different address schemas would be a
 * source of bugs rather than a distinction worth making.
 *
 * Blank text normalises to `null` so the database holds one representation of
 * "not set", and `null` is accepted as *input* too — a supplier loaded from
 * the API has to be re-submittable without the schema rejecting its own nulls.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .max(3)
  .nullish()
  .transform((v) => (v == null || v === '' ? null : v))
  .refine((v) => v === null || /^[A-Z]{3}$/.test(v), 'Enter a 3-letter currency code (e.g. USD)');

const days = (max: number) =>
  z.coerce
    .number()
    .int()
    .min(0)
    .max(max)
    .nullish()
    .transform((v) => (v == null || Number.isNaN(v) ? null : v));

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .nullish()
  .transform((v) => (v == null || v === '' ? null : v))
  .refine((v) => v === null || z.email().safeParse(v).success, 'Enter a valid email address');

export const createSupplierSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required').max(120),
  contactName: optionalText(120),
  email,
  phone: optionalText(40),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  postalCode: optionalText(20),
  country: optionalText(80),
  taxId: optionalText(40),
  currency: currency.default('USD'),
  paymentTermsDays: days(365).default(30),
  /** Order-to-delivery, used to propose an expected date on a purchase order. */
  leadTimeDays: days(365).default(7),
  isActive: z.boolean().default(true),
  notes: optionalText(5000),
});

/**
 * No defaults, for the same reason `updateCustomerSchema` has none: on a PATCH
 * they would fire for omitted fields and quietly reset values the caller never
 * mentioned.
 */
export const updateSupplierSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required').max(120).optional(),
  contactName: optionalText(120).optional(),
  email: email.optional(),
  phone: optionalText(40).optional(),
  addressLine1: optionalText(160).optional(),
  addressLine2: optionalText(160).optional(),
  city: optionalText(80).optional(),
  postalCode: optionalText(20).optional(),
  country: optionalText(80).optional(),
  taxId: optionalText(40).optional(),
  currency: currency.optional(),
  paymentTermsDays: days(365).optional(),
  leadTimeDays: days(365).optional(),
  isActive: z.boolean().optional(),
  notes: optionalText(5000).optional(),
});

export const supplierQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  includeInactive: z.coerce.boolean().default(false),
  sortBy: z.enum(['createdAt', 'updatedAt', 'companyName', 'country']).default('createdAt'),
  sortOrder: z.enum(['ASC', 'DESC']).default('DESC'),
});

/** One row of a supplier's price list. */
export const upsertSupplierMaterialSchema = z.object({
  materialId: z.string().uuid(),
  supplierSku: optionalText(60),
  unitCost: z.coerce.number().min(0),
  minOrderQty: z.coerce
    .number()
    .min(0)
    .nullish()
    .transform((v) => (v == null || Number.isNaN(v) ? null : v)),
  leadTimeDays: days(365),
  isPreferred: z.boolean().default(false),
});

export const replaceSupplierMaterialsSchema = z.object({
  items: z.array(upsertSupplierMaterialSchema).max(500),
});

export type CreateSupplierInput = z.input<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.input<typeof updateSupplierSchema>;
export type SupplierQuery = z.input<typeof supplierQuerySchema>;
export type ReplaceSupplierMaterialsInput = z.input<typeof replaceSupplierMaterialsSchema>;

export type CreateSupplierPayload = z.output<typeof createSupplierSchema>;
export type UpdateSupplierPayload = z.output<typeof updateSupplierSchema>;
export type SupplierQueryPayload = z.output<typeof supplierQuerySchema>;
export type ReplaceSupplierMaterialsPayload = z.output<typeof replaceSupplierMaterialsSchema>;
