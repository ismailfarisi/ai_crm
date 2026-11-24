'use client';

import React from 'react';
import {
  describeExpenseClaimTax,
  expenseClaimTax,
  type ExpenseClaimDto,
  type ExpenseClaimTax,
  type ExpenseTaxOptionsDto,
} from '@saas/shared';
import { useExpenseTaxOptions } from '@/hooks/use-expenses';
import { formatExpenseCurrency } from './expense-money';

export interface ClaimVatSummaryProps {
  claim: ExpenseClaimDto;
  /** Left out, the VAT types are loaded from the API. */
  taxOptions?: ExpenseTaxOptionsDto;
}

/**
 * How the claim's amount splits into cost and VAT. Once the claim is in the
 * books this is what was posted, not what its VAT type would say today.
 */
export function claimVatSplit(
  claim: ExpenseClaimDto,
  taxOptions: ExpenseTaxOptionsDto | undefined,
): ExpenseClaimTax | null {
  if (!claim.taxCodeId) return null;
  const gross = Number(claim.amount) || 0;
  if (claim.taxPostedAt) {
    const tax = Number(claim.taxAmount) || 0;
    const recoverable = Number(claim.recoverableTax) || 0;
    const selfAssessed = Number(claim.reverseChargeTax) || 0;
    return {
      gross,
      tax,
      recoverable,
      selfAssessed,
      cost: gross - recoverable,
      net: gross - tax,
      blocked: tax > 0 && recoverable === 0 && selfAssessed === 0,
    };
  }
  const code = taxOptions?.codes.find((c) => c.id === claim.taxCodeId);
  return code ? expenseClaimTax(gross, claim.taxAmount, code) : null;
}

/** The VAT on a claim, in words a workshop owner reads without a glossary. */
export function ClaimVatSummary({ claim, taxOptions: given }: ClaimVatSummaryProps) {
  const loaded = useExpenseTaxOptions(!given).data;
  const taxOptions = given ?? loaded;

  if (!claim.taxCodeId) {
    // An organisation with no tax codes is told nothing about VAT at all.
    if (!taxOptions?.codes.length) return null;
    return (
      <div data-testid="claim-vat" className="border-t border-border pt-3">
        <span className="text-[11px] font-semibold text-ink-subtle uppercase">VAT</span>
        <p className="mt-1 text-sm text-ink-muted">None recorded. No VAT is claimed back on this expense.</p>
      </div>
    );
  }

  const code = taxOptions?.codes.find((c) => c.id === claim.taxCodeId);
  const split = claimVatSplit(claim, taxOptions);
  const money = (n: number) => formatExpenseCurrency(n, claim.currency);
  const neverPosted = claim.status === 'REJECTED' && !claim.taxPostedAt;

  let outcome: string | null = null;
  if (claim.taxReversedAt) {
    outcome =
      'This claim was rejected after it was approved, so its cost and its VAT were taken back out of the books and the tax return.';
  } else if (neverPosted) {
    outcome = 'The claim was rejected, so no VAT was claimed back.';
  } else if (split) {
    outcome =
      describeExpenseClaimTax(split, money) +
      (claim.taxPostedAt ? '' : ' This happens when the claim is approved.');
  }

  return (
    <div data-testid="claim-vat" className="space-y-3 border-t border-border pt-3">
      <span className="text-[11px] font-semibold text-ink-subtle uppercase">VAT</span>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <span className="text-[11px] text-ink-subtle">VAT type</span>
          <div data-testid="claim-vat-type" className="mt-0.5 font-medium text-ink">
            {code?.name ?? 'Recorded'}
          </div>
        </div>
        <div>
          <span className="text-[11px] text-ink-subtle">VAT on the receipt</span>
          <div data-testid="claim-vat-amount" className="mt-0.5 font-medium tabular-nums text-ink">
            {money(split?.tax ?? (Number(claim.taxAmount) || 0))}
          </div>
        </div>
        <div>
          <span className="text-[11px] text-ink-subtle">Supplier&apos;s tax number (TRN)</span>
          <div data-testid="claim-vat-trn" className="mt-0.5 font-medium tabular-nums text-ink">
            {claim.supplierTaxId || 'Not given'}
          </div>
        </div>
      </div>
      {outcome && (
        <p data-testid="claim-vat-outcome" className="text-sm text-ink">
          {outcome}
        </p>
      )}
    </div>
  );
}
