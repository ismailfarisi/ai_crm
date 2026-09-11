/**
 * A deliberately small, pure expression language for tenant-authored costing
 * formulas.
 *
 * This is NOT the automations evaluator
 * (`apps/api/src/modules/automations/workflows/expression-evaluator.ts`).
 * That one compiles to `new Function` and swallows every failure into
 * `undefined` — fine for templating an automation payload, catastrophic for
 * pricing, where a typo would silently cost zero. Here an unknown identifier,
 * a bad argument count or a type mismatch throws.
 *
 * Guarantees:
 *  - no property access, no assignment, no loops, no I/O, no access to globals
 *  - deterministic: nothing reads the clock or a random source
 *  - bounded: the grammar has no loops or recursion, so an AST that passes the
 *    node cap cannot run long. There is nothing to time out.
 */

/** Parse-time caps. An AST under these limits is cheap to evaluate. */
const MAX_NODES = 500;
const MAX_DEPTH = 32;

export type ExprValue = number | boolean | string;

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%' | '^'
  | '<' | '<=' | '>' | '>='
  | '==' | '!='
  | '&&' | '||';

export type ExprNode =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'var'; name: string; pos: number }
  | { kind: 'unary'; op: '-' | '!'; arg: ExprNode; pos: number }
  | { kind: 'binary'; op: BinaryOp; left: ExprNode; right: ExprNode; pos: number }
  | { kind: 'ternary'; test: ExprNode; then: ExprNode; otherwise: ExprNode }
  | { kind: 'call'; name: string; args: ExprNode[]; pos: number };

export class ExpressionError extends Error {
  readonly expression?: string;
  readonly position?: number;

  constructor(message: string, expression?: string, position?: number) {
    super(position === undefined ? message : `${message} (at position ${position})`);
    this.name = 'ExpressionError';
    this.expression = expression;
    this.position = position;
  }
}

/* ------------------------------------------------------------------ *
 * Tokenizer
 * ------------------------------------------------------------------ */

interface Token {
  type: 'num' | 'str' | 'ident' | 'op' | 'eof';
  value: string;
  pos: number;
}

const TWO_CHAR_OPS = ['<=', '>=', '==', '!=', '&&', '||'];
const ONE_CHAR_OPS = ['+', '-', '*', '/', '%', '^', '(', ')', ',', '<', '>', '?', ':', '!'];

const DIGIT = /[0-9]/;
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && DIGIT.test(src[j])) j++;
      if (src[j] === '.') {
        j++;
        while (j < src.length && DIGIT.test(src[j])) j++;
      }
      tokens.push({ type: 'num', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }

    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== ch) {
        out += src[j];
        j++;
      }
      if (j >= src.length) {
        throw new ExpressionError('Unterminated string literal', src, i);
      }
      tokens.push({ type: 'str', value: out, pos: i });
      i = j + 1;
      continue;
    }

    if (IDENT_START.test(ch)) {
      let j = i;
      while (j < src.length && IDENT_PART.test(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      tokens.push({ type: 'op', value: two, pos: i });
      i += 2;
      continue;
    }

    if (ONE_CHAR_OPS.includes(ch)) {
      tokens.push({ type: 'op', value: ch, pos: i });
      i++;
      continue;
    }

    // A lone `=` is the most likely typo, so name it rather than saying
    // "unexpected character".
    if (ch === '=') {
      throw new ExpressionError('Use `==` to compare; assignment is not allowed', src, i);
    }

    throw new ExpressionError(`Unexpected character ${JSON.stringify(ch)}`, src, i);
  }

  tokens.push({ type: 'eof', value: '', pos: src.length });
  return tokens;
}

/* ------------------------------------------------------------------ *
 * Parser (precedence climbing)
 * ------------------------------------------------------------------ */

const BINARY_PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
  '^': 7,
};

const RIGHT_ASSOCIATIVE = new Set(['^']);

class Parser {
  private index = 0;
  private nodeCount = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly src: string,
  ) {}

  parse(): ExprNode {
    if (this.peek().type === 'eof') {
      throw new ExpressionError('Empty expression', this.src, 0);
    }
    const node = this.parseTernary(0);
    const trailing = this.peek();
    if (trailing.type !== 'eof') {
      throw new ExpressionError(
        `Unexpected ${JSON.stringify(trailing.value)}`,
        this.src,
        trailing.pos,
      );
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    return this.tokens[this.index++];
  }

  private track<T extends ExprNode>(node: T): T {
    if (++this.nodeCount > MAX_NODES) {
      throw new ExpressionError(`Expression is too complex (over ${MAX_NODES} nodes)`, this.src);
    }
    return node;
  }

  private guardDepth(depth: number, pos: number): void {
    if (depth > MAX_DEPTH) {
      throw new ExpressionError(
        `Expression nests too deeply (over ${MAX_DEPTH} levels)`,
        this.src,
        pos,
      );
    }
  }

  private parseTernary(depth: number): ExprNode {
    const test = this.parseBinary(0, depth);
    const token = this.peek();
    if (token.type === 'op' && token.value === '?') {
      this.next();
      const then = this.parseTernary(depth + 1);
      const colon = this.next();
      if (colon.type !== 'op' || colon.value !== ':') {
        throw new ExpressionError('Expected `:` in conditional', this.src, colon.pos);
      }
      const otherwise = this.parseTernary(depth + 1);
      return this.track({ kind: 'ternary', test, then, otherwise });
    }
    return test;
  }

  private parseBinary(minPrecedence: number, depth: number): ExprNode {
    let left = this.parseUnary(depth);

    for (;;) {
      const token = this.peek();
      if (token.type !== 'op') break;
      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;

      this.next();
      const nextMinimum = RIGHT_ASSOCIATIVE.has(token.value) ? precedence : precedence + 1;
      const right = this.parseBinary(nextMinimum, depth + 1);
      left = this.track({
        kind: 'binary',
        op: token.value as BinaryOp,
        left,
        right,
        pos: token.pos,
      });
    }

    return left;
  }

  private parseUnary(depth: number): ExprNode {
    const token = this.peek();
    if (token.type === 'op' && (token.value === '-' || token.value === '!')) {
      this.next();
      this.guardDepth(depth, token.pos);
      return this.track({
        kind: 'unary',
        op: token.value as '-' | '!',
        arg: this.parseUnary(depth + 1),
        pos: token.pos,
      });
    }
    return this.parsePrimary(depth);
  }

  private parsePrimary(depth: number): ExprNode {
    const token = this.next();
    this.guardDepth(depth, token.pos);

    if (token.type === 'num') {
      const value = Number(token.value);
      if (!Number.isFinite(value)) {
        throw new ExpressionError(`Invalid number ${token.value}`, this.src, token.pos);
      }
      return this.track({ kind: 'num', value });
    }

    if (token.type === 'str') {
      return this.track({ kind: 'str', value: token.value });
    }

    if (token.type === 'ident') {
      const ahead = this.peek();
      if (ahead.type === 'op' && ahead.value === '(') {
        this.next();
        const args: ExprNode[] = [];
        if (!(this.peek().type === 'op' && this.peek().value === ')')) {
          for (;;) {
            args.push(this.parseTernary(depth + 1));
            const separator = this.peek();
            if (separator.type === 'op' && separator.value === ',') {
              this.next();
              continue;
            }
            break;
          }
        }
        const close = this.next();
        if (close.type !== 'op' || close.value !== ')') {
          throw new ExpressionError(
            `Expected ")" to close ${token.value}(`,
            this.src,
            close.pos,
          );
        }
        return this.track({ kind: 'call', name: token.value, args, pos: token.pos });
      }
      return this.track({ kind: 'var', name: token.value, pos: token.pos });
    }

    if (token.type === 'op' && token.value === '(') {
      const inner = this.parseTernary(depth + 1);
      const close = this.next();
      if (close.type !== 'op' || close.value !== ')') {
        throw new ExpressionError('Expected ")"', this.src, close.pos);
      }
      return inner;
    }

    throw new ExpressionError(
      token.type === 'eof'
        ? 'Unexpected end of expression'
        : `Unexpected ${JSON.stringify(token.value)}`,
      this.src,
      token.pos,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Compilation
 * ------------------------------------------------------------------ */

export interface CompiledExpression {
  readonly source: string;
  readonly ast: ExprNode;
}

const compileCache = new Map<string, CompiledExpression>();

/** Parses `source` into a reusable AST. Throws `ExpressionError` on bad syntax. */
export function compileExpression(source: string): CompiledExpression {
  const cached = compileCache.get(source);
  if (cached) return cached;

  const compiled: CompiledExpression = {
    source,
    ast: new Parser(tokenize(source), source).parse(),
  };
  compileCache.set(source, compiled);
  return compiled;
}

/** Every identifier the expression reads — lets the UI show which inputs a formula needs. */
export function collectVariables(node: ExprNode, into = new Set<string>()): Set<string> {
  switch (node.kind) {
    case 'var':
      into.add(node.name);
      break;
    case 'unary':
      collectVariables(node.arg, into);
      break;
    case 'binary':
      collectVariables(node.left, into);
      collectVariables(node.right, into);
      break;
    case 'ternary':
      collectVariables(node.test, into);
      collectVariables(node.then, into);
      collectVariables(node.otherwise, into);
      break;
    case 'call':
      for (const arg of node.args) collectVariables(arg, into);
      break;
    default:
      break;
  }
  return into;
}

/* ------------------------------------------------------------------ *
 * Built-in functions
 * ------------------------------------------------------------------ */

export type BuiltinFunction = (args: ExprValue[], fail: (message: string) => never) => ExprValue;

function numeric(args: ExprValue[], fail: (message: string) => never, name: string): number[] {
  return args.map((arg, index) => {
    if (typeof arg !== 'number') {
      fail(`${name}() expects numbers; argument ${index + 1} is ${typeof arg}`);
    }
    return arg as number;
  });
}

function arity(
  args: ExprValue[],
  fail: (message: string) => never,
  name: string,
  min: number,
  max = min,
): void {
  if (args.length < min || args.length > max) {
    const expected = min === max ? `${min}` : `${min}-${max}`;
    fail(`${name}() expects ${expected} argument(s), got ${args.length}`);
  }
}

export const MATH_BUILTINS: Record<string, BuiltinFunction> = {
  ceil: (args, fail) => {
    arity(args, fail, 'ceil', 1);
    return Math.ceil(numeric(args, fail, 'ceil')[0]);
  },
  floor: (args, fail) => {
    arity(args, fail, 'floor', 1);
    return Math.floor(numeric(args, fail, 'floor')[0]);
  },
  abs: (args, fail) => {
    arity(args, fail, 'abs', 1);
    return Math.abs(numeric(args, fail, 'abs')[0]);
  },
  sqrt: (args, fail) => {
    arity(args, fail, 'sqrt', 1);
    const [value] = numeric(args, fail, 'sqrt');
    if (value < 0) fail('sqrt() of a negative number');
    return Math.sqrt(value);
  },
  round: (args, fail) => {
    arity(args, fail, 'round', 1, 2);
    const values = numeric(args, fail, 'round');
    const places = values.length > 1 ? Math.trunc(values[1]) : 0;
    const factor = Math.pow(10, places);
    return Math.round(values[0] * factor) / factor;
  },
  min: (args, fail) => {
    arity(args, fail, 'min', 1, Number.MAX_SAFE_INTEGER);
    return Math.min(...numeric(args, fail, 'min'));
  },
  max: (args, fail) => {
    arity(args, fail, 'max', 1, Number.MAX_SAFE_INTEGER);
    return Math.max(...numeric(args, fail, 'max'));
  },
  clamp: (args, fail) => {
    arity(args, fail, 'clamp', 3);
    const [value, low, high] = numeric(args, fail, 'clamp');
    return Math.min(high, Math.max(low, value));
  },
};

/* ------------------------------------------------------------------ *
 * Evaluation
 * ------------------------------------------------------------------ */

export type EvalScope = Readonly<Record<string, ExprValue | undefined>>;

export interface EvaluateOptions {
  /** Domain helpers layered over `MATH_BUILTINS` (the costing engine adds `nestPerSheet`). */
  functions?: Record<string, BuiltinFunction>;
}

export function evaluate(
  compiled: CompiledExpression,
  scope: EvalScope,
  options: EvaluateOptions = {},
): ExprValue {
  const functions = options.functions ? { ...MATH_BUILTINS, ...options.functions } : MATH_BUILTINS;

  const fail = (message: string, position?: number): never => {
    throw new ExpressionError(message, compiled.source, position);
  };

  const asNumber = (value: ExprValue, op: string, position: number): number => {
    if (typeof value !== 'number') {
      fail(`Operator "${op}" needs numbers, got ${typeof value}`, position);
    }
    return value as number;
  };

  const walk = (node: ExprNode): ExprValue => {
    switch (node.kind) {
      case 'num':
        return node.value;

      case 'str':
        return node.value;

      case 'var': {
        // `true`/`false` are resolved here rather than tokenized as keywords,
        // so a scope can never shadow them.
        if (node.name === 'true') return true;
        if (node.name === 'false') return false;
        if (!(node.name in scope) || scope[node.name] === undefined) {
          fail(`Unknown variable "${node.name}"`, node.pos);
        }
        return scope[node.name] as ExprValue;
      }

      case 'unary': {
        const value = walk(node.arg);
        if (node.op === '-') return -asNumber(value, '-', node.pos);
        if (typeof value !== 'boolean') {
          fail(`Operator "!" needs a boolean, got ${typeof value}`, node.pos);
        }
        return !(value as boolean);
      }

      case 'ternary': {
        const test = walk(node.test);
        if (typeof test !== 'boolean') {
          fail(`Condition of "?:" must be a boolean, got ${typeof test}`);
        }
        return test ? walk(node.then) : walk(node.otherwise);
      }

      case 'call': {
        const fn = functions[node.name];
        if (!fn) fail(`Unknown function "${node.name}"`, node.pos);
        const args = node.args.map(walk);
        const result = fn(args, (message) => fail(message, node.pos));
        if (typeof result === 'number' && !Number.isFinite(result)) {
          fail(`"${node.name}()" produced a non-finite result`, node.pos);
        }
        return result;
      }

      case 'binary': {
        // Short-circuit before evaluating the right side.
        if (node.op === '&&' || node.op === '||') {
          const left = walk(node.left);
          if (typeof left !== 'boolean') {
            fail(`Operator "${node.op}" needs booleans, got ${typeof left}`, node.pos);
          }
          if (node.op === '&&' && !left) return false;
          if (node.op === '||' && left) return true;
          const right = walk(node.right);
          if (typeof right !== 'boolean') {
            fail(`Operator "${node.op}" needs booleans, got ${typeof right}`, node.pos);
          }
          return right;
        }

        const left = walk(node.left);
        const right = walk(node.right);

        if (node.op === '==') return left === right;
        if (node.op === '!=') return left !== right;

        const a = asNumber(left, node.op, node.pos);
        const b = asNumber(right, node.op, node.pos);

        switch (node.op) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            if (b === 0) fail('Division by zero', node.pos);
            return a / b;
          case '%':
            if (b === 0) fail('Modulo by zero', node.pos);
            return a % b;
          case '^': {
            const power = Math.pow(a, b);
            if (!Number.isFinite(power)) fail('Exponent produced a non-finite result', node.pos);
            return power;
          }
          case '<':
            return a < b;
          case '<=':
            return a <= b;
          case '>':
            return a > b;
          case '>=':
            return a >= b;
          default:
            return fail(`Unsupported operator "${node.op as string}"`, node.pos);
        }
      }

      default:
        return fail('Unsupported expression node');
    }
  };

  return walk(compiled.ast);
}

/** Compile + evaluate in one step, insisting the result is a finite number. */
export function evaluateNumber(
  source: string,
  scope: EvalScope,
  options: EvaluateOptions = {},
): number {
  const value = evaluate(compileExpression(source), scope, options);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ExpressionError(
      `Expected a number, got ${typeof value === 'number' ? value : typeof value}`,
      source,
    );
  }
  return value;
}

/** Compile + evaluate in one step, insisting the result is a boolean. */
export function evaluateBoolean(
  source: string,
  scope: EvalScope,
  options: EvaluateOptions = {},
): boolean {
  const value = evaluate(compileExpression(source), scope, options);
  if (typeof value !== 'boolean') {
    throw new ExpressionError(`Expected a boolean, got ${typeof value}`, source);
  }
  return value;
}
