import type { QuoteLineItem, QuoteTotals } from './types';

/**
 * Commercial floors a tenant sets on its own quoting.
 *
 * One row per tenant. `enforce` is off until someone configures it, so
 * turning the costing engine on does not retroactively block quotes that
 * were fine yesterday.
 */
export interface CostingPolicy {
  /** Minimum acceptable margin as a fraction of the untaxed subtotal, 0-1. */
  minMarginPct: number;
  /** Maximum discount on any single line, 0-100. */
  maxDiscountPct: number;
  /**
   * Whether a line with no cost snapshot (typed by hand) blocks approval.
   * A quote whose margin is unknown is not the same as one that is healthy.
   */
  requireKnownCost: boolean;
  enforce: boolean;
}

export const DEFAULT_COSTING_POLICY: CostingPolicy = {
  minMarginPct: 0.2,
  maxDiscountPct: 20,
  requireKnownCost: false,
  enforce: false,
};

export type GuardrailCode = 'MARGIN_BELOW_FLOOR' | 'DISCOUNT_ABOVE_CAP' | 'COST_UNKNOWN';

export interface GuardrailViolation {
  code: GuardrailCode;
  /** Written for the person who has to act on it, not for a log. */
  message: string;
  /** Present when the violation belongs to one line rather than the quote. */
  lineId?: string;
  actual: number;
  limit: number;
}

const asPercent = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

/**
 * Checks a quote against its tenant's policy.
 *
 * Pure and shared so the editor can warn as the user types and the API can
 * refuse on save with exactly the same reasoning — the browser copy is a
 * convenience, the server copy is the rule.
 */
export function evaluateGuardrails(
  items: QuoteLineItem[],
  totals: QuoteTotals,
  policy: CostingPolicy,
): GuardrailViolation[] {
  if (!policy.enforce) return [];

  const violations: GuardrailViolation[] = [];

  for (const item of items || []) {
    if (item.type !== 'product') continue;

    const discount = Number(item.discount) || 0;
    if (discount > policy.maxDiscountPct) {
      violations.push({
        code: 'DISCOUNT_ABOVE_CAP',
        message: `"${item.description || 'Untitled line'}" is discounted ${discount}%, above the ${policy.maxDiscountPct}% cap`,
        lineId: item.id,
        actual: discount,
        limit: policy.maxDiscountPct,
      });
    }
  }

  // Only meaningful once something is actually priced.
  if (totals.subtotalAmount > 0) {
    if (policy.requireKnownCost && !totals.hasCompleteCost) {
      violations.push({
        code: 'COST_UNKNOWN',
        message:
          'Some lines have no cost, so the margin on this quote cannot be verified. Add them from the catalog or a product template.',
        actual: 0,
        limit: 0,
      });
    }

    // A quote with unknown cost reports an overstated margin, so checking it
    // against the floor would pass something nobody has actually verified.
    const marginIsTrustworthy = totals.hasCompleteCost;
    if (marginIsTrustworthy && totals.marginPct < policy.minMarginPct) {
      violations.push({
        code: 'MARGIN_BELOW_FLOOR',
        message: `Margin is ${asPercent(totals.marginPct)}, below the ${asPercent(policy.minMarginPct)} floor`,
        actual: totals.marginPct,
        limit: policy.minMarginPct,
      });
    }
  }

  return violations;
}

/** True when nothing blocks this quote from being approved as it stands. */
export function isWithinPolicy(violations: GuardrailViolation[]): boolean {
  return violations.length === 0;
}
