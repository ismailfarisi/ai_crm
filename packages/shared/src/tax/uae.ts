/**
 * UAE VAT rules that do not depend on a database: TRNs, emirates, VAT
 * statuses, treatments, the starter code set and tax-period arithmetic.
 *
 * Kept pure and in `shared` so the zod schemas, the API and the web forms all
 * ask the same question the same way — "is this a valid TRN?" must never have
 * two answers depending on which side of the wire is asking.
 */
import type { TaxKind } from './tax';

/* ------------------------------------------------------------------ *
 * Emirates
 * ------------------------------------------------------------------ */

/** In VAT201 box order (1a-1g), so a report can iterate this list directly. */
export const EMIRATES = ['AUH', 'DXB', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ'] as const;
export type Emirate = (typeof EMIRATES)[number];

export const EMIRATE_NAMES: Record<Emirate, string> = {
  AUH: 'Abu Dhabi',
  DXB: 'Dubai',
  SHJ: 'Sharjah',
  AJM: 'Ajman',
  UAQ: 'Umm Al Quwain',
  RAK: 'Ras Al Khaimah',
  FUJ: 'Fujairah',
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const EMIRATE_LOOKUP: ReadonlyMap<string, Emirate> = new Map(
  EMIRATES.flatMap((code) => [
    [squash(code), code] as const,
    [squash(EMIRATE_NAMES[code]), code] as const,
  ]),
);

/**
 * Reads an emirate out of free text such as an address region. Whole-string
 * matches only: "Business Bay" is a district, not a guess at Dubai, and a
 * wrong emirate puts the sale in the wrong VAT201 box.
 */
export function emirateFromText(text: string | null | undefined): Emirate | null {
  if (!text) return null;
  return EMIRATE_LOOKUP.get(squash(text)) ?? null;
}

/* ------------------------------------------------------------------ *
 * Tax registration number
 * ------------------------------------------------------------------ */

/** Digits only, or null. Spaces and dashes are how people type and paste it. */
export function normaliseTrn(value: string | null | undefined): string | null {
  if (value == null) return null;
  const stripped = value.replace(/[\s-]/g, '');
  return stripped === '' ? null : stripped;
}

/**
 * Exactly 15 digits. No check on the leading `100` and no live FTA lookup:
 * the format is all we can prove offline, and rejecting a real TRN is worse
 * than accepting a typo the FTA validates later.
 */
export function isValidTrn(value: string | null | undefined): boolean {
  const trn = normaliseTrn(value);
  return trn !== null && /^\d{15}$/.test(trn);
}

/* ------------------------------------------------------------------ *
 * VAT status of a customer or supplier
 * ------------------------------------------------------------------ */

export const VAT_STATUSES = ['REGISTERED', 'NOT_REGISTERED', 'OUTSIDE_UAE'] as const;
export type VatStatus = (typeof VAT_STATUSES)[number];

/**
 * Country values that mean the UAE. Records typed before the picker existed
 * hold free text, so the legacy names count too; the migration's backfill
 * uses the same list.
 */
const UAE_COUNTRY_VALUES: ReadonlySet<string> = new Set([
  'ae',
  'united arab emirates',
  'uae',
  'u.a.e.',
]);

export function isUaeCountry(country: string | null | undefined): boolean {
  return country != null && UAE_COUNTRY_VALUES.has(country.trim().toLowerCase());
}

/**
 * The starting point for a party's status; the user can override it (for
 * instance, mark someone registered before their TRN arrives).
 */
export function defaultVatStatus(country: string | null, taxId: string | null): VatStatus {
  const trimmed = country?.trim() || null;
  if (trimmed && !isUaeCountry(trimmed)) return 'OUTSIDE_UAE';
  return trimmed && isValidTrn(taxId) ? 'REGISTERED' : 'NOT_REGISTERED';
}

/**
 * The tax ID to store for a party in this country. In the UAE it must be a
 * TRN and is returned as digits; elsewhere (or when absent) it is returned
 * unchanged. Throws so each caller can choose its own error type.
 */
export function assertUaeTrn(country: string | null, taxId: string | null): string | null {
  if (!isUaeCountry(country) || taxId == null) return taxId;
  if (!isValidTrn(taxId)) throw new Error('A UAE TRN is 15 digits');
  return normaliseTrn(taxId);
}

/**
 * The status to store for a party. An explicit `patch.vatStatus` wins (null
 * means "not explicitly set", so a form that sends null does not wipe it).
 * Otherwise the status is re-derived on create, or when the patch touches the
 * country or tax ID; failing that the current status stands.
 */
export function resolveVatStatus(
  current: { country: string | null; taxId: string | null; vatStatus: VatStatus | null } | null,
  patch: { country?: string | null; taxId?: string | null; vatStatus?: VatStatus | null },
): VatStatus {
  if (patch.vatStatus != null) return patch.vatStatus;
  const touched = patch.country !== undefined || patch.taxId !== undefined;
  if (current && !touched && current.vatStatus != null) return current.vatStatus;
  return defaultVatStatus(
    patch.country !== undefined ? patch.country : (current?.country ?? null),
    patch.taxId !== undefined ? patch.taxId : (current?.taxId ?? null),
  );
}

/* ------------------------------------------------------------------ *
 * Treatments
 * ------------------------------------------------------------------ */

/**
 * A rate alone cannot tell zero-rated from exempt from out of scope, and the
 * VAT201 reports each in a different box. The treatment carries that fact.
 */
export const VAT_TREATMENTS = [
  'STANDARD',
  'ZERO_RATED',
  'EXEMPT',
  'OUT_OF_SCOPE',
  'REVERSE_CHARGE',
  'BLOCKED',
  'IMPORT_GOODS',
] as const;
export type VatTreatment = (typeof VAT_TREATMENTS)[number];

/** BLOCKED and IMPORT_GOODS only make sense on what we buy. */
export const SALES_TREATMENTS: readonly VatTreatment[] = [
  'STANDARD',
  'ZERO_RATED',
  'EXEMPT',
  'OUT_OF_SCOPE',
  'REVERSE_CHARGE',
];

export function treatmentAllowed(kind: TaxKind, t: VatTreatment): boolean {
  return kind === 'PURCHASE' || SALES_TREATMENTS.includes(t);
}

/** The buyer self-assesses the tax: output and input VAT are both booked. */
export function treatmentIsReverseCharge(t: VatTreatment | null): boolean {
  return t === 'REVERSE_CHARGE' || t === 'IMPORT_GOODS';
}

/**
 * The rate a code with this treatment must carry. Unlike the EU path, a UAE
 * purchase reverse-charge or import code is 5%: that is the self-assessed
 * rate. A sales reverse-charge is only a printed notice, so it stays 0.
 */
export function expectedUaeRate(kind: TaxKind, t: VatTreatment): number {
  switch (t) {
    case 'STANDARD':
    case 'BLOCKED':
    case 'IMPORT_GOODS':
      return 5;
    case 'REVERSE_CHARGE':
      return kind === 'PURCHASE' ? 5 : 0;
    default:
      return 0;
  }
}

/* ------------------------------------------------------------------ *
 * UAE VAT mode
 * ------------------------------------------------------------------ */

/**
 * Everything UAE-specific switches on together, and only when the tenant is
 * a UAE business with a TRN reporting in dirhams. The VAT201 and the FTA
 * audit file are in AED, so another base currency would have nothing honest
 * to report.
 */
export function isUaeVatMode(org: {
  country: string | null;
  taxId: string | null;
  baseCurrency: string;
}): boolean {
  return org.country === 'AE' && isValidTrn(org.taxId) && org.baseCurrency === 'AED';
}

/* ------------------------------------------------------------------ *
 * Starter codes and rules
 * ------------------------------------------------------------------ */

export const UAE_STARTER_CODES: ReadonlyArray<{
  code: string;
  name: string;
  rate: number;
  kind: TaxKind;
  treatment: VatTreatment;
}> = [
  { code: 'SR', name: 'Standard rated 5%', rate: 5, kind: 'SALES', treatment: 'STANDARD' },
  { code: 'ZR', name: 'Zero rated', rate: 0, kind: 'SALES', treatment: 'ZERO_RATED' },
  { code: 'EX', name: 'Exempt', rate: 0, kind: 'SALES', treatment: 'EXEMPT' },
  { code: 'OS', name: 'Out of scope', rate: 0, kind: 'SALES', treatment: 'OUT_OF_SCOPE' },
  { code: 'SR', name: 'Standard rated 5%', rate: 5, kind: 'PURCHASE', treatment: 'STANDARD' },
  { code: 'ZR', name: 'Zero rated', rate: 0, kind: 'PURCHASE', treatment: 'ZERO_RATED' },
  { code: 'EX', name: 'Exempt', rate: 0, kind: 'PURCHASE', treatment: 'EXEMPT' },
  { code: 'BL', name: 'Blocked input VAT 5%', rate: 5, kind: 'PURCHASE', treatment: 'BLOCKED' },
  { code: 'RC', name: 'Reverse charge 5%', rate: 5, kind: 'PURCHASE', treatment: 'REVERSE_CHARGE' },
  { code: 'IM', name: 'Import of goods 5%', rate: 5, kind: 'PURCHASE', treatment: 'IMPORT_GOODS' },
];

/**
 * Exports default to zero-rated and imported services to reverse charge; both
 * are only defaults. Goods imports are chosen as `IM` on the bill.
 */
export const UAE_STARTER_RULES: ReadonlyArray<{ kind: TaxKind; country: string; code: string }> = [
  { kind: 'SALES', country: 'AE', code: 'SR' },
  { kind: 'SALES', country: '*', code: 'ZR' },
  { kind: 'PURCHASE', country: 'AE', code: 'SR' },
  { kind: 'PURCHASE', country: '*', code: 'RC' },
];

/* ------------------------------------------------------------------ *
 * Tax periods
 *
 * Plain `YYYY-MM-DD` strings and year/month integers, never `Date`: a tax
 * period is a calendar fact, and a timezone shift must not move its edge.
 * ------------------------------------------------------------------ */

export type VatFrequency = 'MONTHLY' | 'QUARTERLY';

/** ISO dates; `end` is inclusive. */
export interface TaxPeriod {
  start: string;
  end: string;
}

const MONTHS_PER_PERIOD: Record<VatFrequency, number> = { MONTHLY: 1, QUARTERLY: 3 };

function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** A real calendar date as `YYYY-MM-DD`: 2026-02-30 and 2026-13-01 are not. */
export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Months since year 0, so periods can be counted across year boundaries. */
function monthIndex(iso: string): number {
  if (!isIsoDate(iso)) throw new Error(`Expected a YYYY-MM-DD date, got "${iso}"`);
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
}

function assertAnchor(anchor: string): void {
  monthIndex(anchor);
  if (!anchor.endsWith('-01')) throw new Error('A VAT period must start on the 1st of a month');
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

function firstOfMonth(index: number): string {
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1, 2)}-01`;
}

/** Index of the month in which the period containing `date` begins. */
function periodStartIndex(anchor: string, freq: VatFrequency, date: string): number {
  assertAnchor(anchor);
  const step = MONTHS_PER_PERIOD[freq];
  const anchorIdx = monthIndex(anchor);
  // Floor division so dates before the anchor tile backwards correctly.
  return anchorIdx + Math.floor((monthIndex(date) - anchorIdx) / step) * step;
}

export function periodContaining(anchor: string, freq: VatFrequency, date: string): TaxPeriod {
  const startIdx = periodStartIndex(anchor, freq, date);
  // The period ends on the last day of its final month; derive it without Date.
  const endIdx = startIdx + MONTHS_PER_PERIOD[freq] - 1;
  const year = Math.floor(endIdx / 12);
  const month = (endIdx % 12) + 1;
  const lastDay = daysInMonth(year, month);
  return {
    start: firstOfMonth(startIdx),
    end: `${pad(year, 4)}-${pad(month, 2)}-${pad(lastDay, 2)}`,
  };
}

export function isPeriodStart(anchor: string, freq: VatFrequency, date: string): boolean {
  return periodContaining(anchor, freq, date).start === date;
}

/** Start of the period after the one containing `date`, even when `date` is itself a start. */
export function nextPeriodStart(anchor: string, freq: VatFrequency, date: string): string {
  return firstOfMonth(periodStartIndex(anchor, freq, date) + MONTHS_PER_PERIOD[freq]);
}
