import { z } from 'zod';

/**
 * Optional text fields normalise blank input to `null` so the database holds one
 * representation of "not set" rather than three. See `contact.ts` for the same
 * helper and the reasoning behind accepting `null` as input too.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

/** ISO 4217 currency code, uppercased and blank-normalised. */
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .max(3)
  .nullish()
  .transform((v) => (v == null || v === '' ? null : v))
  .refine((v) => v === null || /^[A-Z]{3}$/.test(v), 'Enter a 3-letter currency code (e.g. USD)');

/** Payment terms in days; blank means "not set", coerced to an integer. */
const paymentTermsDays = z
  .coerce
  .number()
  .int()
  .min(0)
  .max(365)
  .nullish()
  .transform((v) => (v == null || Number.isNaN(v) ? null : v));

export const createCustomerSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required').max(120),
  contactName: optionalText(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(255)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v))
    .refine((v) => v === null || z.email().safeParse(v).success, 'Enter a valid email address'),
  phone: optionalText(40),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  postalCode: optionalText(20),
  country: optionalText(80),
  taxId: optionalText(40),
  currency: currency.default('USD'),
  paymentTermsDays: paymentTermsDays.default(30),
  notes: optionalText(5000),
});

/**
 * The create schema applies `currency`/`paymentTermsDays` defaults; on a PATCH
 * those must not fire when the field is omitted, or they would reset existing
 * values. So the update schema is defined from the same field shapes without
 * the defaults.
 */
export const updateCustomerSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required').max(120).optional(),
  contactName: optionalText(120).optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(255)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v))
    .refine((v) => v === null || z.email().safeParse(v).success, 'Enter a valid email address')
    .optional(),
  phone: optionalText(40).optional(),
  addressLine1: optionalText(160).optional(),
  addressLine2: optionalText(160).optional(),
  city: optionalText(80).optional(),
  postalCode: optionalText(20).optional(),
  country: optionalText(80).optional(),
  taxId: optionalText(40).optional(),
  currency: currency.optional(),
  paymentTermsDays: paymentTermsDays.optional(),
  notes: optionalText(5000).optional(),
});

export const customerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'companyName', 'city', 'country'])
    .default('createdAt'),
  sortOrder: z.enum(['ASC', 'DESC']).default('DESC'),
});

/** What a form or caller may supply (blank strings and undefined allowed). */
export type CreateCustomerInput = z.input<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;
export type CustomerQuery = z.input<typeof customerQuerySchema>;

/** What the schema produces, and what actually goes over the wire. */
export type CreateCustomerPayload = z.output<typeof createCustomerSchema>;
export type UpdateCustomerPayload = z.output<typeof updateCustomerSchema>;
