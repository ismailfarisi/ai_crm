import { z } from 'zod';

/**
 * The company behind the documents.
 *
 * Everything here prints on a quote or an invoice, so it is validated the same
 * way on both sides: the API enforces this schema and the Company screen shows
 * its messages inline.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

/**
 * ISO 3166-1 alpha-2, upper-cased on the way in.
 *
 * Tax rules match an exact country code, then `EU`, then `*`, so a free-text
 * country silently matches nothing — which is the bug the customer and
 * supplier forms still have.
 */
const countryCode = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v == null || v === '' ? null : v.toUpperCase()))
  .refine((v) => v == null || /^[A-Z]{2}$/.test(v), {
    message: 'Country must be a two-letter code, such as US or GB',
  });

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120).optional(),
  legalName: optionalText(200),
  taxId: optionalText(60),
  registrationNumber: optionalText(60),
  email: z
    .union([z.literal(''), z.string().trim().email('Enter a valid email address')])
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
  phone: optionalText(40),
  website: optionalText(200),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(120),
  region: optionalText(120),
  postalCode: optionalText(30),
  country: countryCode,
  documentFooter: optionalText(2000),
});

export type UpdateOrganizationPayload = z.output<typeof updateOrganizationSchema>;
export type UpdateOrganizationInputRaw = z.input<typeof updateOrganizationSchema>;

/** What `GET /organization` returns. */
export interface OrganizationProfileDto {
  id: string;
  name: string;
  slug: string;
  baseCurrency: string;
  legalName: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  documentFooter: string | null;
  /**
   * Where the logo is served from, or null when none is set.
   *
   * Carries the upload time as a query parameter so replacing the logo
   * replaces what a browser has cached.
   */
  logoUrl: string | null;
}

/**
 * The address as it should read on a document, one line per entry.
 *
 * Kept here rather than in a component so the web app, a PDF and the public
 * quote page cannot drift into three different formats.
 */
export function formatOrganizationAddress(
  org: Pick<
    OrganizationProfileDto,
    'addressLine1' | 'addressLine2' | 'city' | 'region' | 'postalCode' | 'country'
  >,
): string[] {
  const cityLine = [org.city, org.region, org.postalCode].filter(Boolean).join(', ');

  return [org.addressLine1, org.addressLine2, cityLine, org.country]
    .map((line) => (line ?? '').trim())
    .filter((line) => line.length > 0);
}
