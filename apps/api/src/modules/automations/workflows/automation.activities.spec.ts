import {
  executeCodeTransformActivity,
  executeHttpActivity,
  recordNodeResultActivity,
} from './automation.activities';

describe('AutomationActivities', () => {
  describe('executeHttpActivity', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should execute GET request with query params', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: jest.fn().mockResolvedValue({ success: true, count: 5 }),
      } as any);

      const result = await executeHttpActivity({
        method: 'GET',
        url: 'https://api.example.com/items',
        query: { page: 1, filter: 'active' },
      });

      expect(result.status).toBe(200);
      expect(result.data).toEqual({ success: true, count: 5 });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/items?page=1&filter=active',
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('should execute POST request with JSON payload', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 201,
        statusText: 'Created',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: jest.fn().mockResolvedValue({ id: 'item-101' }),
      } as any);

      const result = await executeHttpActivity({
        method: 'POST',
        url: 'https://api.example.com/items',
        body: { name: 'Item Alpha', price: 99.9 },
      });

      expect(result.status).toBe(201);
      expect(result.data).toEqual({ id: 'item-101' });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Item Alpha', price: 99.9 }),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });
  });

  describe('executeCodeTransformActivity', () => {
    it('should transform input with JS expression', async () => {
      const result = await executeCodeTransformActivity({
        code: 'input.items.map(i => ({ ...i, total: i.price * i.qty }))',
        input: {
          items: [
            { id: 1, price: 10, qty: 2 },
            { id: 2, price: 5, qty: 3 },
          ],
        },
      });

      expect(result.output).toEqual([
        { id: 1, price: 10, qty: 2, total: 20 },
        { id: 2, price: 5, qty: 3, total: 15 },
      ]);
    });

    it('should support return statement in code transform', async () => {
      const result = await executeCodeTransformActivity({
        code: `
          const formatted = input.name.toUpperCase();
          return { name: formatted, processed: true };
        `,
        input: { name: 'john doe' },
      });

      expect(result.output).toEqual({ name: 'JOHN DOE', processed: true });
    });

    it('should throw clear error on invalid transform code', async () => {
      await expect(
        executeCodeTransformActivity({
          code: 'input.nonExistent.toUpperCase()',
          input: {},
        }),
      ).rejects.toThrow('Code transform execution failed');
    });

    it('should pass the context through and return plain JSON', async () => {
      const result = await executeCodeTransformActivity({
        code: 'return { id: context.$trigger.id, when: typeof Date.now() }',
        input: {},
        context: { $trigger: { id: 'q-1' } },
      });

      expect(result.output).toEqual({ id: 'q-1', when: 'number' });
    });

    it('should run without access to the host process', async () => {
      const result = await executeCodeTransformActivity({
        code: `return {
          process: typeof process,
          require: typeof require,
          escaped: (() => {
            try { return typeof input.constructor.constructor('return process')(); }
            catch (err) { return 'blocked'; }
          })(),
        }`,
        input: {},
      });

      expect(result.output).toEqual({
        process: 'undefined',
        require: 'undefined',
        // QuickJS has no `process` global, so the constructor trick throws.
        escaped: 'blocked',
      });
    });

    it('should stop code that never finishes', async () => {
      await expect(
        executeCodeTransformActivity({ code: 'while (true) {} return 1', input: {} }),
      ).rejects.toThrow('Code transform execution failed: interrupted');
    });

    it('should stop code that exhausts its memory allowance', async () => {
      await expect(
        executeCodeTransformActivity({
          code: 'const a = []; while (true) a.push("x".repeat(1e6) + a.length); return a',
          input: {},
        }),
      ).rejects.toThrow('Code transform execution failed');
    });
  });

  describe('recordNodeResultActivity', () => {
    it('should record node result status', async () => {
      const result = await recordNodeResultActivity({
        executionId: 'exec-123',
        nodeId: 'node-456',
        status: 'SUCCESS',
        output: { test: true },
      });

      expect(result.recorded).toBe(true);
      expect(result.executionId).toBe('exec-123');
      expect(result.nodeId).toBe('node-456');
    });
  });
});
