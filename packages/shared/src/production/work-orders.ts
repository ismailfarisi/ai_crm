/**
 * Work orders and actual cost.
 *
 * A quote is priced off estimated minutes per work centre and estimated
 * material per job. Nothing recorded how long the job really took, so a
 * template that was 40% optimistic stayed 40% optimistic for as long as it
 * lived. A work order records what the shop actually did; the functions here
 * turn that into a cost comparable to the quoted one, and rank which
 * estimates are wrong.
 *
 * Pure and shared so the shop-floor screen can show a running cost with the
 * same arithmetic the API stores on completion.
 */

export type WorkOrderStatus = 'PLANNED' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETE' | 'CANCELLED';

export type WorkOrderOperationStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'DONE' | 'SKIPPED';

export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  PLANNED: ['RELEASED', 'CANCELLED'],
  RELEASED: ['IN_PROGRESS', 'COMPLETE', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETE', 'CANCELLED'],
  COMPLETE: [],
  CANCELLED: [],
};

export function canTransitionWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return WORK_ORDER_TRANSITIONS[from].includes(to);
}

/** Shop-floor actions are only meaningful once a job has been released to the floor. */
export const isOnTheFloor = (status: WorkOrderStatus): boolean =>
  status === 'RELEASED' || status === 'IN_PROGRESS';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number): number => Math.round((n + Number.EPSILON) * 10000) / 10000;

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

/**
 * Minutes between a start and a stop, to the tenth of a minute.
 *
 * A clock that goes backwards (a tablet with the wrong time, a stop recorded
 * before its start) yields zero rather than negative time; negative minutes
 * would quietly make a job look cheaper than it was.
 */
export function elapsedMinutes(from: Date | string, to: Date | string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / 6000) / 10;
}

/**
 * The longest a single timer session may count before it is treated as
 * someone forgetting to press stop. Twelve hours covers a double shift; a
 * timer left running over a weekend should not add sixty hours to a job.
 */
export const MAX_SESSION_MINUTES = 12 * 60;

/* ------------------------------------------------------------------ *
 * Cost
 * ------------------------------------------------------------------ */

export interface OperationCostInput {
  workCenterId: string;
  workCenterName: string;
  status: WorkOrderOperationStatus;
  estimatedSetupMinutes: number;
  estimatedRunMinutes: number;
  /** Minutes the engine charged, after the work centre's minimum charge. */
  estimatedChargedMinutes: number;
  actualMinutes: number;
  /** Rates as they were when the work order was created, so a rate change does not rewrite history. */
  machineCostPerHour: number;
  laborCostPerHour: number;
}

export interface CostSplit {
  material: number;
  machine: number;
  labor: number;
  tooling: number;
  overhead: number;
  total: number;
  unit: number;
}

/**
 * What the job actually cost, built the way the estimate was built.
 *
 * Material is what was issued to the job at the moving average, net of
 * returns. Machine and labour are actual minutes at the snapshotted rates.
 * Tooling is carried over from the estimate — a die is bought once, not
 * consumed by the minute — and overhead is the template's own burden applied
 * to the actual direct cost, exactly as the engine applied it to the
 * estimated one. Without that symmetry the comparison would show an
 * "overrun" that is only the overhead line being present on one side.
 *
 * Unit cost divides by the good quantity completed, so scrap shows up as a
 * dearer unit rather than disappearing.
 */
export function actualCost(input: {
  operations: OperationCostInput[];
  materialValue: number;
  toolingCost: number;
  overheadPct: number;
  qtyCompleted: number;
}): CostSplit {
  let machine = 0;
  let labor = 0;
  for (const op of input.operations) {
    if (op.status === 'SKIPPED') continue;
    const hours = Math.max(0, op.actualMinutes) / 60;
    machine += hours * op.machineCostPerHour;
    labor += hours * op.laborCostPerHour;
  }
  const material = Math.max(0, input.materialValue);
  const direct = material + machine + labor + input.toolingCost;
  const overhead = direct * Math.max(0, input.overheadPct);
  const total = direct + overhead;

  return {
    material: round2(material),
    machine: round2(machine),
    labor: round2(labor),
    tooling: round2(input.toolingCost),
    overhead: round2(overhead),
    total: round2(total),
    unit: input.qtyCompleted > 0 ? round4(total / input.qtyCompleted) : 0,
  };
}

/* ------------------------------------------------------------------ *
 * The variance report
 * ------------------------------------------------------------------ */

export interface VarianceSample {
  templateKey: string | null;
  templateName: string | null;
  templateVersion: number | null;
  workCenterId: string;
  workCenterName: string;
  estimatedMinutes: number;
  actualMinutes: number;
  laborCostPerHour: number;
  machineCostPerHour: number;
}

export interface VarianceRow {
  templateKey: string | null;
  templateName: string | null;
  templateVersion: number | null;
  workCenterId: string;
  workCenterName: string;
  /** Completed operations contributing to this row. */
  samples: number;
  estimatedMinutes: number;
  actualMinutes: number;
  /** actual − estimated. Positive means the estimate was optimistic. */
  varianceMinutes: number;
  /** Relative to the estimate; null when nothing was estimated. */
  variancePct: number | null;
  /** The variance priced at the work centre's rates: what the error cost, per the ledger's own rates. */
  varianceCost: number;
  /**
   * What the template's run-minute estimate should be multiplied by to match
   * reality. 1.25 means "this operation takes a quarter longer than we say".
   */
  suggestedFactor: number | null;
}

/**
 * Estimate against actual, grouped by template version and work centre,
 * ranked by the absolute cost of the error.
 *
 * Ranked by cost rather than by percentage: a 60% miss on a two-minute
 * glueing step matters less than a 10% miss on a four-hour press run, and
 * the point of the report is to say which template rate to fix first.
 *
 * Errors are summed signed within a group and only then made absolute, so a
 * job that ran long and a job that ran short on the same operation partly
 * cancel — which is right, because a rate is an average.
 */
export function rankVariance(samples: VarianceSample[]): VarianceRow[] {
  const groups = new Map<string, VarianceSample[]>();
  for (const sample of samples) {
    const key = `${sample.templateKey ?? '-'}|${sample.templateVersion ?? '-'}|${sample.workCenterId}`;
    const list = groups.get(key);
    if (list) list.push(sample);
    else groups.set(key, [sample]);
  }

  const rows: VarianceRow[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    let estimated = 0;
    let actual = 0;
    let cost = 0;
    for (const s of list) {
      estimated += s.estimatedMinutes;
      actual += s.actualMinutes;
      cost += ((s.actualMinutes - s.estimatedMinutes) / 60) * (s.laborCostPerHour + s.machineCostPerHour);
    }
    rows.push({
      templateKey: first.templateKey,
      templateName: first.templateName,
      templateVersion: first.templateVersion,
      workCenterId: first.workCenterId,
      workCenterName: first.workCenterName,
      samples: list.length,
      estimatedMinutes: Math.round(estimated * 10) / 10,
      actualMinutes: Math.round(actual * 10) / 10,
      varianceMinutes: Math.round((actual - estimated) * 10) / 10,
      variancePct: estimated > 0 ? Math.round(((actual - estimated) / estimated) * 1000) / 1000 : null,
      varianceCost: round2(cost),
      suggestedFactor: estimated > 0 ? Math.round((actual / estimated) * 100) / 100 : null,
    });
  }

  return rows.sort(
    (a, b) =>
      Math.abs(b.varianceCost) - Math.abs(a.varianceCost) ||
      Math.abs(b.varianceMinutes) - Math.abs(a.varianceMinutes),
  );
}

/* ------------------------------------------------------------------ *
 * Wire shapes
 * ------------------------------------------------------------------ */

export interface WorkOrderOperationDto {
  id: string;
  sequence: number;
  label: string;
  workCenterId: string;
  workCenterName: string;
  status: WorkOrderOperationStatus;
  estimatedSetupMinutes: number;
  estimatedRunMinutes: number;
  estimatedChargedMinutes: number;
  actualMinutes: number;
  /** Set while a timer is running, so the tablet can show a live clock. */
  runningSince: string | null;
  operatorId: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkOrderMaterialDto {
  id: string;
  materialId: string;
  materialName: string;
  uom: string;
  qtyPlanned: number;
  qtyIssued: number;
  qtyReturned: number;
  /** Net value issued to the job at the moving average. */
  valueIssued: number;
  estimatedUnitCost: number;
}

export interface WorkOrderDto {
  id: string;
  woNumber: string;
  status: WorkOrderStatus;
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  salesOrderLineId: string | null;
  customerName: string | null;
  description: string;
  templateId: string | null;
  templateName: string | null;
  templateVersion: number | null;
  qty: number;
  qtyCompleted: number | null;
  dueDate: string | null;
  releasedAt: string | null;
  completedAt: string | null;
  /** Null for callers without `quote:view_cost`. */
  quotedUnitCost: number | null;
  estimatedCost: CostSplit | null;
  actualCost: CostSplit | null;
  operations: WorkOrderOperationDto[];
  materials: WorkOrderMaterialDto[];
  createdAt: string;
}
