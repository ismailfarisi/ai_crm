import type { CostSplit } from '../production/work-orders';

/**
 * Costing that corrects itself: what completed jobs say about the catalog
 * rates every quote is priced from.
 *
 * Three rates are checked, because those are the ones a job measures:
 *
 * - a material's cost, against what it was actually issued to jobs at;
 * - a material's waste allowance, against how much jobs actually used;
 * - a work centre's time allowance (its rework uplift on run minutes),
 *   against how long its operations actually ran.
 *
 * Waste and time are measured against what each job was *planned with*,
 * recorded on the job when it was created — never against today's catalog.
 * Otherwise accepting a proposal would make the same jobs propose again.
 *
 * Nothing here changes anything. A proposal names the field, the value and
 * the evidence; a person applies it through the ordinary catalog update.
 */

export type CostingProposalKind = 'MATERIAL_PRICE' | 'MATERIAL_WASTE' | 'WORK_CENTER_TIME';

export interface CostingProposal {
  /** Stable across reviews: `<kind>:<target id>`. */
  id: string;
  kind: CostingProposalKind;
  target: { type: 'MATERIAL' | 'WORK_CENTER'; id: string; name: string };
  field: 'costPerUom' | 'wastePct' | 'scrapPct';
  current: number;
  proposed: number;
  /** Distinct jobs the evidence comes from. */
  jobs: number;
  /** A few of them, to look at. */
  workOrderNumbers: string[];
  /**
   * What the gap cost (positive) or saved (negative) across those jobs, in
   * base currency. Orders proposals; a quote priced at the current rate was
   * off by roughly this much.
   */
  impact: number;
  /** True when the evidence pointed past what the catalog accepts. */
  capped: boolean;
  reason: string;
}

export interface CostingReview {
  /** Completed jobs with both an estimate and an actual cost. */
  jobs: number;
  estimatedTotal: number;
  actualTotal: number;
  /** Actual over estimate, as a percentage; null with no jobs. */
  variancePct: number | null;
  byComponent: { component: keyof Omit<CostSplit, 'total' | 'unit'>; estimated: number; actual: number }[];
  proposals: CostingProposal[];
  /** Things worth knowing that are not a rate to change. */
  notes: string[];
}

export interface ReviewJob {
  workOrderId: string;
  woNumber: string;
  estimated: CostSplit | null;
  actual: CostSplit | null;
}

export interface ReviewMaterialUse {
  workOrderId: string;
  woNumber: string;
  materialId: string;
  /** Purchase units the job was planned to draw, waste included. */
  qtyPlanned: number;
  /** Issued less returned. */
  qtyNet: number;
  /** What the net issue cost, at the moving average. */
  valueIssued: number;
  /** The waste allowance the plan used; null for jobs planned before it was recorded. */
  plannedWastePct: number | null;
}

export interface ReviewOperation {
  workOrderId: string;
  woNumber: string;
  workCenterId: string;
  estimatedSetupMinutes: number;
  /** Run minutes as planned, time allowance included. */
  estimatedRunMinutes: number;
  estimatedChargedMinutes: number;
  actualMinutes: number;
  plannedScrapPct: number | null;
  machineCostPerHour: number;
  laborCostPerHour: number;
}

export interface ReviewInput {
  jobs: ReviewJob[];
  materialUses: ReviewMaterialUse[];
  operations: ReviewOperation[];
  catalog: {
    materials: { id: string; name: string; uom: string; costPerUom: number; wastePct: number }[];
    workCenters: { id: string; name: string; scrapPct: number; machineCostPerHour: number; laborCostPerHour: number }[];
  };
}

export interface ReviewOptions {
  /** Distinct jobs a proposal needs behind it. */
  minJobs?: number;
  /** Relative price difference worth proposing. */
  priceThreshold?: number;
  /** Waste allowance difference worth proposing, in fraction points. */
  wasteThreshold?: number;
  /** Time allowance difference worth proposing, in fraction points. */
  timeThreshold?: number;
}

/** The catalog accepts waste below 1 and a time allowance up to 1. */
const MAX_WASTE = 0.95;
const MAX_TIME_ALLOWANCE = 1;
const SAMPLE_NUMBERS = 5;

const round = (n: number, dp: number) => Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const clamp = (n: number, max: number) => ({ value: Math.min(max, Math.max(0, n)), capped: n > max });

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

const evidence = (rows: { workOrderId: string; woNumber: string }[]) => {
  const byJob = new Map(rows.map((r) => [r.workOrderId, r.woNumber]));
  return { jobs: byJob.size, workOrderNumbers: [...byJob.values()].slice(0, SAMPLE_NUMBERS) };
};

export function reviewCosting(input: ReviewInput, options: ReviewOptions = {}): CostingReview {
  const minJobs = options.minJobs ?? 3;
  const priceThreshold = options.priceThreshold ?? 0.03;
  const wasteThreshold = options.wasteThreshold ?? 0.02;
  const timeThreshold = options.timeThreshold ?? 0.05;

  const proposals: CostingProposal[] = [];
  const notes: string[] = [];
  const materials = new Map(input.catalog.materials.map((m) => [m.id, m]));
  const centres = new Map(input.catalog.workCenters.map((w) => [w.id, w]));

  /* ---- materials ---- */
  for (const [materialId, uses] of groupBy(input.materialUses, (u) => u.materialId)) {
    const material = materials.get(materialId);
    if (!material) continue;

    const priced = uses.filter((u) => u.qtyNet > 0 && u.valueIssued > 0);
    const priceEvidence = evidence(priced);
    if (priceEvidence.jobs >= minJobs) {
      const qty = priced.reduce((s, u) => s + u.qtyNet, 0);
      const actual = priced.reduce((s, u) => s + u.valueIssued, 0) / qty;
      const current = material.costPerUom;
      const gap = current > 0 ? (actual - current) / current : Infinity;
      if (Math.abs(gap) >= priceThreshold) {
        proposals.push({
          id: `MATERIAL_PRICE:${material.id}`,
          kind: 'MATERIAL_PRICE',
          target: { type: 'MATERIAL', id: material.id, name: material.name },
          field: 'costPerUom',
          current,
          proposed: round(actual, 4),
          ...priceEvidence,
          impact: round(qty * (actual - current), 2),
          capped: false,
          reason:
            current > 0
              ? `Issued to ${priceEvidence.jobs} jobs at ${round(actual, 4)} per ${material.uom.toLowerCase()} on average, ${pct(Math.abs(gap))} ${gap > 0 ? 'above' : 'below'} the catalog's ${current}.`
              : `Has no cost in the catalog, but was issued to ${priceEvidence.jobs} jobs at ${round(actual, 4)} per ${material.uom.toLowerCase()} on average.`,
        });
      }
    }

    const planned = uses.filter((u) => u.plannedWastePct != null && u.qtyPlanned > 0 && u.qtyNet > 0);
    const wasteEvidence = evidence(planned);
    if (wasteEvidence.jobs >= minJobs) {
      // The plan's quantity without its allowance: what the job needed net.
      const base = planned.reduce((s, u) => s + u.qtyPlanned / (1 + (u.plannedWastePct as number)), 0);
      const used = planned.reduce((s, u) => s + u.qtyNet, 0);
      const plannedQty = planned.reduce((s, u) => s + u.qtyPlanned, 0);
      const implied = used / base - 1;
      const { value, capped } = clamp(implied, MAX_WASTE);
      const proposed = round(value, 3);
      if (Math.abs(proposed - material.wastePct) >= wasteThreshold) {
        proposals.push({
          id: `MATERIAL_WASTE:${material.id}`,
          kind: 'MATERIAL_WASTE',
          target: { type: 'MATERIAL', id: material.id, name: material.name },
          field: 'wastePct',
          current: material.wastePct,
          proposed,
          ...wasteEvidence,
          impact: round((used - plannedQty) * material.costPerUom, 2),
          capped,
          reason:
            `${wasteEvidence.jobs} jobs used ${round(used, 2)} ${material.uom.toLowerCase()} against ${round(plannedQty, 2)} planned: ` +
            `an allowance of ${pct(Math.max(0, implied))} would have covered it.` +
            (material.uom === 'SHEET' ? ' Planned sheets are rounded up, so the true waste may be a little higher.' : ''),
        });
      }
    }
  }

  /* ---- work centres ---- */
  for (const [workCenterId, ops] of groupBy(input.operations, (o) => o.workCenterId)) {
    const centre = centres.get(workCenterId);
    if (!centre) continue;
    const timed = ops.filter((o) => o.plannedScrapPct != null && o.actualMinutes > 0 && o.estimatedRunMinutes > 0);
    const timeEvidence = evidence(timed);
    if (timeEvidence.jobs < minJobs) continue;

    // Run time as the template stated it, before the allowance was added.
    const raw = timed.reduce((s, o) => s + o.estimatedRunMinutes / (1 + (o.plannedScrapPct as number)), 0);
    const ran = timed.reduce((s, o) => s + Math.max(0, o.actualMinutes - o.estimatedSetupMinutes), 0);
    const implied = ran / raw - 1;
    const extraMinutes = timed.reduce((s, o) => s + (o.actualMinutes - o.estimatedChargedMinutes), 0);
    const impact = timed.reduce(
      (s, o) => s + ((o.actualMinutes - o.estimatedChargedMinutes) / 60) * (o.machineCostPerHour + o.laborCostPerHour),
      0,
    );

    if (implied < 0 && centre.scrapPct === 0) {
      notes.push(
        `${centre.name} ran ${pct(-implied)} faster than its templates assume across ${timeEvidence.jobs} jobs. ` +
          'Its time allowance is already zero, so the run-time formulas on the templates that use it are the place to look.',
      );
      continue;
    }
    const { value, capped } = clamp(implied, MAX_TIME_ALLOWANCE);
    const proposed = round(value, 3);
    if (Math.abs(proposed - centre.scrapPct) < timeThreshold) continue;
    proposals.push({
      id: `WORK_CENTER_TIME:${centre.id}`,
      kind: 'WORK_CENTER_TIME',
      target: { type: 'WORK_CENTER', id: centre.id, name: centre.name },
      field: 'scrapPct',
      current: centre.scrapPct,
      proposed,
      ...timeEvidence,
      impact: round(impact, 2),
      capped,
      reason:
        `Operations on ${centre.name} across ${timeEvidence.jobs} jobs ran ${Math.round(Math.abs(extraMinutes))} minutes ` +
        `${extraMinutes >= 0 ? 'longer' : 'shorter'} than planned in all; a time allowance of ${pct(Math.max(0, implied))} on run minutes would have matched.`,
    });
  }

  /* ---- overall ---- */
  const costed = input.jobs.filter((j) => j.estimated && j.actual);
  const sum = (pick: (s: CostSplit) => number, side: 'estimated' | 'actual') =>
    round(costed.reduce((s, j) => s + pick(j[side] as CostSplit), 0), 2);
  const estimatedTotal = sum((s) => s.total, 'estimated');
  const actualTotal = sum((s) => s.total, 'actual');
  const components = ['material', 'machine', 'labor', 'tooling', 'overhead'] as const;

  return {
    jobs: costed.length,
    estimatedTotal,
    actualTotal,
    variancePct: estimatedTotal > 0 ? round(((actualTotal - estimatedTotal) / estimatedTotal) * 100, 2) : null,
    byComponent: components.map((component) => ({
      component,
      estimated: sum((s) => s[component], 'estimated'),
      actual: sum((s) => s[component], 'actual'),
    })),
    proposals: proposals.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)),
    notes,
  };
}

/** The review as the API returns it: over jobs completed in the last `windowDays`. */
export interface CostingReviewDto extends CostingReview {
  windowDays: number;
  /** YYYY-MM-DD: jobs completed on or after this day are reviewed. */
  from: string;
}
