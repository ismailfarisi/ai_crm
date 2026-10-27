import jsep from 'jsep';

export interface ExpressionContext {
  $json?: Record<string, any>;
  $trigger?: Record<string, any>;
  $node?: Record<
    string,
    {
      json?: Record<string, any>;
      data?: Record<string, any>;
      output?: any;
      [key: string]: any;
    }
  >;
  $env?: Record<string, any>;
  [key: string]: any;
}

/** Thrown for any syntax the evaluator refuses; `evaluateExpression` turns it into `undefined`. */
class UnsupportedExpressionError extends Error {}

/**
 * Reads a property the way a template author means it: own data only. Nothing
 * on a prototype is reachable, so `constructor`, `__proto__` and methods all
 * read as undefined. `length` is the one inherited property allowed.
 */
function readProperty(target: unknown, key: unknown): unknown {
  if (target === null || target === undefined) return undefined;
  if (typeof key !== 'string' && typeof key !== 'number') return undefined;
  if (key === 'length' && (typeof target === 'string' || Array.isArray(target))) {
    return target.length;
  }
  if (typeof target !== 'object') return undefined;
  return Object.prototype.hasOwnProperty.call(target, key)
    ? (target as Record<string | number, unknown>)[key]
    : undefined;
}

function evaluateNode(node: jsep.Expression, scope: Record<string, unknown>): unknown {
  switch (node.type) {
    case 'Literal':
      return (node as jsep.Literal).value;

    case 'Identifier': {
      const { name } = node as jsep.Identifier;
      if (name === 'undefined') return undefined;
      if (Object.prototype.hasOwnProperty.call(scope, name)) return scope[name];
      throw new UnsupportedExpressionError(`Unknown identifier ${name}`);
    }

    case 'MemberExpression': {
      const member = node as jsep.MemberExpression;
      const target = evaluateNode(member.object, scope);
      const key = member.computed
        ? evaluateNode(member.property, scope)
        : (member.property as jsep.Identifier).name;
      return readProperty(target, key);
    }

    case 'ArrayExpression':
      return (node as jsep.ArrayExpression).elements.map((element) =>
        element ? evaluateNode(element, scope) : undefined,
      );

    case 'UnaryExpression': {
      const unary = node as jsep.UnaryExpression;
      const arg = evaluateNode(unary.argument, scope) as any;
      switch (unary.operator) {
        case '!': return !arg;
        case '-': return -arg;
        case '+': return +arg;
      }
      break;
    }

    case 'ConditionalExpression': {
      const cond = node as jsep.ConditionalExpression;
      return evaluateNode(cond.test, scope)
        ? evaluateNode(cond.consequent, scope)
        : evaluateNode(cond.alternate, scope);
    }

    case 'BinaryExpression': {
      const binary = node as jsep.BinaryExpression;
      const left = evaluateNode(binary.left, scope) as any;
      // Short-circuit the logical operators before touching the right side.
      if (binary.operator === '&&') return left && evaluateNode(binary.right, scope);
      if (binary.operator === '||') return left || evaluateNode(binary.right, scope);
      if (binary.operator === '??') return left ?? evaluateNode(binary.right, scope);
      const right = evaluateNode(binary.right, scope) as any;
      switch (binary.operator) {
        case '===': return left === right;
        case '!==': return left !== right;
        case '==': return left == right;
        case '!=': return left != right;
        case '<': return left < right;
        case '<=': return left <= right;
        case '>': return left > right;
        case '>=': return left >= right;
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return left / right;
        case '%': return left % right;
      }
      break;
    }
  }
  throw new UnsupportedExpressionError(`Unsupported expression: ${node.type}`);
}

/**
 * Evaluates a single dynamic expression against an execution context.
 *
 * Expressions are parsed, never compiled: the grammar is paths into `$json`,
 * `$trigger`, `$node` and `$env`, literals, arithmetic, comparisons, `&&`
 * `||` `??`, `!` and the ternary. There are no function calls and no access
 * to globals, so a template cannot reach the worker process. Anything outside
 * that, and any missing path, evaluates to undefined.
 */
export function evaluateExpression(
  expression: string,
  context: ExpressionContext = {},
): any {
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
    return evaluateNode(jsep(cleaned), {
      $json: context.$json ?? {},
      $trigger: context.$trigger ?? {},
      $node: context.$node ?? {},
      $env: context.$env ?? {},
    });
  } catch {
    return undefined;
  }
}

/**
 * Recursively interpolates dynamic expressions ({{ ... }}) within a value or nested data structure.
 * Preserves data types (numbers, booleans, objects, arrays) for single-token expressions.
 */
export function interpolateObject<T = any>(
  obj: T,
  context: ExpressionContext = {},
): T {
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
