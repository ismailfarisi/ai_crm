/** Pay arithmetic. Dates are ISO calendar dates (UTC); amounts in base currency. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function utc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Inclusive day count between two ISO dates (0 when end < start). */
export function daysBetweenInclusive(start: string, end: string): number {
  const diff = Math.round((utc(end) - utc(start)) / 86_400_000) + 1;
  return Math.max(0, diff);
}

export function periodBounds(period: string): { first: string; last: string; daysInMonth: number } {
  const [y, m] = period.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { first: `${y}-${mm}-01`, last: `${y}-${mm}-${String(daysInMonth).padStart(2, '0')}`, daysInMonth };
}

export function daysEmployed(args: { period: string; joiningDate: string; leavingDate: string | null }): number {
  const { first, last } = periodBounds(args.period);
  const start = args.joiningDate > first ? args.joiningDate : first;
  const end = args.leavingDate && args.leavingDate < last ? args.leavingDate : last;
  return daysBetweenInclusive(start, end);
}

export interface PackageAmounts {
  basic: number;
  housing: number;
  transport: number;
  otherAllowances: { label: string; amount: number }[];
}

export function packageGross(p: PackageAmounts): number {
  return round2(p.basic + p.housing + p.transport + p.otherAllowances.reduce((s, a) => s + a.amount, 0));
}

export interface LineInput {
  gross: number;
  basic: number;
  daysEmployed: number;
  daysInMonth: number;
  overtimeHours: number;
  overtimeHoursPremium: number;
  bonusAmount: number;
  unpaidLeaveDays: number;
  advanceRecovery: number;
  otherDeductionAmount: number;
}

export interface LineAmounts {
  proratedGross: number;
  overtimeAmount: number;
  unpaidLeaveAmount: number;
  /** What the employee receives. */
  netPay: number;
  /** What the business expenses as salary: before recoveries and deductions. */
  salaryCost: number;
}

/** Overtime and unpaid leave use the UAE ÷ 30 daily rate; overtime is on basic, 8-hour days. */
export function computeLine(i: LineInput): LineAmounts {
  const proratedGross = round2((i.gross * i.daysEmployed) / i.daysInMonth);
  const hourly = i.basic / 30 / 8;
  const overtimeAmount = round2(hourly * (1.25 * i.overtimeHours + 1.5 * i.overtimeHoursPremium));
  const unpaidLeaveAmount = round2((i.gross / 30) * i.unpaidLeaveDays);
  const salaryCost = round2(proratedGross + overtimeAmount + i.bonusAmount - unpaidLeaveAmount);
  const netPay = round2(salaryCost - i.advanceRecovery - i.otherDeductionAmount);
  return { proratedGross, overtimeAmount, unpaidLeaveAmount, netPay, salaryCost };
}
