import { describe, it, expect } from 'vitest';
import {
  blockingViolations,
  canTransition,
  DEFAULT_PURCHASE_POLICY,
  evaluatePurchaseGuardrails,
  isWithinPurchasePolicy,
  OPEN_PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_TRANSITIONS,
  type PurchasePolicy,
} from './guardrails';
import { PURCHASE_ORDER_STATUSES } from './types';

const line = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'line-1',
    description: '350gsm board SRA2',
    qtyOrdered: 500,
    unitCost: 0.42,
    lineTotal: 210,
    ...over,
  }) as never;

const enforced: PurchasePolicy = { ...DEFAULT_PURCHASE_POLICY, enforce: true };

describe('evaluatePurchaseGuardrails', () => {
  it('reports nothing for a healthy order under the threshold', () => {
    const violations = evaluatePurchaseGuardrails([line()], 210, enforced);
    expect(isWithinPurchasePolicy(violations)).toBe(true);
  });

  it('flags an order above the approval threshold', () => {
    const violations = evaluatePurchaseGuardrails([line()], 750, enforced);

    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('ABOVE_APPROVAL_THRESHOLD');
    expect(violations[0].actual).toBe(750);
    expect(violations[0].limit).toBe(500);
    expect(violations[0].message).toContain('750.00');
  });

  it('treats the threshold as exclusive, so an order exactly at it passes', () => {
    const violations = evaluatePurchaseGuardrails([line()], 500, enforced);
    expect(violations).toEqual([]);
  });

  it('stays silent while the policy is unenforced', () => {
    // Turning purchasing on must not retroactively block orders that were
    // fine yesterday - the same stance DEFAULT_COSTING_POLICY takes.
    const violations = evaluatePurchaseGuardrails([line()], 9999, DEFAULT_PURCHASE_POLICY);
    expect(violations).toEqual([]);
  });

  it('refuses an empty order whether or not the policy is enforced', () => {
    for (const policy of [enforced, DEFAULT_PURCHASE_POLICY]) {
      const violations = evaluatePurchaseGuardrails([], 0, policy);
      expect(violations.map((v) => v.code)).toEqual(['NO_LINES']);
      expect(violations[0].overridable).toBe(false);
    }
  });

  it('refuses a zero-value order, and no permission clears it', () => {
    const violations = evaluatePurchaseGuardrails([line({ lineTotal: 0 })], 0, enforced);

    expect(violations.map((v) => v.code)).toContain('ZERO_VALUE');
    expect(blockingViolations(violations, true).map((v) => v.code)).toContain('ZERO_VALUE');
  });

  it('flags a line whose material has a different preferred supplier', () => {
    const violations = evaluatePurchaseGuardrails(
      [line({ materialId: 'mat-1' })],
      210,
      { ...enforced, requirePreferredSupplier: true },
      { supplierId: 'sup-2', preferredSupplierByMaterial: { 'mat-1': 'sup-1' } },
    );

    expect(violations.map((v) => v.code)).toEqual(['NOT_PREFERRED_SUPPLIER']);
    expect(violations[0].lineId).toBe('line-1');
  });

  it('accepts the preferred supplier', () => {
    const violations = evaluatePurchaseGuardrails(
      [line({ materialId: 'mat-1' })],
      210,
      { ...enforced, requirePreferredSupplier: true },
      { supplierId: 'sup-1', preferredSupplierByMaterial: { 'mat-1': 'sup-1' } },
    );
    expect(violations).toEqual([]);
  });
});

describe('blockingViolations', () => {
  it('clears an overridable violation for someone who may override it', () => {
    const violations = evaluatePurchaseGuardrails([line()], 750, enforced);

    expect(blockingViolations(violations, false)).toHaveLength(1);
    expect(blockingViolations(violations, true)).toHaveLength(0);
  });
});

describe('PURCHASE_ORDER_TRANSITIONS', () => {
  it('covers every status', () => {
    expect(Object.keys(PURCHASE_ORDER_TRANSITIONS).sort()).toEqual(
      [...PURCHASE_ORDER_STATUSES].sort(),
    );
  });

  it('never allows a move back into DRAFT except from AWAITING_APPROVAL', () => {
    for (const [from, targets] of Object.entries(PURCHASE_ORDER_TRANSITIONS)) {
      if (from === 'AWAITING_APPROVAL') continue;
      expect(targets).not.toContain('DRAFT');
    }
  });

  it('allows the happy path end to end', () => {
    expect(canTransition('DRAFT', 'AWAITING_APPROVAL')).toBe(true);
    expect(canTransition('AWAITING_APPROVAL', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'SENT')).toBe(true);
    expect(canTransition('SENT', 'PARTIALLY_RECEIVED')).toBe(true);
    expect(canTransition('PARTIALLY_RECEIVED', 'RECEIVED')).toBe(true);
  });

  it('will not let an order skip approval', () => {
    expect(canTransition('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransition('DRAFT', 'SENT')).toBe(false);
  });

  it('will not cancel an order once goods have arrived', () => {
    // Cancelling would strand stock that was already received; the way out is
    // a return, which arrives with goods receipt.
    expect(canTransition('PARTIALLY_RECEIVED', 'CANCELLED')).toBe(false);
    expect(canTransition('RECEIVED', 'CANCELLED')).toBe(false);
  });

  it('makes terminal states terminal', () => {
    expect(PURCHASE_ORDER_TRANSITIONS.RECEIVED).toEqual([]);
    expect(PURCHASE_ORDER_TRANSITIONS.CANCELLED).toEqual([]);
  });
});

describe('OPEN_PURCHASE_ORDER_STATUSES', () => {
  it('counts everything that is not finished or abandoned', () => {
    expect(OPEN_PURCHASE_ORDER_STATUSES).not.toContain('RECEIVED');
    expect(OPEN_PURCHASE_ORDER_STATUSES).not.toContain('CANCELLED');
    expect(OPEN_PURCHASE_ORDER_STATUSES).toHaveLength(PURCHASE_ORDER_STATUSES.length - 2);
  });
});
