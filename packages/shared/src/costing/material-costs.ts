/**
 * Catalog costs against what the shop actually pays.
 *
 * Quotes are priced from `Material.costPerUom` (and a stock item's
 * `standardCost`), typed in once. Goods receipts, the stock's moving average
 * and supplier price lists move; the catalog does not. This compares them and
 * says, in one line, how far apart they are.
 *
 * Nothing here changes anything. A person picks a figure and it is applied
 * through the ordinary catalog update, computed again on the server.
 */

export type MaterialCostBasis = 'LAST_PURCHASE' | 'AVERAGE' | 'SUPPLIER';

export const MATERIAL_COST_BASIS_LABELS: Record<MaterialCostBasis, string> = {
  LAST_PURCHASE: 'last price paid',
  AVERAGE: 'average cost in stock',
  SUPPLIER: "supplier's price",
};

/** A catalog cost is only flagged once the gap is at least this (2%). */
export const MATERIAL_COST_GAP_THRESHOLD = 0.02;

export interface MaterialCostFigure {
  basis: MaterialCostBasis;
  /** Base currency per one unit of the material's own unit, 4dp. */
  unitCost: number;
  /** What it is against the catalog cost: 0.06 is 6% more. Null when the catalog cost is 0. */
  gapPct: number | null;
  /** One short line saying where the figure comes from. */
  detail: string;
}

export interface MaterialCostRow {
  /** `<type>:<id>`, stable across reads. */
  id: string;
  target: { type: 'MATERIAL' | 'CATALOG_ITEM'; id: string; name: string };
  field: 'costPerUom' | 'standardCost';
  /** The material's unit, lower case ("sheet", "kg"). */
  uom: string;
  current: number;
  figures: MaterialCostFigure[];
  /** The figure the one-click update uses: last price paid, else average, else supplier. */
  suggested: MaterialCostBasis;
  /** One short line for the shop owner. */
  reason: string;
}

export interface MaterialCostReview {
  /** Materials and stock items compared. */
  checked: number;
  /** Only the ones whose suggested figure is at least the threshold away. */
  rows: MaterialCostRow[];
  notes: string[];
}

export interface MaterialCostReviewInput {
  materials: { id: string; name: string; uom: string; costPerUom: number }[];
  /** Products sold from stock, priced at `standardCost` per unit of the linked material. */
  stockItems?: { id: string; name: string; standardCost: number; stockMaterialId: string }[];
  /** The latest goods receipt per material, already in base currency and in the material's unit. */
  lastReceipts: {
    materialId: string;
    unitCost: number;
    receivedAt: string;
    receiptNumber: string;
    supplierName: string | null;
  }[];
  /** Receipt lines left out because the order line's unit differed from the material's. */
  otherUnitReceipts?: { materialId: string; count: number }[];
  /** Stock positions per location. */
  positions: { materialId: string; qtyOnHand: number; avgUnitCost: number }[];
  /** One supplier price per material (preferred first), in base currency; null when it could not be converted. */
  supplierPrices: { materialId: string; supplierName: string; unitCost: number | null; currency: string }[];
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const pctText = (n: number) => `${Math.round(Math.abs(n) * 1000) / 10}%`;
const fmt = (n: number) => {
  const r = round4(n);
  return Math.round(r * 100) === r * 100 ? r.toFixed(2) : String(r);
};
const SUGGEST_ORDER: MaterialCostBasis[] = ['LAST_PURCHASE', 'AVERAGE', 'SUPPLIER'];

export function reviewMaterialCosts(input: MaterialCostReviewInput): MaterialCostReview {
  const notes: string[] = [];
  const byId = new Map(input.materials.map((m) => [m.id, m]));
  const receipts = new Map(input.lastReceipts.map((r) => [r.materialId, r]));
  const suppliers = new Map<string, MaterialCostReviewInput['supplierPrices'][number]>();
  for (const s of input.supplierPrices) if (!suppliers.has(s.materialId)) suppliers.set(s.materialId, s);

  const stock = new Map<string, { qty: number; value: number }>();
  for (const p of input.positions) {
    if (!(p.qtyOnHand > 0)) continue;
    const acc = stock.get(p.materialId) ?? { qty: 0, value: 0 };
    acc.qty += p.qtyOnHand;
    acc.value += p.qtyOnHand * p.avgUnitCost;
    stock.set(p.materialId, acc);
  }

  const figuresFor = (materialId: string, current: number, uom: string): MaterialCostFigure[] => {
    const gap = (cost: number) => (current > 0 ? round4((cost - current) / current) : null);
    const out: MaterialCostFigure[] = [];
    const r = receipts.get(materialId);
    if (r && r.unitCost > 0) {
      out.push({
        basis: 'LAST_PURCHASE',
        unitCost: round4(r.unitCost),
        gapPct: gap(r.unitCost),
        detail: `Paid ${fmt(r.unitCost)} per ${uom} on ${r.receivedAt.slice(0, 10)} (${r.receiptNumber}${r.supplierName ? `, ${r.supplierName}` : ''}).`,
      });
    }
    const s = stock.get(materialId);
    if (s && s.qty > 0 && s.value > 0) {
      const avg = round4(s.value / s.qty);
      out.push({
        basis: 'AVERAGE',
        unitCost: avg,
        gapPct: gap(avg),
        detail: `Stock on hand (${round4(s.qty)} ${uom}) cost ${fmt(avg)} per ${uom} on average.`,
      });
    }
    const sp = suppliers.get(materialId);
    if (sp && sp.unitCost != null && sp.unitCost > 0) {
      out.push({
        basis: 'SUPPLIER',
        unitCost: round4(sp.unitCost),
        gapPct: gap(sp.unitCost),
        detail: `${sp.supplierName} lists it at ${fmt(sp.unitCost)} per ${uom}.`,
      });
    }
    return out;
  };

  const rows: MaterialCostRow[] = [];
  let checked = 0;
  const consider = (
    target: MaterialCostRow['target'],
    field: MaterialCostRow['field'],
    materialId: string,
    current: number,
    uom: string,
  ) => {
    const figures = figuresFor(materialId, current, uom);
    if (!figures.length) return;
    checked += 1;
    const suggested = SUGGEST_ORDER.map((b) => figures.find((f) => f.basis === b)).find(Boolean)!;
    const moved =
      current <= 0 || Math.abs(suggested.unitCost - current) / current >= MATERIAL_COST_GAP_THRESHOLD;
    if (!moved || round4(suggested.unitCost) === round4(current)) return;
    const label = MATERIAL_COST_BASIS_LABELS[suggested.basis];
    rows.push({
      id: `${target.type}:${target.id}`,
      target,
      field,
      uom,
      current: round4(current),
      figures,
      suggested: suggested.basis,
      reason:
        current <= 0
          ? `Has no cost in the catalog; the ${label} is ${fmt(suggested.unitCost)} per ${uom}.`
          : `Quotes use ${fmt(current)} per ${uom}; the ${label} is ${fmt(suggested.unitCost)}, ${pctText(suggested.gapPct ?? 0)} ${suggested.unitCost > current ? 'more' : 'less'}.`,
    });
  };

  for (const m of input.materials) {
    consider({ type: 'MATERIAL', id: m.id, name: m.name }, 'costPerUom', m.id, m.costPerUom, m.uom.toLowerCase());
  }
  for (const item of input.stockItems ?? []) {
    const m = byId.get(item.stockMaterialId);
    if (!m) continue;
    consider(
      { type: 'CATALOG_ITEM', id: item.id, name: item.name },
      'standardCost',
      m.id,
      item.standardCost,
      m.uom.toLowerCase(),
    );
  }

  const skipped = (input.otherUnitReceipts ?? []).reduce((n, r) => n + r.count, 0);
  if (skipped > 0) {
    notes.push(
      `${skipped} receipt line${skipped === 1 ? ' was' : 's were'} ordered in a different unit from the material and left out of "last price paid".`,
    );
  }
  if (input.supplierPrices.some((s) => s.unitCost == null)) {
    notes.push('Supplier prices in a currency with no exchange rate are left out. Add the rate under Finance → Currencies.');
  }

  // Largest gaps first: those are the quotes most wrong.
  rows.sort((a, b) => gapOf(b) - gapOf(a));
  return { checked, rows, notes };
}

const gapOf = (row: MaterialCostRow) =>
  Math.abs(row.figures.find((f) => f.basis === row.suggested)?.gapPct ?? 1);

/* ---------------- Open quotes priced on old costs ---------------- */

/** A quote line's cost may drift this much (0.5%) before the quote is flagged. */
export const QUOTE_COST_DRIFT_THRESHOLD = 0.005;

export interface QuoteCostLine {
  lineId: string;
  description: string;
  quantity: number;
  /** Cost stored when the quote was last saved. Null when it had none. */
  savedCost: number | null;
  /** The same line costed at today's catalog. Null when it no longer costs. */
  currentCost: number | null;
  unitPrice: number;
  /** For template lines: the unit price the template gives at today's costs. */
  repricedUnitPrice: number | null;
}

export interface QuoteCostCheck {
  quoteId: string;
  quoteNumber: string | null;
  customerName: string | null;
  status: string;
  currency: string;
  /** True when at least one line's cost has moved past the threshold. */
  moved: boolean;
  savedCost: number;
  currentCost: number;
  subtotal: number;
  savedMarginPct: number | null;
  currentMarginPct: number | null;
  /** Subtotal if template lines were re-priced at today's costs. */
  repricedSubtotal: number;
  repricedMarginPct: number | null;
  /** False for an approved quote: its price has gone to the customer. */
  canReprice: boolean;
  lines: QuoteCostLine[];
}

export type QuoteRecostMode = 'COSTS' | 'COSTS_AND_PRICES';

/** True when a line's cost has moved enough to matter. */
export function costMoved(saved: number | null, current: number | null): boolean {
  if (saved == null && current == null) return false;
  if (saved == null || current == null) return true;
  const diff = Math.abs(current - saved);
  if (diff < 0.01) return false;
  return saved === 0 || diff / Math.abs(saved) >= QUOTE_COST_DRIFT_THRESHOLD;
}
