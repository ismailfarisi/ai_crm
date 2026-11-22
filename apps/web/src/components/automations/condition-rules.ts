import type { EventFieldType } from './event-data';

/**
 * The rule builder behind "Only continue if…". The builder's state is saved
 * beside the expression it produces: `config.condition` is what the engine
 * evaluates, `config.conditionBuilder` is only how the editor reopens it.
 *
 * The engine's expression language has comparisons but no function calls, so
 * there is no "contains": every operator here is one it can evaluate.
 */
export type ConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'notEmpty';

export interface ConditionRule {
  /** The expression being tested, e.g. `$trigger.payload.totalAmount`. */
  field: string;
  /** Its plain name, kept so the canvas can describe the rule. */
  label?: string;
  type?: EventFieldType;
  op: ConditionOperator;
  value: string;
}

export interface ConditionBuilderState {
  match: 'all' | 'any';
  rules: ConditionRule[];
}

export const EMPTY_RULE: ConditionRule = { field: '', op: 'eq', value: '' };

const SYMBOL: Record<Exclude<ConditionOperator, 'empty' | 'notEmpty'>, string> = {
  eq: '==',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

const WORDS: Record<ConditionOperator, { text: string; number: string; date: string }> = {
  eq: { text: 'is', number: 'is', date: 'is on' },
  neq: { text: 'is not', number: 'is not', date: 'is not on' },
  gt: { text: 'is more than', number: 'is more than', date: 'is after' },
  gte: { text: 'is at least', number: 'is at least', date: 'is on or after' },
  lt: { text: 'is less than', number: 'is less than', date: 'is before' },
  lte: { text: 'is at most', number: 'is at most', date: 'is on or before' },
  empty: { text: 'is empty', number: 'is empty', date: 'is empty' },
  notEmpty: { text: 'is filled in', number: 'is filled in', date: 'is filled in' },
};

/** The operators that make sense for a kind of field, in the order offered. */
export function operatorsFor(type: EventFieldType | undefined): ConditionOperator[] {
  switch (type) {
    case 'number':
    case 'date':
      return ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'empty', 'notEmpty'];
    case 'choice':
      return ['eq', 'neq', 'empty', 'notEmpty'];
    default:
      return ['eq', 'neq', 'empty', 'notEmpty'];
  }
}

export function operatorLabel(op: ConditionOperator, type?: EventFieldType): string {
  const words = WORDS[op];
  return type === 'number' ? words.number : type === 'date' ? words.date : words.text;
}

export function needsValue(op: ConditionOperator): boolean {
  return op !== 'empty' && op !== 'notEmpty';
}

export function isCompleteRule(rule: ConditionRule): boolean {
  return rule.field.trim() !== '' && (!needsValue(rule.op) || rule.value.trim() !== '');
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** A number stays a number; anything else becomes quoted text. */
function literal(rule: ConditionRule): string {
  const value = rule.value.trim();
  // A yes/no field holds true or false, not the words.
  if (rule.type === 'choice' && (value === 'true' || value === 'false')) return value;
  if (rule.type !== 'text' && rule.type !== 'choice' && rule.type !== 'date' && NUMERIC.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function ruleExpression(rule: ConditionRule): string {
  const field = rule.field.trim();
  if (rule.op === 'empty') return `(${field} == null || ${field} === "")`;
  if (rule.op === 'notEmpty') return `(${field} != null && ${field} !== "")`;
  return `${field} ${SYMBOL[rule.op]} ${literal(rule)}`;
}

/** The expression the engine evaluates; empty until one rule is complete. */
export function conditionExpression(state: ConditionBuilderState): string {
  return state.rules
    .filter(isCompleteRule)
    .map(ruleExpression)
    .join(state.match === 'any' ? ' || ' : ' && ');
}

/** How a choice reads: a yes/no field is stored as true/false. */
export function choiceLabel(value: string): string {
  return value === 'true' ? 'Yes' : value === 'false' ? 'No' : value;
}

/** "Quote total is more than 10000 and Status is APPROVED". */
export function describeCondition(state: ConditionBuilderState): string {
  return state.rules
    .filter(isCompleteRule)
    .map((rule) => {
      const name = rule.label || rule.field;
      const words = operatorLabel(rule.op, rule.type);
      return needsValue(rule.op) ? `${name} ${words} ${choiceLabel(rule.value.trim())}` : `${name} ${words}`;
    })
    .join(state.match === 'any' ? ' or ' : ' and ');
}

function isBuilderState(value: unknown): value is ConditionBuilderState {
  const state = value as ConditionBuilderState | null | undefined;
  return !!state && typeof state === 'object' && Array.isArray(state.rules);
}

/**
 * How a condition step's config opens in the editor: in the builder when the
 * saved rules still produce the saved expression (or nothing is set yet),
 * otherwise as the typed expression, which is never rewritten.
 */
export function readCondition(config: Record<string, unknown> | undefined): {
  mode: 'builder' | 'typed';
  state: ConditionBuilderState;
  expression: string;
} {
  const expression = typeof config?.condition === 'string' ? config.condition : '';
  const saved = config?.conditionBuilder;
  if (isBuilderState(saved) && conditionExpression(saved) === expression.trim()) {
    return { mode: 'builder', state: { match: saved.match === 'any' ? 'any' : 'all', rules: saved.rules }, expression };
  }
  const empty: ConditionBuilderState = { match: 'all', rules: [{ ...EMPTY_RULE }] };
  // `null` is "written by hand", chosen in the editor; an older step has no key at all.
  const typed = saved === null || expression.trim() !== '';
  return { mode: typed ? 'typed' : 'builder', state: empty, expression };
}
