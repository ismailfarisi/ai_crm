import {
  executeAiPromptActivity,
  executeCodeTransformActivity,
  executeCrmMutationActivity,
  executeEmailActivity,
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

  describe('executeAiPromptActivity', () => {
    it('should return mock response if provided', async () => {
      const result = await executeAiPromptActivity({
        prompt: 'Summarize customer feedback',
        mockResponse: 'Customer is highly satisfied.',
      });

      expect(result.text).toBe('Customer is highly satisfied.');
      expect(result.completion).toBe('Customer is highly satisfied.');
      expect(result.usage).toBeDefined();
    });

    it('should generate simulated AI response if mockResponse not provided', async () => {
      const result = await executeAiPromptActivity({
        prompt: 'Draft email to lead',
        model: 'gpt-4o',
      });

      expect(result.text).toContain('AI response for prompt');
      expect(result.usage?.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('executeEmailActivity', () => {
    it('should log and return success with messageId and timestamp', async () => {
      const result = await executeEmailActivity({
        to: 'customer@example.com',
        subject: 'Your Quote is Ready',
        body: 'Please review your quote at ...',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^email_/);
      expect(result.to).toBe('customer@example.com');
      expect(result.sentAt).toBeDefined();
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
  });

  describe('executeCrmMutationActivity', () => {
    it('should record CRM mutation and return metadata', async () => {
      const result = await executeCrmMutationActivity({
        entity: 'contact',
        action: 'create',
        data: { name: 'Sarah Connor', email: 'sarah@example.com' },
      });

      expect(result.success).toBe(true);
      expect(result.entity).toBe('contact');
      expect(result.action).toBe('create');
      expect(result.recordId).toMatch(/^contact_/);
      expect(result.data).toEqual({ name: 'Sarah Connor', email: 'sarah@example.com' });
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
