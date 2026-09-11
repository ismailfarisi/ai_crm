import {
  ExpressionError,
  evaluate,
  compileExpression,
  type BuiltinFunction,
  type EvalScope,
  type ExprValue,
} from './expression';
import { nestBlankOnSheet, rotationAllowedFor } from './nesting';
import type {
  CostBreakdown,
  CostingCatalog,
  MaterialCostLine,
  OperationCostLine,
  PriceBreak,
  PriceResult,
  ProductTemplate,
  TemplateParameter,
  ToolingCostLine,
} from './types';

/** Money is rounded at boundaries only; intermediates stay at full precision. */
const money = (value: number): number => Math.round(value * 100) / 100;
const cost4 = (value: number): number => Math.round(value * 10000) / 10000;

export class CostingError extends Error {
  readonly detail?: string;
  constructor(message: string, detail?: string) {
    super(detail ? `${message}: ${detail}` : message);
    this.name = 'CostingError';
    this.detail = detail;
  }
}

export interface CostingContext {
  /** Tooling the customer already paid for on a previous order — not re-charged. */
  toolingAlreadyOwned?: string[];
}

/**
 * `quantity` is supplied per costing run rather than declared as a parameter,
 * because the engine sweeps it to build the price break table.
 */
const RESERVED_KEYS = new Set(['quantity', 'true', 'false']);

function domainBuiltins(): Record<string, BuiltinFunction> {
  return {
    /**
     * nestPerSheet(blankW, blankH, sheetW, sheetH [, allowRotation [, margin [, gutter]]])
     *
     * A builtin rather than a formula because guillotine layout with grain and
     * gutters is real geometry, and no template author should reimplement it.
     */
    nestPerSheet: (args, fail) => {
      if (args.length < 4 || args.length > 7) {
        return fail(`nestPerSheet() expects 4-7 arguments, got ${args.length}`);
      }

      const asNumber = (index: number): number => {
        const arg = args[index];
        if (typeof arg !== 'number') {
          return fail(`nestPerSheet() argument ${index + 1} must be a number`);
        }
        return arg;
      };

      let allowRotation = true;
      if (args.length > 4) {
        const flag = args[4];
        if (typeof flag !== 'boolean') {
          return fail('nestPerSheet() argument 5 (allowRotation) must be a boolean');
        }
        allowRotation = flag;
      }

      return nestBlankOnSheet(asNumber(0), asNumber(1), asNumber(2), asNumber(3), {
        allowRotation,
        marginMm: args.length > 5 ? asNumber(5) : undefined,
        gutterMm: args.length > 6 ? asNumber(6) : undefined,
      }).perSheet;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Parameter validation
 * ------------------------------------------------------------------ */

export function resolveParameters(
  template: ProductTemplate,
  input: Record<string, ExprValue | undefined>,
): Record<string, ExprValue> {
  const resolved: Record<string, ExprValue> = {};

  for (const parameter of template.parameters) {
    if (RESERVED_KEYS.has(parameter.key)) {
      throw new CostingError(
        `Template "${template.name}" declares reserved parameter "${parameter.key}"`,
      );
    }

    const raw = input[parameter.key] ?? parameter.defaultValue;
    if (raw === undefined) {
      throw new CostingError(`Missing required parameter "${parameter.key}" (${parameter.label})`);
    }

    resolved[parameter.key] = validateParameter(parameter, raw);
  }

  const declared = new Set(template.parameters.map((p) => p.key));
  for (const key of Object.keys(input)) {
    if (!declared.has(key) && input[key] !== undefined) {
      throw new CostingError(`Unknown parameter "${key}" for template "${template.name}"`);
    }
  }

  return resolved;
}

function validateParameter(parameter: TemplateParameter, raw: ExprValue): ExprValue {
  switch (parameter.type) {
    case 'NUMBER': {
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value)) {
        throw new CostingError(`Parameter "${parameter.key}" must be a number, got ${String(raw)}`);
      }
      if (parameter.min !== undefined && value < parameter.min) {
        throw new CostingError(
          `Parameter "${parameter.key}" is ${value}${parameter.unit ?? ''}, below the minimum of ${parameter.min}${parameter.unit ?? ''}`,
        );
      }
      if (parameter.max !== undefined && value > parameter.max) {
        throw new CostingError(
          `Parameter "${parameter.key}" is ${value}${parameter.unit ?? ''}, above the maximum of ${parameter.max}${parameter.unit ?? ''}`,
        );
      }
      return value;
    }
    case 'BOOLEAN': {
      if (typeof raw === 'boolean') return raw;
      throw new CostingError(`Parameter "${parameter.key}" must be true or false`);
    }
    case 'ENUM': {
      if (typeof raw !== 'string' || !(parameter.options ?? []).includes(raw)) {
        throw new CostingError(
          `Parameter "${parameter.key}" must be one of ${(parameter.options ?? []).join(', ')}, got ${String(raw)}`,
        );
      }
      return raw;
    }
    default:
      throw new CostingError(`Unsupported parameter type on "${parameter.key}"`);
  }
}

/* ------------------------------------------------------------------ *
 * The costing run
 * ------------------------------------------------------------------ */

export function costTemplate(
  template: ProductTemplate,
  catalog: CostingCatalog,
  parameters: Record<string, ExprValue | undefined>,
  quantity: number,
  context: CostingContext = {},
): CostBreakdown {
  if (!Number.isFinite(quantity) || quantity <= 0 || Math.floor(quantity) !== quantity) {
    throw new CostingError(`Quantity must be a positive whole number, got ${String(quantity)}`);
  }

  const functions = domainBuiltins();
  const warnings: string[] = [];
  const resolvedParameters = resolveParameters(template, parameters);

  const scope: Record<string, ExprValue> = { ...resolvedParameters, quantity };

  const read = (formula: string, label: string): ExprValue => {
    try {
      return evaluate(compileExpression(formula), scope as EvalScope, { functions });
    } catch (error) {
      if (error instanceof ExpressionError) {
        throw new CostingError(`${label} failed`, error.message);
      }
      throw error;
    }
  };

  const readNumber = (formula: string, label: string): number => {
    const value = read(formula, label);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new CostingError(`${label} must produce a number`, `got ${String(value)}`);
    }
    return value;
  };

  const readBoolean = (formula: string, label: string): boolean => {
    const value = read(formula, label);
    if (typeof value !== 'boolean') {
      throw new CostingError(`${label} must produce true or false`, `got ${String(value)}`);
    }
    return value;
  };

  // 1. Derived intermediates, in declaration order.
  for (const derived of template.derived ?? []) {
    if (derived.key in scope) {
      throw new CostingError(`Derived variable "${derived.key}" shadows an existing name`);
    }
    scope[derived.key] = readNumber(derived.formula, `Derived "${derived.key}"`);
  }

  // 2. Materials. Each publishes its results so operations can reference them.
  const materialLines: MaterialCostLine[] = [];

  for (const line of template.materials) {
    const material = catalog.materials[line.materialId];
    if (!material) {
      throw new CostingError(`Unknown material "${line.materialId}" on line "${line.key}"`);
    }

    const included =
      line.condition === undefined
        ? true
        : readBoolean(line.condition, `Condition on material "${line.key}"`);

    if (!included) {
      scope[`${line.key}_units`] = 0;
      scope[`${line.key}_cost`] = 0;
      continue;
    }

    const wastePct = line.wastePctFormula
      ? readNumber(line.wastePctFormula, `Waste on material "${line.key}"`)
      : (material.wastePct ?? 0);

    if (wastePct < 0 || wastePct >= 1) {
      throw new CostingError(
        `Waste on material "${line.key}" must be between 0 and 1, got ${wastePct}`,
      );
    }

    let purchaseUnits: number;
    let extras: Partial<MaterialCostLine> = {};

    if (line.mode === 'SHEET_NEST') {
      if (material.uom !== 'SHEET') {
        throw new CostingError(
          `Material line "${line.key}" nests sheets but "${material.name}" is priced per ${material.uom}`,
        );
      }
      if (!line.blankWidthFormula || !line.blankHeightFormula) {
        throw new CostingError(`Material line "${line.key}" is SHEET_NEST but has no blank size`);
      }
      if (!material.sheetWidthMm || !material.sheetHeightMm) {
        throw new CostingError(`Material "${material.name}" has no sheet dimensions`);
      }

      const blankWidthMm = readNumber(line.blankWidthFormula, `Blank width on "${line.key}"`);
      const blankHeightMm = readNumber(line.blankHeightFormula, `Blank height on "${line.key}"`);

      const nest = nestBlankOnSheet(
        blankWidthMm,
        blankHeightMm,
        material.sheetWidthMm,
        material.sheetHeightMm,
        {
          allowRotation: rotationAllowedFor(material.grain),
          marginMm: line.marginMm,
          gutterMm: line.gutterMm,
        },
      );

      if (nest.perSheet < 1) {
        // The defining failure of a custom shape: loudly, not as Infinity.
        throw new CostingError(
          `Blank for "${line.label}" (${Math.round(blankWidthMm)}×${Math.round(blankHeightMm)}mm) does not fit on ${material.name} (${material.sheetWidthMm}×${material.sheetHeightMm}mm)`,
        );
      }

      if (nest.utilisation < 0.55) {
        warnings.push(
          `"${line.label}" only uses ${Math.round(nest.utilisation * 100)}% of each ${material.name} sheet — a small dimension change may fit another blank on.`,
        );
      }

      purchaseUnits = Math.ceil((quantity * (1 + wastePct)) / nest.perSheet);
      extras = {
        blankWidthMm: Math.round(blankWidthMm * 100) / 100,
        blankHeightMm: Math.round(blankHeightMm * 100) / 100,
        perSheet: nest.perSheet,
        orientation: nest.orientation,
        utilisation: Math.round(nest.utilisation * 1000) / 1000,
      };
      scope[`${line.key}_per_sheet`] = nest.perSheet;
    } else {
      if (!line.quantityFormula) {
        throw new CostingError(`Material line "${line.key}" has no quantity formula`);
      }
      const per = readNumber(line.quantityFormula, `Quantity on material "${line.key}"`);
      if (per < 0) {
        throw new CostingError(`Material line "${line.key}" produced a negative quantity`);
      }
      const total = (line.mode === 'PER_UNIT' ? per * quantity : per) * (1 + wastePct);
      // Discrete stock is bought whole; bulk stock is not.
      purchaseUnits = material.uom === 'EACH' || material.uom === 'SHEET' ? Math.ceil(total) : total;
    }

    const lineCost = cost4(purchaseUnits * material.costPerUom);

    materialLines.push({
      key: line.key,
      label: line.label,
      materialId: material.id,
      materialName: material.name,
      mode: line.mode,
      uom: material.uom,
      wastePct,
      purchaseUnits: Math.round(purchaseUnits * 1000) / 1000,
      unitCost: material.costPerUom,
      cost: lineCost,
      ...extras,
    });

    scope[`${line.key}_units`] = purchaseUnits;
    scope[`${line.key}_cost`] = lineCost;
  }

  // 3. Operations, in routing order, able to read material results.
  const operationLines: OperationCostLine[] = [];
  const ordered = [...template.operations].sort((a, b) => a.sequence - b.sequence);

  for (const operation of ordered) {
    const workCenter = catalog.workCenters[operation.workCenterId];
    if (!workCenter) {
      throw new CostingError(
        `Unknown work centre "${operation.workCenterId}" on operation "${operation.key}"`,
      );
    }

    const included =
      operation.condition === undefined
        ? true
        : readBoolean(operation.condition, `Condition on operation "${operation.key}"`);

    if (!included) {
      scope[`${operation.key}_minutes`] = 0;
      scope[`${operation.key}_cost`] = 0;
      continue;
    }

    const setupMinutes = operation.setupMinutesFormula
      ? readNumber(operation.setupMinutesFormula, `Setup on operation "${operation.key}"`)
      : workCenter.setupMinutes;

    const rawRunMinutes = readNumber(
      operation.runMinutesFormula,
      `Run time on operation "${operation.key}"`,
    );

    if (setupMinutes < 0 || rawRunMinutes < 0) {
      throw new CostingError(`Operation "${operation.key}" produced negative minutes`);
    }

    // Spoilage shows up as rework time, not as extra material.
    const runMinutes = rawRunMinutes * (1 + (workCenter.scrapPct ?? 0));
    const totalMinutes = setupMinutes + runMinutes;
    const chargedMinutes = Math.max(totalMinutes, workCenter.minChargeMinutes ?? 0);

    const machineCost = cost4((chargedMinutes / 60) * workCenter.machineCostPerHour);
    const laborCost = cost4((chargedMinutes / 60) * workCenter.laborCostPerHour);

    operationLines.push({
      key: operation.key,
      label: operation.label,
      workCenterId: workCenter.id,
      workCenterName: workCenter.name,
      sequence: operation.sequence,
      branch: operation.branch ?? null,
      setupMinutes: Math.round(setupMinutes * 100) / 100,
      runMinutes: Math.round(runMinutes * 100) / 100,
      chargedMinutes: Math.round(chargedMinutes * 100) / 100,
      machineCost,
      laborCost,
      cost: cost4(machineCost + laborCost),
    });

    scope[`${operation.key}_minutes`] = chargedMinutes;
    scope[`${operation.key}_cost`] = machineCost + laborCost;
  }

  // 4. Tooling.
  const owned = new Set(context.toolingAlreadyOwned ?? []);
  const toolingLines: ToolingCostLine[] = [];

  for (const line of template.tooling ?? []) {
    const tool = catalog.tooling[line.toolingId];
    if (!tool) {
      throw new CostingError(`Unknown tooling "${line.toolingId}" on line "${line.key}"`);
    }

    const included =
      line.condition === undefined
        ? true
        : readBoolean(line.condition, `Condition on tooling "${line.key}"`);
    if (!included) continue;

    const reused = tool.reusable && owned.has(tool.id);
    toolingLines.push({
      key: line.key,
      label: line.label,
      toolingId: tool.id,
      cost: reused ? 0 : tool.cost,
      amortized: tool.amortize,
      reused,
    });
  }

  // 5. Roll-up.
  const materialCost = materialLines.reduce((sum, line) => sum + line.cost, 0);
  const machineCost = operationLines.reduce((sum, line) => sum + line.machineCost, 0);
  const laborCost = operationLines.reduce((sum, line) => sum + line.laborCost, 0);
  const amortizedToolingCost = toolingLines
    .filter((line) => line.amortized)
    .reduce((sum, line) => sum + line.cost, 0);
  const separateToolingCost = toolingLines
    .filter((line) => !line.amortized)
    .reduce((sum, line) => sum + line.cost, 0);

  const directCost = materialCost + machineCost + laborCost + amortizedToolingCost;
  const overheadCost = directCost * (template.pricing.overheadPct ?? 0);
  const totalCost = directCost + overheadCost;

  const price = applyPricing(template, totalCost, separateToolingCost, quantity);

  const totalMinutes = operationLines.reduce((sum, line) => sum + line.chargedMinutes, 0);

  return {
    templateId: template.id,
    templateVersion: template.version,
    quantity,
    parameters: resolvedParameters,
    materials: materialLines,
    operations: operationLines,
    tooling: toolingLines,
    materialCost: money(materialCost),
    machineCost: money(machineCost),
    laborCost: money(laborCost),
    amortizedToolingCost: money(amortizedToolingCost),
    separateToolingCost: money(separateToolingCost),
    directCost: money(directCost),
    overheadCost: money(overheadCost),
    totalCost: money(totalCost),
    unitCost: cost4(totalCost / quantity),
    price,
    totalMinutes: Math.round(totalMinutes * 100) / 100,
    criticalPathMinutes: criticalPath(operationLines),
    scope: { ...scope },
    warnings,
  };
}

function applyPricing(
  template: ProductTemplate,
  totalCost: number,
  separateToolingCost: number,
  quantity: number,
): PriceResult {
  const { method, rate, minCharge, roundUnitPriceTo } = template.pricing;

  if (method === 'MARGIN' && (rate < 0 || rate >= 1)) {
    throw new CostingError(`Target margin must be between 0 and 1, got ${rate}`);
  }
  if (method === 'MARKUP' && rate < 0) {
    throw new CostingError(`Markup must not be negative, got ${rate}`);
  }

  let totalPrice = method === 'MARGIN' ? totalCost / (1 - rate) : totalCost * (1 + rate);

  if (minCharge !== undefined) {
    totalPrice = Math.max(totalPrice, minCharge);
  }

  let unitPrice = totalPrice / quantity;
  if (roundUnitPriceTo && roundUnitPriceTo > 0) {
    unitPrice = Math.ceil(unitPrice / roundUnitPriceTo) * roundUnitPriceTo;
    totalPrice = unitPrice * quantity;
  }

  totalPrice = money(totalPrice);
  unitPrice = money(unitPrice);

  const marginAmount = money(totalPrice - totalCost);

  return {
    totalPrice,
    unitPrice,
    marginAmount,
    // Margin is on price, never on cost, and never includes tooling billed
    // through at cost.
    marginPct: totalPrice > 0 ? Math.round((marginAmount / totalPrice) * 10000) / 10000 : 0,
    separateToolingPrice: money(separateToolingCost),
    grandTotal: money(totalPrice + separateToolingCost),
  };
}

/**
 * Longest path through the routing.
 *
 * Operations on the same branch are a chain and add up; separate branches run
 * side by side, so the concurrent section costs only its slowest branch.
 * Ungrouped operations are serial around it.
 *
 * This is a deliberately flat approximation of a dependency graph: every
 * branch is assumed to start at the same time and finish before the first
 * ungrouped operation that follows. It is enough to date a quote; it is not a
 * scheduler.
 */
function criticalPath(operations: OperationCostLine[]): number {
  const branches = new Map<string, number>();
  let serial = 0;

  for (const operation of operations) {
    if (operation.branch) {
      branches.set(
        operation.branch,
        (branches.get(operation.branch) ?? 0) + operation.chargedMinutes,
      );
    } else {
      serial += operation.chargedMinutes;
    }
  }

  const concurrent = branches.size > 0 ? Math.max(...branches.values()) : 0;
  return Math.round((serial + concurrent) * 100) / 100;
}

/**
 * The engine's real output. Because of `ceil()` on sheets and setup time being
 * quantity-independent, unit price falls in steps as quantity rises — which is
 * exactly how this trade quotes, and why a single `unitPrice` column can never
 * be right.
 */
export function calculatePriceBreaks(
  template: ProductTemplate,
  catalog: CostingCatalog,
  parameters: Record<string, ExprValue | undefined>,
  quantities: number[],
  context: CostingContext = {},
): PriceBreak[] {
  return [...quantities]
    .sort((a, b) => a - b)
    .map((quantity) => {
      const breakdown = costTemplate(template, catalog, parameters, quantity, context);
      return {
        quantity,
        unitPrice: breakdown.price.unitPrice,
        totalPrice: breakdown.price.totalPrice,
        unitCost: breakdown.unitCost,
        marginPct: breakdown.price.marginPct,
      };
    });
}

/**
 * Lead time from the routing. Work-centre capacity is the real constraint — a
 * booked die-cutter sets the date, not the total hours in the job.
 */
export function estimateWorkingDays(
  breakdown: CostBreakdown,
  catalog: CostingCatalog,
  options: { defaultDailyCapacityMinutes?: number } = {},
): number {
  const fallback = options.defaultDailyCapacityMinutes ?? 480;
  const perWorkCenter = new Map<string, number>();

  for (const operation of breakdown.operations) {
    perWorkCenter.set(
      operation.workCenterId,
      (perWorkCenter.get(operation.workCenterId) ?? 0) + operation.chargedMinutes,
    );
  }

  let longest = 0;
  for (const [workCenterId, minutes] of perWorkCenter) {
    const capacity = catalog.workCenters[workCenterId]?.dailyCapacityMinutes ?? fallback;
    longest = Math.max(longest, minutes / capacity);
  }

  return Math.ceil(longest);
}
