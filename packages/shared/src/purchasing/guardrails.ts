import type { PurchaseOrderLineDto, PurchaseOrderStatus } from './types';

/**
 * Commercial limits a tenant sets on its own buying.
 *
 * One row per tenant. `enforce` is off until someone configures it, taking
 * the same stance as `DEFAULT_COSTING_POLICY`: turning purchasing on must not
 * retroactively block orders that were fine yesterday.
 */
export interface PurchasePolicy {
  /**
   * Order total above which approval needs
   * `purchase_order:approve_above_threshold` as well as
   * `purchase_order:approve`.
   */
  approvalThreshold: number;
  /** Refuse a line whose supplier is not the preferred one for that material. */
  requirePreferredSupplier: boolean;
  /** How far a bill may drift from the ordered price before it needs review, 0-1. */
  varianceTolerancePct: number;
  enforce: boolean;
}

export const DEFAULT_PURCHASE_POLICY: PurchasePolicy = {
  approvalThreshold: 500,
  requirePreferredSupplier: false,
  varianceTolerancePct: 0.05,
  enforce: false,
};

export type PurchaseGuardrailCode =
  | 'ABOVE_APPROVAL_THRESHOLD'
  | 'NOT_PREFERRED_SUPPLIER'
  | 'NO_LINES'
  | 'ZERO_VALUE';

export interface PurchaseGuardrailViolation {
  code: PurchaseGuardrailCode;
  /** Written for the person who has to act on it, not for a log. */
  message: string;
  /** Present when the violation belongs to one line rather than the order. */
  lineId?: string;
  actual: number;
  limit: number;
  /**
   * Whether holding the escalated permission clears this one.
   *
   * A threshold is a question of authority, so someone senior enough can
   * proceed. A zero-value order is just wrong, and no permission fixes it.
   */
  overridable: boolean;
}

const money = (n: number): string => n.toFixed(2);

/**
 * Checks an order against its tenant's policy.
 *
 * Pure and shared so the order editor can warn as the user types and the API
 * can refuse on submit with exactly the same reasoning — the browser copy is
 * a convenience, the server copy is the rule.
 */
export function evaluatePurchaseGuardrails(
  lines: Pick<PurchaseOrderLineDto, 'id' | 'description' | 'qtyOrdered' | 'unitCost' | 'lineTotal'>[],
  totalAmount: number,
  policy: PurchasePolicy,
  context: { preferredSupplierByMaterial?: Record<string, string>; supplierId?: string } = {},
): PurchaseGuardrailViolation[] {
  const violations: PurchaseGuardrailViolation[] = [];

  // These two hold whether or not the policy is enforced: an order with
  // nothing on it cannot be sent to anybody.
  if (!lines || lines.length === 0) {
    violations.push({
      code: 'NO_LINES',
      message: 'This order has no lines.',
      actual: 0,
      limit: 1,
      overridable: false,
    });
    return violations;
  }

  if (!(totalAmount > 0)) {
    violations.push({
      code: 'ZERO_VALUE',
      message: 'This order totals zero. Add a quantity or a price before sending it.',
      actual: totalAmount,
      limit: 0,
      overridable: false,
    });
  }

  if (!policy.enforce) return violations;

  if (totalAmount > policy.approvalThreshold) {
    violations.push({
      code: 'ABOVE_APPROVAL_THRESHOLD',
      message: `Total is ${money(totalAmount)}, above the ${money(policy.approvalThreshold)} approval threshold`,
      actual: totalAmount,
      limit: policy.approvalThreshold,
      overridable: true,
    });
  }

  if (policy.requirePreferredSupplier && context.preferredSupplierByMaterial && context.supplierId) {
    for (const line of lines) {
      const materialId = (line as { materialId?: string | null }).materialId;
      if (!materialId) continue;
      const preferred = context.preferredSupplierByMaterial[materialId];
      if (preferred && preferred !== context.supplierId) {
        violations.push({
          code: 'NOT_PREFERRED_SUPPLIER',
          message: `"${line.description}" has a different preferred supplier`,
          lineId: line.id,
          actual: 0,
          limit: 0,
          overridable: true,
        });
      }
    }
  }

  return violations;
}

/** True when nothing blocks this order as it stands. */
export function isWithinPurchasePolicy(violations: PurchaseGuardrailViolation[]): boolean {
  return violations.length === 0;
}

/** What remains after an escalated approver's permission is taken into account. */
export function blockingViolations(
  violations: PurchaseGuardrailViolation[],
  canOverride: boolean,
): PurchaseGuardrailViolation[] {
  return canOverride ? violations.filter((v) => !v.overridable) : violations;
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

/**
 * Which statuses each status may move to.
 *
 * Held as data rather than scattered `if` statements so that the illegal
 * transitions are visible in one place — and so a purchase order can never be
 * created anywhere but `DRAFT`.
 */
export const PURCHASE_ORDER_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: ['AWAITING_APPROVAL', 'CANCELLED'],
  AWAITING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['SENT', 'CANCELLED'],
  SENT: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  // Cancelling after goods have arrived would strand stock that was received;
  // the way out is a return, which arrives with goods receipt in sprint 3.
  PARTIALLY_RECEIVED: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};

export function canTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return PURCHASE_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses that still count as live work against a supplier. */
export const OPEN_PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  'DRAFT',
  'AWAITING_APPROVAL',
  'APPROVED',
  'SENT',
  'PARTIALLY_RECEIVED',
];
