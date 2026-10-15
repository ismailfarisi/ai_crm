import { daysBetweenInclusive, round2 } from './calc';

/**
 * End-of-service gratuity earned to `asOf` (UAE Labour Law): 21 days of basic
 * per year for the first five years, 30 days per year after, part-years pro
 * rata, on the latest basic ÷ 30, capped at two years' basic. Unpaid leave
 * does not count as service. UAE/GCC nationals are on pension instead: 0.
 */
export function gratuityEntitlement(args: {
  joiningDate: string;
  asOf: string;
  basic: number;
  unpaidLeaveDays: number;
  isNational: boolean;
}): { serviceDays: number; gratuityDays: number; amount: number } {
  if (args.isNational) return { serviceDays: 0, gratuityDays: 0, amount: 0 };
  const serviceDays = Math.max(0, daysBetweenInclusive(args.joiningDate, args.asOf) - args.unpaidLeaveDays);
  const years = serviceDays / 365;
  const gratuityDays = 21 * Math.min(years, 5) + 30 * Math.max(years - 5, 0);
  const amount = Math.min(round2((gratuityDays * args.basic) / 30), round2(24 * args.basic));
  return { serviceDays, gratuityDays: Math.round(gratuityDays * 10000) / 10000, amount };
}
