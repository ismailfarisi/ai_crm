import type { TaxCodeDto, TaxKind, VatTreatment } from '@saas/shared';

/**
 * Where documents on a tax code land on the VAT201, mirroring `buildVat201`
 * in shared: an untreated code falls back on its rate, and an untaxed sale
 * with no treatment is left off with a warning. Null means off the return.
 */
export function vatBoxes(kind: TaxKind, treatment: VatTreatment | null, rate: number): string | null {
  const t = treatment ?? (rate > 0 ? 'STANDARD' : null);
  if (kind === 'SALES') {
    switch (t) {
      case 'STANDARD':
      case 'REVERSE_CHARGE':
        return 'box 1';
      case 'ZERO_RATED':
        return 'box 4';
      case 'EXEMPT':
        return 'box 5';
      default:
        return null;
    }
  }
  switch (t) {
    case 'STANDARD':
      return 'box 9';
    case 'REVERSE_CHARGE':
      return 'boxes 3 and 10';
    case 'IMPORT_GOODS':
      return 'boxes 6 and 10';
    default:
      return null;
  }
}

/**
 * What changing a code's treatment does to the return, in a sentence. The
 * return reads each code's treatment when it is built, so documents already
 * raised on the code move too.
 */
export function describeTreatmentChange(code: TaxCodeDto, next: VatTreatment): string {
  const what = code.kind === 'SALES' ? 'Sales' : 'Supplier bills';
  const rate = Number(code.rate);
  const from = vatBoxes(code.kind, code.treatment, rate);
  const to = vatBoxes(code.kind, next, rate);
  const already = `${what} already raised on ${code.code} move too.`;
  if (from === to) {
    return from
      ? `${what} on it stay in ${from} on the VAT return.`
      : `${what} on it stay off the VAT return.`;
  }
  if (!from) return `${what} on it go onto the VAT return in ${to}. ${already}`;
  if (!to) return `${what} on it come off the VAT return (they were in ${from}). ${already}`;
  return `${what} on it move from ${from} to ${to} on the VAT return. ${already}`;
}
