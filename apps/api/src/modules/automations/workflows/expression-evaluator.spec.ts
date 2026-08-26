import { evaluateExpression, interpolateObject, ExpressionContext } from './expression-evaluator';

describe('ExpressionEvaluator', () => {
  describe('evaluateExpression', () => {
    it('should evaluate basic $json property access', () => {
      const context: ExpressionContext = {
        $json: { name: 'Alice', age: 30 },
      };
      expect(evaluateExpression('$json.name', context)).toBe('Alice');
      expect(evaluateExpression('$json.age', context)).toBe(30);
    });

    it('should evaluate nested $json properties', () => {
      const context: ExpressionContext = {
        $json: {
          user: {
            profile: {
              email: 'alice@example.com',
            },
          },
        },
      };
      expect(evaluateExpression('$json.user.profile.email', context)).toBe('alice@example.com');
    });

    it('should evaluate $trigger property access', () => {
      const context: ExpressionContext = {
        $trigger: {
          event: 'lead.created',
          payload: {
            leadId: 'lead-123',
            amount: 5000,
          },
        },
      };
      expect(evaluateExpression('$trigger.event', context)).toBe('lead.created');
      expect(evaluateExpression('$trigger.payload.leadId', context)).toBe('lead-123');
      expect(evaluateExpression('$trigger.payload.amount', context)).toBe(5000);
    });

    it('should evaluate $node property access with bracket notation and node names', () => {
      const context: ExpressionContext = {
        $node: {
          'Fetch User': {
            json: { id: 'usr-99', name: 'Bob' },
            output: { id: 'usr-99', name: 'Bob' },
          },
          'HTTP Request': {
            json: { status: 200, data: { token: 'xyz' } },
            output: { status: 200, data: { token: 'xyz' } },
          },
        },
      };
      expect(evaluateExpression('$node["Fetch User"].json.id', context)).toBe('usr-99');
      expect(evaluateExpression("$node['Fetch User'].output.name", context)).toBe('Bob');
      expect(evaluateExpression('$node["HTTP Request"].json.data.token', context)).toBe('xyz');
    });

    it('should evaluate $node property access with dot notation', () => {
      const context: ExpressionContext = {
        $node: {
          node1: {
            json: { result: 'success' },
          },
        },
      };
      expect(evaluateExpression('$node.node1.json.result', context)).toBe('success');
    });

    it('should evaluate expressions enclosed in {{ }} braces', () => {
      const context: ExpressionContext = {
        $json: { title: 'Engineer' },
      };
      expect(evaluateExpression('{{ $json.title }}', context)).toBe('Engineer');
      expect(evaluateExpression('{{$json.title}}', context)).toBe('Engineer');
    });

    it('should evaluate comparison and logical expressions', () => {
      const context: ExpressionContext = {
        $trigger: { amount: 1500, status: 'OPEN' },
        $json: { score: 85 },
      };
      expect(evaluateExpression('$trigger.amount > 1000', context)).toBe(true);
      expect(evaluateExpression('$trigger.amount < 1000', context)).toBe(false);
      expect(evaluateExpression('$trigger.status === "OPEN"', context)).toBe(true);
      expect(evaluateExpression('$json.score >= 50 ? "PASS" : "FAIL"', context)).toBe('PASS');
    });

    it('should safely return undefined or handle missing paths gracefully without throwing', () => {
      const context: ExpressionContext = {
        $json: {},
      };
      expect(evaluateExpression('$json.nonExistent.field', context)).toBeUndefined();
      expect(evaluateExpression('$node["Unknown Node"].json.id', context)).toBeUndefined();
    });

    it('should handle $env context variables if provided', () => {
      const context: ExpressionContext = {
        $env: { API_BASE: 'https://api.crm.com' },
      };
      expect(evaluateExpression('$env.API_BASE', context)).toBe('https://api.crm.com');
    });
  });

  describe('interpolateObject', () => {
    it('should preserve primitive types for single token expression strings', () => {
      const context: ExpressionContext = {
        $json: {
          count: 42,
          isActive: true,
          details: { nested: 'value' },
          items: ['a', 'b', 'c'],
        },
      };

      expect(interpolateObject('{{ $json.count }}', context)).toBe(42);
      expect(interpolateObject('{{ $json.isActive }}', context)).toBe(true);
      expect(interpolateObject('{{ $json.details }}', context)).toEqual({ nested: 'value' });
      expect(interpolateObject('{{ $json.items }}', context)).toEqual(['a', 'b', 'c']);
    });

    it('should interpolate template strings with multiple tokens and surrounding text', () => {
      const context: ExpressionContext = {
        $trigger: { customer: 'Acme Corp', orderId: 'ORD-900' },
        $json: { total: '$450' },
      };

      const template = 'Notification: Order {{ $trigger.orderId }} for {{ $trigger.customer }} with total {{ $json.total }}.';
      const expected = 'Notification: Order ORD-900 for Acme Corp with total $450.';
      expect(interpolateObject(template, context)).toBe(expected);
    });

    it('should recursively interpolate deeply nested objects and arrays', () => {
      const context: ExpressionContext = {
        $trigger: { webhookId: 'wh-1' },
        $json: { name: 'Lead 1', tag: 'VIP' },
        $env: { SECRET_KEY: 'secret123' },
      };

      const input = {
        url: 'https://example.com/api/v1/leads/{{ $trigger.webhookId }}',
        headers: {
          Authorization: 'Bearer {{ $env.SECRET_KEY }}',
          'X-Custom': 'STATIC',
        },
        payload: {
          leadName: '{{ $json.name }}',
          tags: ['{{ $json.tag }}', 'CRM'],
          metadata: {
            source: 'webhook-{{ $trigger.webhookId }}',
          },
        },
        count: 10,
        enabled: true,
        empty: null,
      };

      const result = interpolateObject(input, context);

      expect(result).toEqual({
        url: 'https://example.com/api/v1/leads/wh-1',
        headers: {
          Authorization: 'Bearer secret123',
          'X-Custom': 'STATIC',
        },
        payload: {
          leadName: 'Lead 1',
          tags: ['VIP', 'CRM'],
          metadata: {
            source: 'webhook-wh-1',
          },
        },
        count: 10,
        enabled: true,
        empty: null,
      });
    });

    it('should handle primitives and falsy values without modification', () => {
      const context: ExpressionContext = { $json: {} };

      expect(interpolateObject(123, context)).toBe(123);
      expect(interpolateObject(true, context)).toBe(true);
      expect(interpolateObject(false, context)).toBe(false);
      expect(interpolateObject(null, context)).toBeNull();
      expect(interpolateObject(undefined, context)).toBeUndefined();
    });

    it('should replace undefined expression values with empty string in template strings', () => {
      const context: ExpressionContext = { $json: {} };
      const template = 'Hello {{ $json.missing }} World';
      expect(interpolateObject(template, context)).toBe('Hello  World');
    });
  });
});
