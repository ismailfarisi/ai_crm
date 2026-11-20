'use client';

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DataGroup } from '../step-wording';
import { findDataItem } from '../step-wording';
import {
  EMPTY_RULE,
  conditionExpression,
  describeCondition,
  needsValue,
  operatorLabel,
  operatorsFor,
  readCondition,
  type ConditionBuilderState,
  type ConditionOperator,
  type ConditionRule,
} from '../condition-rules';

export interface ConditionBuilderProps {
  config: Record<string, unknown>;
  /** What earlier steps make available; see `availableData`. */
  groups: DataGroup[];
  /** Receives the config keys to merge: `condition` and `conditionBuilder`. */
  onChange: (patch: { condition: string; conditionBuilder: ConditionBuilderState | null }) => void;
}

const selectClass =
  'w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink bg-surface focus:border-brand focus:outline-none';

/**
 * "Only continue if…": rules of field / comparison / value, with the typed
 * expression kept one click away for anything the rules can't say.
 */
export function ConditionBuilder({ config, groups, onChange }: ConditionBuilderProps) {
  const { mode, state, expression } = readCondition(config);
  const hasData = groups.some((g) => g.items.length > 0);

  const write = (next: ConditionBuilderState) =>
    onChange({ condition: conditionExpression(next), conditionBuilder: next });

  const setRule = (index: number, patch: Partial<ConditionRule>) =>
    write({ ...state, rules: state.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)) });

  const pickField = (index: number, field: string) => {
    const item = findDataItem(groups, field);
    const ops = operatorsFor(item?.type);
    const current = state.rules[index];
    setRule(index, {
      field,
      label: item?.label,
      type: item?.type,
      // A fresh rule starts with the comparison most used for that kind of field.
      op: current.field && ops.includes(current.op) ? current.op : ops[0],
      // A value typed for another kind of field rarely fits the new one.
      value: item?.type === current.type ? current.value : '',
    });
  };

  if (mode === 'typed') {
    return (
      <div className="space-y-2 pt-2 border-t border-border/40">
        <div className="flex items-center justify-between">
          <label htmlFor="condition-expression" className="text-[11px] font-medium text-ink">
            Continue only if this is true
          </label>
          <button
            type="button"
            data-testid="condition-use-builder-btn"
            onClick={() => onChange({ condition: '', conditionBuilder: { match: 'all', rules: [{ ...EMPTY_RULE }] } })}
            className="text-[11px] font-semibold text-ink hover:underline cursor-pointer"
          >
            Use the rule builder
          </button>
        </div>
        <input
          id="condition-expression"
          type="text"
          data-testid="condition-expression-input"
          value={expression}
          onChange={(e) => onChange({ condition: e.target.value, conditionBuilder: null })}
          placeholder="$trigger.payload.totalAmount > 10000"
          className="w-full rounded-lg border border-border px-3 py-2 text-xs font-mono text-ink focus:border-brand focus:outline-none"
        />
        <p className="text-[11px] text-ink-subtle">
          Written by hand. Switching to the rule builder starts the rules again.
        </p>
      </div>
    );
  }

  const summary = describeCondition(state);

  return (
    <div data-testid="condition-builder" className="space-y-3 pt-2 border-t border-border/40">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-ink">Continue only if</span>
        {state.rules.length > 1 && (
          <select
            data-testid="condition-match-select"
            aria-label="How the rules combine"
            value={state.match}
            onChange={(e) => write({ ...state, match: e.target.value === 'any' ? 'any' : 'all' })}
            className="rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-ink bg-surface"
          >
            <option value="all">all of these are true</option>
            <option value="any">any of these is true</option>
          </select>
        )}
      </div>

      {!hasData && (
        <p data-testid="condition-no-data" className="rounded-lg bg-surface-muted px-2.5 py-2 text-[11px] text-ink-muted">
          Choose what starts this automation first, so there is something to check.
        </p>
      )}

      {state.rules.map((rule, index) => {
        const item = findDataItem(groups, rule.field);
        const type = item?.type ?? rule.type;
        const options = item?.options;
        return (
          <div
            key={index}
            data-testid={`condition-rule-${index}`}
            className="space-y-1.5 rounded-lg border border-border bg-surface-muted/40 p-2"
          >
            <div className="flex items-center gap-1.5">
              <select
                data-testid={`condition-field-${index}`}
                aria-label="What to check"
                value={rule.field}
                onChange={(e) => pickField(index, e.target.value)}
                className={selectClass}
              >
                <option value="">Choose what to check…</option>
                {rule.field && !item && <option value={rule.field}>{rule.label || rule.field}</option>}
                {groups
                  .filter((g) => g.items.length > 0)
                  .map((group) => (
                    <optgroup key={group.id} label={`From: ${group.title}`}>
                      {group.items.map((i) => (
                        <option key={i.expression} value={i.expression}>
                          {i.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
              </select>
              {state.rules.length > 1 && (
                <button
                  type="button"
                  data-testid={`condition-remove-${index}`}
                  aria-label="Remove this rule"
                  onClick={() => write({ ...state, rules: state.rules.filter((_, i) => i !== index) })}
                  className="shrink-0 rounded-md p-1 text-ink-subtle hover:bg-danger-soft hover:text-danger cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <select
                data-testid={`condition-operator-${index}`}
                aria-label="How to compare"
                value={rule.op}
                onChange={(e) => setRule(index, { op: e.target.value as ConditionOperator })}
                className={selectClass}
              >
                {operatorsFor(type).map((op) => (
                  <option key={op} value={op}>
                    {operatorLabel(op, type)}
                  </option>
                ))}
              </select>
              {needsValue(rule.op) &&
                (options ? (
                  <select
                    data-testid={`condition-value-${index}`}
                    aria-label="Value"
                    value={rule.value}
                    onChange={(e) => setRule(index, { value: e.target.value })}
                    className={selectClass}
                  >
                    <option value="">Choose…</option>
                    {options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    data-testid={`condition-value-${index}`}
                    aria-label="Value"
                    type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
                    value={rule.value}
                    onChange={(e) => setRule(index, { value: e.target.value })}
                    placeholder={item?.sample !== undefined ? `e.g. ${item.sample}` : 'Value'}
                    className={selectClass}
                  />
                ))}
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-between">
        <button
          type="button"
          data-testid="condition-add-rule-btn"
          onClick={() => write({ ...state, rules: [...state.rules, { ...EMPTY_RULE }] })}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink hover:underline cursor-pointer"
        >
          <Plus className="h-3 w-3" /> Add another rule
        </button>
        <button
          type="button"
          data-testid="condition-write-yourself-btn"
          onClick={() => onChange({ condition: conditionExpression(state), conditionBuilder: null })}
          className="text-[11px] text-ink-muted hover:underline cursor-pointer"
        >
          Write it yourself
        </button>
      </div>

      <p data-testid="condition-summary" className="text-[11px] text-ink-muted">
        {summary ? (
          <>
            Takes the <span className="font-semibold text-success">Yes</span> path when {summary}; otherwise the{' '}
            <span className="font-semibold">No</span> path.
          </>
        ) : (
          'Until a rule is filled in, every run takes the No path.'
        )}
      </p>
    </div>
  );
}
