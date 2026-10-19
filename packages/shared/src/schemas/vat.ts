import { z } from 'zod';
import {
  EMIRATES,
  VAT_STATUSES,
  isPeriodStart,
  isValidTrn,
  normaliseTrn,
  type Emirate,
  type VatFrequency,
} from '../tax/uae';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

/** A UAE emirate code; blank input normalises to `null`. */
export const emirateField = z
  .enum(EMIRATES)
  .nullish()
  .transform((v) => v ?? null);

/** A party's VAT registration status. No default here: the API decides. */
export const vatStatusField = z
  .enum(VAT_STATUSES)
  .nullish()
  .transform((v) => v ?? null);

export const UAE_TRN_MESSAGE = 'A UAE TRN is 15 digits';

/**
 * The TRN rule, shared by customers, suppliers and the organization profile.
 *
 * Applies only when the record itself carries `country`: a PATCH that omits
 * it is re-validated by the service against the stored record.
 */
export function applyUaeTrn<T extends { country?: string | null; taxId?: string | null }>(
  value: T,
  ctx: z.core.$RefinementCtx<T>,
): T {
  if (value.country !== 'AE' || value.taxId == null) return value;
  if (!isValidTrn(value.taxId)) {
    ctx.issues.push({ code: 'custom', message: UAE_TRN_MESSAGE, input: value, path: ['taxId'] });
    return value;
  }
  return { ...value, taxId: normaliseTrn(value.taxId) };
}

/** `applyUaeTrn`, plus: outside the UAE an emirate is meaningless, so it is cleared. */
export function applyUaeParty<
  T extends { country?: string | null; taxId?: string | null; emirate?: Emirate | null },
>(value: T, ctx: z.core.$RefinementCtx<T>): T {
  const checked = applyUaeTrn(value, ctx);
  if (checked.country === undefined || checked.country === 'AE') return checked;
  return { ...checked, emirate: null };
}

/* ------------------------------------------------------------------ *
 * Branches
 * ------------------------------------------------------------------ */

export const branchSchema = z.object({
  name: z.string().trim().min(1, 'Branch name is required').max(120),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(120),
  emirate: emirateField,
  isHeadOffice: z.boolean().default(false),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v))
    .refine(
      (v) => v === null || /^[A-Z0-9]{2,6}$/.test(v),
      'Use 2 to 6 letters or digits for the invoice prefix',
    ),
  isActive: z.boolean().default(true),
});

export type BranchPayload = z.output<typeof branchSchema>;

export interface BranchDto {
  id: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  emirate: Emirate | null;
  isHeadOffice: boolean;
  invoicePrefix: string | null;
  isActive: boolean;
}

/* ------------------------------------------------------------------ *
 * VAT settings
 * ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export const vatSettingsSchema = z
  .object({
    periodFrequency: z.enum(['MONTHLY', 'QUARTERLY']),
    firstPeriodStart: isoDate.regex(/^\d{4}-\d{2}-01$/, 'A tax period starts on the 1st of a month'),
    registrationDate: isoDate,
    vatStartDate: isoDate,
    taxAgentName: optionalText(200),
    taxAgencyName: optionalText(200),
    tan: optionalText(20),
    taan: optionalText(20),
  })
  .refine((v) => v.vatStartDate >= v.firstPeriodStart, {
    path: ['vatStartDate'],
    message: 'The VAT start date cannot be before the first tax period',
  })
  .refine(
    (v) =>
      v.vatStartDate < v.firstPeriodStart ||
      !/^\d{4}-\d{2}-01$/.test(v.firstPeriodStart) ||
      isPeriodStart(v.firstPeriodStart, v.periodFrequency, v.vatStartDate),
    {
      path: ['vatStartDate'],
      message: 'The VAT start date must be the first day of a tax period',
    },
  );

export type VatSettingsPayload = z.output<typeof vatSettingsSchema>;

export interface VatSettingsDto {
  periodFrequency: VatFrequency;
  firstPeriodStart: string;
  registrationDate: string;
  vatStartDate: string;
  taxAgentName: string | null;
  taxAgencyName: string | null;
  tan: string | null;
  taan: string | null;
}

/** What `GET /tax/uae` returns: whether UAE mode is on, and what is missing if not. */
export interface UaeVatStatusDto {
  enabled: boolean;
  problems: string[];
  settings: VatSettingsDto | null;
  suggestedVatStartDate: string | null;
}
