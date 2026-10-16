import { round2 } from './calc';

/** Nothing is payable under a year of service (Decree-Law 33/2021); adjustments always apply. */
export function settlementGratuity(a: { serviceDays: number; statutory: number; adjustments: number }): number {
  return round2((a.serviceDays < 365 ? 0 : a.statutory) + a.adjustments);
}

/** Untaken leave on basic ÷ 30; a negative balance (leave taken in advance) is a deduction. */
export function leaveEncashment(a: { days: number; basic: number }): number {
  return round2((a.days * a.basic) / 30);
}

/** Notice pay in lieu on gross ÷ 30: paid to the employee, or deducted when they did not serve it. */
export function noticePay(a: { days: number; gross: number; direction: 'PAY' | 'DEDUCT' }): number {
  const amount = round2((a.days * a.gross) / 30);
  return a.direction === 'PAY' ? amount : -amount;
}
