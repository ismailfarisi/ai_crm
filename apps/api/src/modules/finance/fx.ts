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

/**
 * What a transfer between two accounts is worth in base currency, each side.
 *
 * - Same currency: one amount, converted at today's rate (1 in base).
 * - One side in base: the bank's own conversion sets the value — the base
 *   amount that left or arrived — so both sides carry it and nothing is
 *   gained or lost on the day.
 * - Two foreign currencies: each side at today's rate for its currency, and
 *   the gap between them is an exchange difference.
 *
 * `toAmount` is required whenever the currencies differ: only the bank knows
 * what arrived.
 */
export async function transferValues(
  manager: EntityManager,
  tenantId: string,
  input: {
    from: Pick<FinanceAccount, 'name' | 'currency'>;
    to: Pick<FinanceAccount, 'name' | 'currency'>;
    amount: number;
    toAmount?: number | null;
  },
  date: Date = new Date(),
): Promise<{
  arriving: number;
  fromBase: number;
  toBase: number;
  currency: string | null;
  rate: number;
}> {
  const base = await baseCurrencyFor(manager, tenantId);
  const code = (c: string | null | undefined) =>
    (c ?? '').trim().toUpperCase() || base;
  const fromCurrency = code(input.from.currency);
  const toCurrency = code(input.to.currency);
  const amount = input.amount;

  if (fromCurrency === toCurrency) {
    const rate = await fxRateFor(manager, tenantId, fromCurrency, date);
    const value = toBase(amount, rate);
    return {
      arriving: amount,
      fromBase: value,
      toBase: value,
      currency: fromCurrency,
      rate,
    };
  }

  const arriving = Number(input.toAmount);
  if (!(arriving > 0)) {
    throw new BadRequestException(
      `${input.from.name} holds ${fromCurrency} and ${input.to.name} holds ${toCurrency}. Enter how much ${toCurrency} arrived.`,
    );
  }
  if (fromCurrency === base)
    return { arriving, fromBase: amount, toBase: amount, currency: null, rate: 1 };
  if (toCurrency === base)
    return { arriving, fromBase: arriving, toBase: arriving, currency: null, rate: 1 };

  const [fromRate, toRate] = await Promise.all([
    fxRateFor(manager, tenantId, fromCurrency, date),
    fxRateFor(manager, tenantId, toCurrency, date),
  ]);
  return {
    arriving,
    fromBase: toBase(amount, fromRate),
    toBase: toBase(arriving, toRate),
    currency: null,
    rate: 1,
  };
}
