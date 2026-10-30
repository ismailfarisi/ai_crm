import type { CostingPolicy, QuoteLineItem, QuoteTotals } from '@saas/shared';

export type MarginTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface MarginStatus {
  tone: MarginTone;
  /** Always a word, so the state never rests on colour alone. */
  label: string;
  /** The floor as a fraction, or null when the organisation has not set one. */
  floor: number | null;
  /**
   * False when the percentage would mislead: nothing is priced yet, or a line
   * is being re-costed and the figure is about to change.
   */
  showFigure: boolean;
}

/** Points above the floor that still count as cutting it close. */
const NEAR_FLOOR = 0.03;

const pct = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;

/**
 * What the margin means, judged against the margin itself and the floor.
 *
 * The badge used to go red only when a floor rule fired, so with no policy
 * configured a quote losing money read as a green, healthy margin. A loss is
 * a loss whether or not anyone has set a floor.
 *
 * A line typed by hand has a price but no cost, so it counts as pure profit
 * and the figure runs high. That is said in the badge itself, not only on the
 * card further down, because the badge is what people look at.
 */
export function marginStatus(
  totals: Pick<QuoteTotals, 'subtotalAmount' | 'marginPct'>,
  policy: CostingPolicy | undefined | null,
  linesWithoutCost = 0,
  linesRecosting = 0,
): MarginStatus {
  const floor = policy?.enforce ? policy.minMarginPct : null;
  const margin = totals.marginPct;
  const judged = (tone: MarginTone, label: string): MarginStatus => ({ tone, label, floor, showFigure: true });

  if (!(totals.subtotalAmount > 0)) return { tone: 'neutral', label: 'Not priced yet', floor, showFigure: false };
  // A quantity changed and its cost is on its way: say so rather than show
  // the margin at the old quantity's cost.
  if (linesRecosting > 0) return { tone: 'neutral', label: 'Re-costing…', floor, showFigure: false };
  if (margin < 0) return judged('danger', 'Loss');
  if (linesWithoutCost > 0) {
    const lines = linesWithoutCost === 1 ? '1 line' : `${linesWithoutCost} lines`;
    return judged('warning', `Cost missing on ${lines}`);
  }
  if (floor === null) return judged('neutral', 'No margin floor set');
  if (margin < floor) return judged('danger', `Below ${pct(floor)} floor`);
  if (margin < floor + NEAR_FLOOR) return judged('warning', `Close to ${pct(floor)} floor`);
  return judged('success', `Above ${pct(floor)} floor`);
}

export interface LineMargin {
  cost: number;
  /** Fraction of the line's own untaxed subtotal; null when it has no price. */
  marginPct: number | null;
  tone: MarginTone;
}

/**
 * One line's cost and margin, for the quiet row under its subtotal. Null for
 * a line with no cost behind it, which the table marks as such instead.
 */
export function lineMargin(item: QuoteLineItem, floor: number | null): LineMargin | null {
  if (item.type !== 'product' || !item.cost || !Number.isFinite(Number(item.cost.totalCost))) return null;
  const cost = Number(item.cost.totalCost);
  const subtotal = Number(item.subtotal) || 0;
  if (!(subtotal > 0)) return { cost, marginPct: null, tone: 'neutral' };
  const marginPct = (subtotal - cost) / subtotal;
  const tone: MarginTone = marginPct < 0 || (floor !== null && marginPct < floor) ? 'danger' : 'neutral';
  return { cost, marginPct, tone };
}

export const MARGIN_TONE_CLASSES: Record<MarginTone, string> = {
  neutral: 'bg-surface-muted text-ink-muted border-border',
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-ink border-warning/30',
  danger: 'bg-danger-soft text-danger border-danger/20',
};

/** Priced lines with no cost behind them: typed by hand rather than costed from the catalog. */
export function linesWithoutCost(items: QuoteLineItem[]): number {
  return items.filter(
    (item) =>
      item.type === 'product' &&
      (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0) > 0 &&
      !(item.cost && Number.isFinite(Number(item.cost.totalCost))),
  ).length;
}
