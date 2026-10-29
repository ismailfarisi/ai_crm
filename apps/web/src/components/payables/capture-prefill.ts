import {
  matchInvoiceLines,
  type BillCaptureResult,
  type BillCaptureWarning,
  type BillableOrderLineDto,
  type CapturedField,
} from '@saas/shared';
import { emptyExtraLine, type ExtraLineDraft } from './bill-extra-lines';

/** What the enter-bill form opens on when it starts from a read invoice. */
export interface BillPrefill {
  invoiceNumber: string;
  billDate: string;
  tax: string;
  /** Per order line. A line the invoice does not mention opens at zero, not at what arrived. */
  edits: Record<string, { qty?: string; unitCost?: string }>;
  /** Invoice lines that are not on the order. */
  extras: ExtraLineDraft[];
  /** Order lines an invoice line was paired with. */
  paired: string[];
  uncertain: CapturedField[];
  warnings: BillCaptureWarning[];
  /** The invoice itself, attached to the bill once it is saved. */
  file: File | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Fills the form from a capture result for the order the person settled on.
 *
 * When that is the order capture chose, its pairing is used as it came back.
 * When the person picked another, the lines are paired again against that
 * order with the same function the API uses.
 */
export function prefillFromCapture(
  result: BillCaptureResult,
  orderId: string,
  billable: BillableOrderLineDto[],
  file: File | null,
): BillPrefill {
  const sameOrder = result.purchaseOrder?.id === orderId;
  const lines = sameOrder ? result.lines : matchInvoiceLines(result.invoice.lines, billable);

  const byOrderLine = new Map(
    lines.flatMap((m) => (m.purchaseOrderLineId ? [[m.purchaseOrderLineId, result.invoice.lines[m.index]] as const] : [])),
  );
  const edits: BillPrefill['edits'] = {};
  for (const line of billable) {
    const inv = byOrderLine.get(line.purchaseOrderLineId);
    edits[line.purchaseOrderLineId] = inv ? { qty: String(inv.qty), unitCost: String(inv.unitCost) } : { qty: '0' };
  }

  const extras = lines
    .filter((m) => !m.purchaseOrderLineId)
    .map((m) => {
      const inv = result.invoice.lines[m.index];
      return { ...emptyExtraLine(), description: inv.description, qty: String(inv.qty), unitCost: String(inv.unitCost) };
    });

  // Pairing warnings belong to the order they were made against.
  const warnings = sameOrder
    ? result.warnings
    : result.warnings.filter((w) => w.code !== 'LINE_NOT_ON_ORDER');

  return {
    invoiceNumber: result.invoice.supplierInvoiceNumber ?? '',
    billDate: result.invoice.billDate ?? today(),
    tax: result.invoice.taxAmount != null ? String(result.invoice.taxAmount) : '',
    edits,
    extras,
    paired: [...byOrderLine.keys()],
    uncertain: result.invoice.uncertainFields,
    warnings,
    file,
  };
}
