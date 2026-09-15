import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { roundRate, toBase } from '@saas/shared';
import { Organization } from '../organizations/entities/organization.entity';
import { FxRate } from './entities/fx-rate.entity';
import type { FinanceAccount } from './entities/finance-account.entity';

/**
 * Exchange-rate lookups, as plain functions over an `EntityManager`.
 *
 * Plain rather than a service for the same reason as `order-provisioning`:
 * the Temporal activity that raises invoices has no DI container, and every
 * posting path — invoices, payments, bills, receipts, credits — needs the
 * same answer inside its own transaction.
 */

export async function baseCurrencyFor(
  manager: EntityManager,
  tenantId: string,
): Promise<string> {
  const org = await manager.getRepository(Organization).findOne({
    where: { id: tenantId },
    select: { id: true, baseCurrency: true },
  });
  return (org?.baseCurrency ?? 'USD').trim().toUpperCase();
}

/**
 * Base currency per unit of `currency` on `date`: the latest rate on or before
 * that day.
 *
 * Refuses rather than guessing when there is none. Posting a euro invoice at
 * a rate of 1 would silently book it as pounds, and nothing downstream would
 * ever notice — the trial balance would still balance.
 */
export async function fxRateFor(
  manager: EntityManager,
  tenantId: string,
  currency: string | null | undefined,
  date: Date = new Date(),
): Promise<number> {
  const code = (currency ?? '').trim().toUpperCase();
  if (!code) return 1;
  const base = await baseCurrencyFor(manager, tenantId);
  if (code === base) return 1;

  const day = date.toISOString().slice(0, 10);
  const row = await manager
    .getRepository(FxRate)
    .createQueryBuilder('r')
    .where('r.tenant_id = :tenantId', { tenantId })
    .andWhere('r.currency = :code', { code })
    .andWhere('r.rate_date <= :day', { day })
    .orderBy('r.rate_date', 'DESC')
    .getOne();
  if (!row) {
    throw new BadRequestException(
      `There is no ${code} → ${base} exchange rate on or before ${day}. Add one under Finance → Currencies before posting ${code} documents.`,
    );
  }
  return roundRate(Number(row.rate));
}

/**
 * How much a bank account's own balance moves for a payment of `amount` in a
 * document currency.
 *
 * An account in the document's currency moves by the amount itself; one in
 * base currency moves by the amount converted at the payment's rate. Any
 * other combination is refused: paying a euro invoice from a dollar account
 * involves a second conversion the bank did, at a rate nobody has told us.
 */
export async function cashAccountAmount(
  manager: EntityManager,
  tenantId: string,
  account: Pick<FinanceAccount, 'name' | 'currency'>,
  payment: { amount: number; currency: string; rate: number },
): Promise<number> {
  const accountCurrency = (account.currency ?? '').trim().toUpperCase();
  const documentCurrency = (payment.currency ?? '').trim().toUpperCase();
  if (!accountCurrency || accountCurrency === documentCurrency)
    return payment.amount;
  const base = await baseCurrencyFor(manager, tenantId);
  if (accountCurrency === base) return toBase(payment.amount, payment.rate);
  throw new BadRequestException(
    `${account.name} holds ${accountCurrency}, but this is a ${documentCurrency} payment. Use an account in ${documentCurrency} or in ${base}.`,
  );
}
