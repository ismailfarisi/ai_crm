import { z } from 'zod';

export const CONTACT_STATUSES = ['lead', 'qualified', 'customer', 'churned', 'archived'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_SOURCES = [
  'website',
  'referral',
  'outbound',
  'event',
  'partner',
  'other',
] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  lead: 'Lead',
  qualified: 'Qualified',
  customer: 'Customer',
  churned: 'Churned',
  archived: 'Archived',
};

export const CONTACT_SOURCE_LABELS: Record<ContactSource, string> = {
  website: 'Website',
  referral: 'Referral',
  outbound: 'Outbound',
  event: 'Event',
  partner: 'Partner',
  other: 'Other',
};

/**
 * Optional text fields normalise blank input to `null` so the database holds one
 * representation of "not set" rather than three.
 *
 * They accept `null` as *input* as well, which matters: a contact loaded from
 * the API comes back with nulls, and editing then re-submitting it must not be
 * rejected by the very schema that produced those nulls.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

export const createContactSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(255)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v))
    .refine((v) => v === null || z.email().safeParse(v).success, 'Enter a valid email address'),
  phone: optionalText(40),
  company: optionalText(120),
  jobTitle: optionalText(120),
  status: z.enum(CONTACT_STATUSES).default('lead'),
  source: z.enum(CONTACT_SOURCES).default('other'),
  notes: optionalText(5000),
  ownerId: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v))
    .refine((v) => v === null || z.uuid().safeParse(v).success, 'Select a valid owner'),
});

export const updateContactSchema = createContactSchema.partial();

export const contactQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  source: z.enum(CONTACT_SOURCES).optional(),
  ownerId: z.uuid().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'lastName', 'company', 'status']).default('createdAt'),
  sortOrder: z.enum(['ASC', 'DESC']).default('DESC'),
});

/** What a form or caller may supply (blank strings and undefined allowed). */
export type CreateContactInput = z.input<typeof createContactSchema>;
export type UpdateContactInput = z.input<typeof updateContactSchema>;
export type ContactQuery = z.input<typeof contactQuerySchema>;

/** What the schema produces, and what actually goes over the wire. */
export type CreateContactPayload = z.output<typeof createContactSchema>;
export type UpdateContactPayload = z.output<typeof updateContactSchema>;
