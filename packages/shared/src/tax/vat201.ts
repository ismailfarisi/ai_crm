/**
 * The UAE VAT return (FTA form VAT201), built from posted documents.
 *
 * Pure: the API gathers the documents for a period, converts them to AED at
 * the rate each was posted at, and hands them here. Keeping the box logic out
 * of the database code is what lets it be tested box by box.
 */

import { EMIRATES, EMIRATE_NAMES, type Emirate, type VatTreatment } from './uae';

export interface Vat201SaleInput {
  treatment: VatTreatment | null;
  rate: number;
  /** AED, net of VAT. Negative for a credit note. */
  net: number;
  /** AED. Negative for a credit note. */
  tax: number;
  creditNote: boolean;
}

export interface Vat201PurchaseInput {
  treatment: VatTreatment | null;
  rate: number;
  net: number;
  /** VAT the supplier charged (zero on a reverse-charge bill). */
  tax: number;
  /** VAT the buyer self-assessed on a reverse-charge or import bill. */
  selfAssessed: number;
}

export interface Vat201Row {
  box: string;
  label: string;
  amount: number;
  vat: number;
  adjustment: number;
}

export interface Vat201Dto {
  from: string;
  to: string;
  /** The emirate standard-rated sales were reported in. */
  emirate: Emirate | null;
  rows: Vat201Row[];
  /** Box 12. */
  totalDueTax: number;
  /** Box 13. */
  totalRecoverableTax: number;
  /** Box 14; negative is a refund due. */
  payableTax: number;
  /** Things a preparer must look at before filing. */
  warnings: string[];
}

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);

class Box {
  amountC = 0;
  vatC = 0;
  adjustmentC = 0;
  constructor(
    readonly box: string,
    readonly label: string,
  ) {}
  row(): Vat201Row {
    return {
      box: this.box,
      label: this.label,
      amount: this.amountC / 100,
      vat: this.vatC / 100,
      adjustment: this.adjustmentC / 100,
    };
  }
}

/**
 * Sales are classified by treatment, falling back on the rate for documents
 * from before codes carried one: a taxed line is standard rated, an untaxed
 * one cannot be placed and is reported as a warning rather than guessed into
 * zero-rated or exempt.
 *
 * Standard-rated sales all land in the head-office emirate. Documents do not
 * yet record the branch that made the supply, so a multi-branch business
 * must split box 1 by hand (see docs/FLAGS.md).
 *
 * Credit notes reduce the value in the box their sale was reported in; their
 * VAT goes in box 1's adjustment column, as the FTA form expects.
 */
export function buildVat201(input: {
  from: string;
  to: string;
  emirate: Emirate | null;
  sales: Vat201SaleInput[];
  purchases: Vat201PurchaseInput[];
}): Vat201Dto {
  const warnings: string[] = [];
  const box1 = new Map<Emirate, Box>(
    EMIRATES.map((e, i) => [e, new Box(`1${'abcdefg'[i]}`, `Standard rated supplies in ${EMIRATE_NAMES[e]}`)]),
  );
  const box2 = new Box('2', 'Tax refunds provided to tourists');
  const box3 = new Box('3', 'Supplies subject to the reverse charge provisions');
  const box4 = new Box('4', 'Zero rated supplies');
  const box5 = new Box('5', 'Exempt supplies');
  const box6 = new Box('6', 'Goods imported into the UAE');
  const box7 = new Box('7', 'Adjustments to goods imported into the UAE');
  const box9 = new Box('9', 'Standard rated expenses');
  const box10 = new Box('10', 'Supplies subject to the reverse charge provisions');

  const standardBox = input.emirate ? box1.get(input.emirate)! : null;
  let unplacedStandard = 0;
  let unclassified = 0;
  let salesReverseCharge = 0;

  for (const sale of input.sales) {
    const treatment = sale.treatment ?? (sale.rate > 0 ? 'STANDARD' : null);
    switch (treatment) {
      case 'STANDARD':
      case 'REVERSE_CHARGE': {
        if (treatment === 'REVERSE_CHARGE') salesReverseCharge++;
        if (!standardBox) {
          unplacedStandard++;
          break;
        }
        standardBox.amountC += cents(sale.net);
        if (sale.creditNote) standardBox.adjustmentC += cents(sale.tax);
        else standardBox.vatC += cents(sale.tax);
        break;
      }
      case 'ZERO_RATED':
        box4.amountC += cents(sale.net);
        break;
      case 'EXEMPT':
        box5.amountC += cents(sale.net);
        break;
      case 'OUT_OF_SCOPE':
        break;
      default:
        unclassified++;
    }
  }

  for (const bill of input.purchases) {
    const treatment = bill.treatment ?? (bill.rate > 0 ? 'STANDARD' : null);
    switch (treatment) {
      case 'STANDARD':
        box9.amountC += cents(bill.net);
        box9.vatC += cents(bill.tax);
        break;
      case 'REVERSE_CHARGE':
        // Due as output tax (box 3) and recovered as input tax (box 10).
        box3.amountC += cents(bill.net);
        box3.vatC += cents(bill.selfAssessed);
        box10.amountC += cents(bill.net);
        box10.vatC += cents(bill.selfAssessed);
        break;
      case 'IMPORT_GOODS':
        box6.amountC += cents(bill.net);
        box6.vatC += cents(bill.selfAssessed);
        box10.amountC += cents(bill.net);
        box10.vatC += cents(bill.selfAssessed);
        break;
      // Blocked input tax is not recoverable and stays off box 9; zero-rated,
      // exempt and out-of-scope purchases carry no tax to recover.
      default:
        break;
    }
  }

  if (unplacedStandard > 0) {
    warnings.push(
      `${unplacedStandard} standard-rated document(s) could not be placed in an emirate. Set the head office emirate under Settings → Branches.`,
    );
  }
  if (unclassified > 0) {
    warnings.push(
      `${unclassified} untaxed sale line(s) have no VAT treatment, so they are left out: decide whether each was zero rated, exempt or out of scope.`,
    );
  }
  if (salesReverseCharge > 0) {
    warnings.push(
      `${salesReverseCharge} sale line(s) were under the domestic reverse charge. Their value is in box 1 with no VAT; check them before filing.`,
    );
  }

  const outputBoxes = [...box1.values(), box2, box3, box4, box5, box6, box7];
  const box8 = new Box('8', 'Totals');
  for (const b of outputBoxes) {
    box8.amountC += b.amountC;
    box8.vatC += b.vatC;
    box8.adjustmentC += b.adjustmentC;
  }
  const box11 = new Box('11', 'Totals');
  for (const b of [box9, box10]) {
    box11.amountC += b.amountC;
    box11.vatC += b.vatC;
    box11.adjustmentC += b.adjustmentC;
  }

  const dueC = box8.vatC + box8.adjustmentC;
  const recoverableC = box11.vatC + box11.adjustmentC;

  return {
    from: input.from,
    to: input.to,
    emirate: input.emirate,
    rows: [...outputBoxes, box8, box9, box10, box11].map((b) => b.row()),
    totalDueTax: dueC / 100,
    totalRecoverableTax: recoverableC / 100,
    payableTax: (dueC - recoverableC) / 100,
    warnings,
  };
}

/** The VAT a buyer self-assesses on a reverse-charge or import bill: the code's rate on the net. */
export function reverseChargeTax(net: number, rate: number): number {
  return Math.round(cents(net) * Math.max(0, Number(rate) || 0) / 100) / 100;
}
