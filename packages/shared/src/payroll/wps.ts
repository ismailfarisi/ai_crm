import { round2 } from './calc';

/**
 * The MOHRE Salary Information File: one EDR row per employee, one SCR
 * trailer. Agents (banks, exchange houses) accept this standard layout;
 * some add their own variations, which Kerf does not produce.
 */
export type WpsEmployerIdType = 'MOHRE' | 'FREE_ZONE';

export interface SifEmployer {
  employerId: string;
  employerIdType: WpsEmployerIdType;
  payerRoutingCode: string;
}

export interface SifRow {
  personId: string;
  routingCode: string;
  iban: string;
  payStart: string;
  payEnd: string;
  days: number;
  fixed: number;
  variable: number;
  leaveDays: number;
}

/** fixed + variable = net pay; overtime and bonus are the variable part. */
export function sifIncomeSplit(netPay: number, variable: number): { fixed: number; variable: number } {
  if (variable > netPay) return { fixed: 0, variable: round2(netPay) };
  return { fixed: round2(netPay - variable), variable: round2(variable) };
}

const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;
const two = (n: number) => String(n).padStart(2, '0');

export function buildSif(a: {
  employer: SifEmployer;
  rows: SifRow[];
  salaryMonth: string;
  createdAt: Date;
  reference: string;
}): { fileName: string; content: string } {
  const local = new Date(a.createdAt.getTime() + UAE_OFFSET_MS);
  const y = local.getUTCFullYear();
  const mo = two(local.getUTCMonth() + 1);
  const d = two(local.getUTCDate());
  const hh = two(local.getUTCHours());
  const mi = two(local.getUTCMinutes());
  const ss = two(local.getUTCSeconds());
  const employerId = a.employer.employerIdType === 'MOHRE' ? a.employer.employerId.padStart(13, '0') : a.employer.employerId;
  const [sy, sm] = a.salaryMonth.split('-');

  const lines = a.rows.map((r) =>
    ['EDR', r.personId, r.routingCode, r.iban, r.payStart, r.payEnd, String(r.days), r.fixed.toFixed(2), r.variable.toFixed(2), String(Math.round(r.leaveDays))].join(','),
  );
  const total = round2(a.rows.reduce((s, r) => s + r.fixed + r.variable, 0));
  lines.push(['SCR', employerId, a.employer.payerRoutingCode, `${y}-${mo}-${d}`, `${hh}${mi}`, `${sm}${sy}`, String(a.rows.length), total.toFixed(2), 'AED', a.reference].join(','));

  return {
    fileName: `${employerId}${String(y).slice(2)}${mo}${d}${hh}${mi}${ss}.SIF`,
    content: lines.map((l) => `${l}\r\n`).join(''),
  };
}
