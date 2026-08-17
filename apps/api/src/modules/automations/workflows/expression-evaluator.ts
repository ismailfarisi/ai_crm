export interface ExpressionContext {
  $json?: Record<string, any>;
  $trigger?: Record<string, any>;
  $node?: Record<string, { json?: Record<string, any>; data?: Record<string, any>; output?: any; [key: string]: any }>;
  $env?: Record<string, any>;
  [key: string]: any;
}

/**
 * Evaluates a single dynamic expression against an execution context.
 * Supports $json, $trigger, $node, $env, and standard JS operations.
 * Safely returns undefined on missing paths or syntax/eval errors.
 */
export function evaluateExpression(expression: string, context: ExpressionContext = {}): any {
  if (typeof expression !== 'string') {
    return expression;
  }

  let cleaned = expression.trim();

  // Strip wrapping {{ ... }} if present
  const wrapperMatch = cleaned.match(/^\{\{\s*(.+?)\s*\}\}$/s);
  if (wrapperMatch) {
    cleaned = wrapperMatch[1].trim();
  }

  if (!cleaned) {
    return undefined;
  }

  try {
    const $json = context.$json ?? {};
    const $trigger = context.$trigger ?? {};
    const $node = context.$node ?? {};
    const $env = context.$env ?? {};

    // Use Function constructor for safe context evaluation
    const evaluator = new Function(
      '$json',
      '$trigger',
      '$node',
      '$env',
      'context',
      `"use strict";
       try {
         return (${cleaned});
       } catch (err) {
         return undefined;
       }`
    );

    return evaluator($json, $trigger, $node, $env, context);
  } catch {
    return undefined;
  }
}

/**
 * Recursively interpolates dynamic expressions ({{ ... }}) within a value or nested data structure.
 * Preserves data types (numbers, booleans, objects, arrays) for single-token expressions.
 */
export function interpolateObject<T = any>(obj: T, context: ExpressionContext = {}): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    const singleExpressionRegex = /^\s*\{\{\s*(.+?)\s*\}\}\s*$/s;
    const singleMatch = obj.match(singleExpressionRegex);

    if (singleMatch) {
      const expr = singleMatch[1].trim();
      return evaluateExpression(expr, context);
    }

    // Multiple tokens or inline string template
    const templateRegex = /\{\{\s*(.+?)\s*\}\}/g;
    if (templateRegex.test(obj)) {
      return obj.replace(templateRegex, (_match, expr) => {
        const val = evaluateExpression(expr.trim(), context);
        if (val === null || val === undefined) {
          return '';
        }
        if (typeof val === 'object') {
          return JSON.stringify(val);
        }
        return String(val);
      }) as unknown as T;
    }

    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateObject(item, context)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateObject(value, context);
    }
    return result as unknown as T;
  }

  return obj;
}
