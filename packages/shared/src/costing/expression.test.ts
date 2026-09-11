import { describe, it, expect } from 'vitest';
import {
  ExpressionError,
  collectVariables,
  compileExpression,
  evaluate,
  evaluateBoolean,
  evaluateNumber,
} from './expression';

const evalNum = (src: string, scope: Record<string, number | boolean | string> = {}) =>
  evaluateNumber(src, scope);

describe('expression language', () => {
  it('applies standard arithmetic precedence and associativity', () => {
    expect(evalNum('2 + 3 * 4')).toBe(14);
    expect(evalNum('(2 + 3) * 4')).toBe(20);
    expect(evalNum('20 / 4 / 5')).toBe(1);
    expect(evalNum('2 ^ 3 ^ 2')).toBe(512); // right associative
    expect(evalNum('10 % 3')).toBe(1);
  });

  it('reads variables from the scope', () => {
    expect(evalNum('width_mm + 2 * height_mm', { width_mm: 150, height_mm: 80 })).toBe(310);
  });

  it('supports conditionals and string comparison for enum parameters', () => {
    expect(evalNum("finish != 'none' ? 5 : 0", { finish: 'matt' })).toBe(5);
    expect(evalNum("finish != 'none' ? 5 : 0", { finish: 'none' })).toBe(0);
    expect(evalNum('magnet ? 2 : 0', { magnet: true })).toBe(2);
  });

  it('short-circuits boolean operators', () => {
    // The right side would throw on an unknown variable if it were evaluated.
    expect(evaluateBoolean('false && missing_var', {})).toBe(false);
    expect(evaluateBoolean('true || missing_var', {})).toBe(true);
  });

  it('exposes the math builtins', () => {
    expect(evalNum('ceil(4.1)')).toBe(5);
    expect(evalNum('floor(4.9)')).toBe(4);
    expect(evalNum('round(3.14159, 2)')).toBe(3.14);
    expect(evalNum('max(25, 18)')).toBe(25);
    expect(evalNum('clamp(120, 0, 100)')).toBe(100);
  });

  // The whole reason this is not the automations evaluator: a costing typo
  // must be loud. `undefined` silently becoming zero is the failure mode that
  // quotes a job at cost.
  describe('fails loudly rather than returning undefined', () => {
    it('rejects an unknown variable', () => {
      expect(() => evalNum('widht_mm * 2', { width_mm: 150 })).toThrow(/Unknown variable/);
    });

    it('rejects an unknown function', () => {
      expect(() => evalNum('nope(1)')).toThrow(/Unknown function/);
    });

    it('rejects a wrong argument count', () => {
      expect(() => evalNum('ceil(1, 2)')).toThrow(/expects 1 argument/);
    });

    it('rejects division by zero instead of yielding Infinity', () => {
      expect(() => evalNum('10 / 0')).toThrow(/Division by zero/);
    });

    it('rejects mixing a string into arithmetic', () => {
      expect(() => evalNum('finish * 2', { finish: 'matt' })).toThrow(/needs numbers/);
    });

    it('points at a lone `=` as a comparison typo', () => {
      expect(() => evalNum('a = 2', { a: 1 })).toThrow(/Use `==` to compare/);
    });

    it('reports the position of a syntax error', () => {
      try {
        compileExpression('2 + * 3');
        throw new Error('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ExpressionError);
        expect((error as ExpressionError).position).toBe(4);
      }
    });
  });

  describe('sandbox', () => {
    it('has no property access', () => {
      expect(() => compileExpression('constructor.constructor')).toThrow();
      expect(() => compileExpression('a.b')).toThrow();
    });

    it('cannot reach globals', () => {
      expect(() => evalNum('Math.max(1, 2)')).toThrow();
      expect(() => evalNum('process')).toThrow(/Unknown variable/);
    });

    it('cannot assign', () => {
      expect(() => compileExpression('x = 5')).toThrow(/assignment is not allowed/);
    });

    it('caps expression size, so evaluation is bounded without a timeout', () => {
      const huge = Array.from({ length: 400 }, () => '1').join(' + ');
      expect(() => compileExpression(huge)).toThrow(/too complex/);
    });

    it('caps nesting depth', () => {
      const deep = '('.repeat(40) + '1' + ')'.repeat(40);
      expect(() => compileExpression(deep)).toThrow(/nests too deeply/);
    });
  });

  it('is deterministic — the same inputs always give the same result', () => {
    const scope = { width_mm: 150, height_mm: 80 };
    const first = evalNum('width_mm * height_mm', scope);
    const second = evalNum('width_mm * height_mm', scope);
    expect(first).toBe(second);
  });

  it('lists the variables a formula depends on', () => {
    const { ast } = compileExpression('width_mm + 2 * height_mm + ceil(turn_in_mm / 2)');
    expect([...collectVariables(ast)].sort()).toEqual(['height_mm', 'turn_in_mm', 'width_mm']);
  });

  it('treats true/false as keywords a scope cannot shadow', () => {
    expect(evaluate(compileExpression('true'), { true: false })).toBe(true);
  });
});
