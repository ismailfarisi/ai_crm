/**
 * Tax codes, the rules that choose them, and the arithmetic on documents.
 *
 * Before this, tax was a bare percentage typed onto each line. That cannot
 * express the one case that matters most across a border: a business sale to
 * another EU country is charged at 0% *and* has to say "reverse charge" on the
 * invoice — two different facts that a number on its own collapses into "no
 * tax". A code carries both, and a rule picks the code from the customer's
 * address so nobody has to remember which treatment applies.
 */

export type TaxKind = 'SALES' | 'PURCHASE';

export interface TaxCodeDto {
  id: string;
  code: string;
  name: string;
  /** Percentage, 0-100, matching `QuoteLineItem.taxRate`. */
  rate: number;
  kind: TaxKind;
  /** Charged at 0%; the buyer accounts for the tax. Printed on the invoice. */
  isReverseCharge: boolean;
  /** Null posts to the chart's tax payable account. */
  ledgerAccountId: string | null;
  isActive: boolean;
}

export interface TaxRuleDto {
  id: string;
  kind: TaxKind;
  /** ISO 3166 alpha-2, `EU` for any EU member, or `*` for anywhere. */
  country: string;
  /** Matches only customers with a tax / VAT number — the B2B condition for reverse charge. */
  requiresTaxId: boolean;
  taxCodeId: string;
  priority: number;
}

/* ------------------------------------------------------------------ *
 * Countries
 * ------------------------------------------------------------------ */

export const EU_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
] as const;

/**
 * Names people actually type into an address form. Customer country is free
 * text today, so "United Kingdom", "UK", "gb" and "Great Britain" all have to
 * land on the same code before a rule can match them.
 */
const COUNTRY_NAMES: Record<string, string> = {
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', britain: 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'northern ireland': 'GB',
  'united states': 'US', 'united states of america': 'US', usa: 'US', america: 'US',
  ireland: 'IE', 'republic of ireland': 'IE', eire: 'IE',
  germany: 'DE', deutschland: 'DE', france: 'FR', spain: 'ES', espana: 'ES', 'españa': 'ES', italy: 'IT', italia: 'IT',
  netherlands: 'NL', 'the netherlands': 'NL', holland: 'NL', belgium: 'BE', luxembourg: 'LU', austria: 'AT', portugal: 'PT',
  sweden: 'SE', denmark: 'DK', finland: 'FI', poland: 'PL', czechia: 'CZ', 'czech republic': 'CZ', slovakia: 'SK',
  slovenia: 'SI', hungary: 'HU', romania: 'RO', bulgaria: 'BG', croatia: 'HR', greece: 'GR', cyprus: 'CY', malta: 'MT',
  estonia: 'EE', latvia: 'LV', lithuania: 'LT', norway: 'NO', switzerland: 'CH', canada: 'CA', australia: 'AU',
  'new zealand': 'NZ', india: 'IN', 'united arab emirates': 'AE', uae: 'AE', 'saudi arabia': 'SA', singapore: 'SG',
  japan: 'JP', china: 'CN', 'hong kong': 'HK', 'south africa': 'ZA', mexico: 'MX', brazil: 'BR',
};

/** GB for "United Kingdom", "uk", "GB" or " gb "; null when it cannot tell. */
export function normaliseCountry(value: string | null | undefined): string | null {
  const text = (value ?? '').trim().toLowerCase().replace(/\./g, '');
  if (!text) return null;
  if (COUNTRY_NAMES[text]) return COUNTRY_NAMES[text];
  if (/^[a-z]{2}$/.test(text)) return text === 'uk' ? 'GB' : text.toUpperCase();
  return null;
}

export const isEuCountry = (iso2: string | null): boolean =>
  iso2 != null && (EU_COUNTRIES as readonly string[]).includes(iso2);

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

export interface TaxParty {
  country: string | null;
  taxId: string | null;
}

export interface TaxResolution {
  code: TaxCodeDto;
  rule: TaxRuleDto;
  country: string | null;
}

/**
 * Picks the tax code for a party.
 *
 * Specificity decides, then priority: an exact country beats `EU`, which
 * beats `*`; within the same country, a rule that needs a tax number beats
 * one that does not when the party has one. That ordering is what lets a
 * tenant say three things and have them compose — "GB: standard 20%",
 * "EU with a VAT number: reverse charge", "anywhere else: zero-rated export"
 * — without the home country ever being caught by the EU rule, because the
 * exact GB rule is more specific.
 *
 * Returns null when no rule matches, and the caller keeps whatever rate the
 * line already had. No rules configured means tax behaves exactly as before.
 */
export function resolveTaxCode(
  party: TaxParty,
  kind: TaxKind,
  rules: TaxRuleDto[],
  codes: TaxCodeDto[],
): TaxResolution | null {
  const country = normaliseCountry(party.country);
  const hasTaxId = Boolean(party.taxId?.trim());
  const byId = new Map(codes.filter((c) => c.isActive && c.kind === kind).map((c) => [c.id, c]));

  const specificity = (rule: TaxRuleDto): number => {
    const target = rule.country.toUpperCase();
    if (country && target === country) return 3;
    if (target === 'EU' && isEuCountry(country)) return 2;
    if (target === '*') return 1;
    return 0;
  };

  const candidates = rules
    .filter((rule) => rule.kind === kind && byId.has(rule.taxCodeId))
    .filter((rule) => specificity(rule) > 0)
    .filter((rule) => !rule.requiresTaxId || hasTaxId)
    .sort(
      (a, b) =>
        specificity(b) - specificity(a) ||
        Number(b.requiresTaxId) - Number(a.requiresTaxId) ||
        b.priority - a.priority,
    );

  const rule = candidates[0];
  return rule ? { rule, code: byId.get(rule.taxCodeId)!, country } : null;
}

/* ------------------------------------------------------------------ *
 * Breakdown
 * ------------------------------------------------------------------ */

export interface TaxBreakdownLine {
  /** Null for lines taxed at a bare rate from before codes existed. */
  taxCodeId: string | null;
  code: string;
  rate: number;
  reverseCharge: boolean;
  net: number;
  tax: number;
}

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);

/**
 * Net and tax per code, for a document's lines.
 *
 * Tax is computed per code on the summed net, not summed per line: that is
 * how a tax return is prepared, and summing forty rounded line taxes can
 * differ from the tax on the total by several pence.
 */
export function taxBreakdown(
  lines: { net: number; rate: number; taxCodeId?: string | null; code?: string | null; reverseCharge?: boolean }[],
): TaxBreakdownLine[] {
  const groups = new Map<string, TaxBreakdownLine & { netCents: number }>();
  for (const line of lines) {
    const reverseCharge = Boolean(line.reverseCharge);
    const rate = reverseCharge ? 0 : Math.max(0, Number(line.rate) || 0);
    const key = `${line.taxCodeId ?? `rate:${rate}`}|${reverseCharge}`;
    const group = groups.get(key) ?? {
      taxCodeId: line.taxCodeId ?? null,
      code: line.code ?? `${rate}%`,
      rate,
      reverseCharge,
      net: 0,
      tax: 0,
      netCents: 0,
    };
    group.netCents += cents(Number(line.net) || 0);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ netCents, ...g }) => ({
    ...g,
    net: netCents / 100,
    tax: Math.round((netCents * g.rate) / 100) / 100,
  }));
}

/**
 * Scales a breakdown to a share of the document, to the cent, keeping the
 * totals fixed: the last group takes the remainder, so a 30% deposit and a 70%
 * balance still add up to the tax on the quote.
 */
export function scaleBreakdown(
  breakdown: TaxBreakdownLine[],
  target: { net: number; tax: number },
): TaxBreakdownLine[] {
  const totalNet = cents(breakdown.reduce((s, b) => s + b.net, 0));
  const totalTax = cents(breakdown.reduce((s, b) => s + b.tax, 0));
  let netLeft = cents(target.net);
  let taxLeft = cents(target.tax);
  return breakdown.map((b, i) => {
    const last = i === breakdown.length - 1;
    const net = last ? netLeft : totalNet ? Math.round((cents(b.net) * cents(target.net)) / totalNet) : 0;
    const tax = last ? taxLeft : totalTax ? Math.round((cents(b.tax) * cents(target.tax)) / totalTax) : 0;
    netLeft -= net;
    taxLeft -= tax;
    return { ...b, net: net / 100, tax: tax / 100 };
  });
}

export const REVERSE_CHARGE_NOTICE =
  'Reverse charge: the customer is liable to account for the VAT on this supply.';

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

export interface TaxReportRow {
  taxCodeId: string | null;
  code: string;
  rate: number;
  reverseCharge: boolean;
  net: number;
  tax: number;
  documents: number;
}

export interface TaxReportDto {
  from: string;
  to: string;
  /** Tax charged on sales, net of credit notes. */
  output: TaxReportRow[];
  /** Tax paid on purchases. */
  input: TaxReportRow[];
  outputTax: number;
  inputTax: number;
  /** What is owed to the tax authority for the period; negative is a reclaim. */
  netPayable: number;
  /** Sales where the customer accounts for the tax — reported, but no tax charged. */
  reverseChargeNet: number;
}
