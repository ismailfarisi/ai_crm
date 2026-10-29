import { APIError } from '@anthropic-ai/sdk';
import { AnthropicProvider } from './anthropic.provider';
import { AiProviderError } from '../interfaces/ai-provider.interface';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {}
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    APIError: MockAPIError,
  };
});

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new AnthropicProvider({
      apiKey: 'test-key',
      defaultModel: 'claude-sonnet-5',
    });
  });

  describe('generateText', () => {
    it('sends the expected request shape and extracts text + usage', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello there' }],
        usage: { input_tokens: 12, output_tokens: 8 },
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
      });

      const result = await provider.generateText({
        system: 'Be terse.',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result).toEqual({
        text: 'Hello there',
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        model: 'claude-sonnet-5',
        stopReason: 'end_turn',
      });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-5',
          system: 'Be terse.',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      );
    });

    it('maps image content blocks (base64 and url) correctly', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
      });

      await provider.generateText({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', mimeType: 'image/png', data: 'BASE64DATA' },
              { type: 'text', text: 'describe this' },
            ],
          },
        ],
      });

      const sentMessages = mockCreate.mock.calls[0][0].messages;
      expect(sentMessages[0].content[0]).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'BASE64DATA' },
      });

      mockCreate.mockClear();
      await provider.generateText({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', mimeType: 'image/jpeg', url: 'https://x/y.jpg' },
            ],
          },
        ],
      });
      const sentMessages2 = mockCreate.mock.calls[0][0].messages;
      expect(sentMessages2[0].content[0]).toEqual({
        type: 'image',
        source: { type: 'url', url: 'https://x/y.jpg' },
      });
    });

    it('maps a PDF document block to a base64 document source', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
      });

      await provider.generateText({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', mimeType: 'application/pdf', data: 'PDFDATA' },
            ],
          },
        ],
      });

      const sentMessages = mockCreate.mock.calls[0][0].messages;
      expect(sentMessages[0].content[0]).toEqual({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: 'PDFDATA',
        },
      });
    });

    it('normalizes SDK errors into AiProviderError', async () => {
      mockCreate.mockRejectedValue(
        new APIError(429, {}, 'Rate limited', undefined),
      );

      await expect(
        provider.generateText({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toBeInstanceOf(AiProviderError);
    });
  });

  describe('generateStructured', () => {
    it('asks for a JSON-schema output format instead of forcing a tool, and parses the text', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: '{"merchantName":"Starbucks","amount":9.99}' },
        ],
        usage: { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 4 },
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
      });

      const result = await provider.generateStructured({
        messages: [{ role: 'user', content: 'extract this' }],
        jsonSchema: { type: 'object', properties: {} },
        schemaName: 'extract_receipt',
      });

      expect(result.data).toEqual({ merchantName: 'Starbucks', amount: 9.99 });
      expect(result.usage).toEqual({
        inputTokens: 20,
        outputTokens: 10,
        cacheReadInputTokens: 4,
        cacheCreationInputTokens: 0,
      });
      const call = mockCreate.mock.calls[0][0];
      expect(call.output_config).toEqual({
        format: {
          type: 'json_schema',
          schema: { type: 'object', properties: {}, additionalProperties: false },
        },
      });
      expect(call.tool_choice).toBeUndefined();
      expect(call.tools).toBeUndefined();
      expect(call.cache_control).toBeUndefined();
    });

    it.each([
      ['refusal', 'declined'],
      ['max_tokens', 'cut off'],
    ])('throws AiProviderError when stop_reason is %s', async (stopReason, message) => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"partial":' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'claude-sonnet-5',
        stop_reason: stopReason,
      });

      const call = provider.generateStructured({
        messages: [{ role: 'user', content: 'extract this' }],
        jsonSchema: { type: 'object' },
        schemaName: 'extract_receipt',
      });
      await expect(call).rejects.toBeInstanceOf(AiProviderError);
      await expect(call).rejects.toThrow(message);
    });

    it('rewrites the schema to what structured outputs accept', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
      });

      await provider.generateStructured({
        messages: [{ role: 'user', content: 'extract this' }],
        jsonSchema: {
          type: 'object',
          properties: {
            amount: { type: 'number', minimum: 0 },
            // A property that happens to share a constraint keyword's name must survive.
            minimum: { type: 'string', maxLength: 10, format: 'phone' },
            lines: {
              type: 'array',
              minItems: 1,
              items: { type: 'object', properties: { sku: { type: 'string' } } },
            },
          },
          required: ['amount'],
          additionalProperties: true,
        },
        schemaName: 'extract_receipt',
      });

      expect(mockCreate.mock.calls[0][0].output_config.format.schema).toEqual({
        type: 'object',
        properties: {
          amount: { type: 'number' },
          minimum: { type: 'string' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: { sku: { type: 'string' } },
              additionalProperties: false,
            },
          },
        },
        required: ['amount'],
        additionalProperties: false,
      });
    });

    it('throws AiProviderError when the output is not valid JSON', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'I refuse' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
      });

      await expect(
        provider.generateStructured({
          messages: [{ role: 'user', content: 'extract this' }],
          jsonSchema: { type: 'object' },
          schemaName: 'extract_receipt',
        }),
      ).rejects.toBeInstanceOf(AiProviderError);
    });
  });

  describe('generateWithTools', () => {
    const tools = [
      {
        name: 'quote.create',
        description: 'Create a quote',
        inputSchema: { type: 'object', properties: { customer: { type: 'string' } } },
      },
    ];

    it('sends native tools with caching on and returns calls plus the raw turn', async () => {
      const content = [
        { type: 'thinking', thinking: '', signature: 'sig-1' },
        { type: 'text', text: 'Creating it.' },
        { type: 'tool_use', id: 'toolu_1', name: 'quote__create', input: { customer: 'Acme' } },
      ];
      mockCreate.mockResolvedValue({
        content,
        usage: {
          input_tokens: 30,
          output_tokens: 12,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 0,
        },
        model: 'claude-opus-5-5',
        stop_reason: 'tool_use',
      });

      const result = await provider.generateWithTools({
        system: 'Be useful.',
        tools,
        messages: [{ role: 'user', content: 'quote Acme' }],
        cache: true,
      });

      expect(result.text).toBe('Creating it.');
      expect(result.toolCalls).toEqual([
        { id: 'toolu_1', name: 'quote.create', input: { customer: 'Acme' } },
      ]);
      expect(result.raw).toEqual({ provider: 'anthropic', content });
      expect(result.usage.cacheReadInputTokens).toBe(900);
      const call = mockCreate.mock.calls[0][0];
      expect(call.cache_control).toEqual({ type: 'ephemeral' });
      expect(call.tool_choice).toBeUndefined();
      // Dotted skill names are not valid tool names; the dot goes out as `__`.
      expect(call.tools).toEqual([
        {
          name: 'quote__create',
          description: 'Create a quote',
          input_schema: tools[0].inputSchema,
        },
      ]);
    });

    it('replays its own raw turn verbatim and maps tool results', async () => {
      const raw = [
        { type: 'thinking', thinking: '', signature: 'sig-1' },
        { type: 'tool_use', id: 'toolu_1', name: 'quote__create', input: { customer: 'Acme' } },
      ];
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Done.' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
      });

      await provider.generateWithTools({
        tools,
        messages: [
          { role: 'user', content: 'quote Acme' },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'toolu_1', name: 'quote.create', input: { customer: 'Acme' } },
            ],
            raw: { provider: 'anthropic', content: raw },
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', toolUseId: 'toolu_1', content: '{"error":"no"}', isError: true },
            ],
          },
        ],
      });

      const sent = mockCreate.mock.calls[0][0].messages;
      expect(sent[1]).toEqual({ role: 'assistant', content: raw });
      expect(sent[2].content).toEqual([
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"error":"no"}', is_error: true },
      ]);
    });

    it('rebuilds a turn recorded by a different provider from its blocks', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Done.' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
      });

      await provider.generateWithTools({
        tools,
        messages: [
          { role: 'user', content: 'quote Acme' },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'call_1', name: 'quote.create', input: { customer: 'Acme' } },
            ],
            raw: { provider: 'openai', content: { role: 'assistant' } },
          },
        ],
      });

      expect(mockCreate.mock.calls[0][0].messages[1].content).toEqual([
        { type: 'tool_use', id: 'call_1', name: 'quote__create', input: { customer: 'Acme' } },
      ]);
    });

    it('marks a rejected request non-retryable but a transient failure retryable', async () => {
      // The mocked APIError takes a message only; the real one carries `status`.
      const apiError = (message: string, status: number) =>
        Object.assign(new (APIError as unknown as new (m: string) => Error)(message), {
          status,
        });
      const call = () =>
        provider.generateWithTools({ tools, messages: [{ role: 'user', content: 'x' }] });

      mockCreate.mockRejectedValueOnce(apiError('invalid tool name', 400));
      await expect(call()).rejects.toMatchObject({
        constructor: AiProviderError,
        retryable: false,
      });

      mockCreate.mockRejectedValueOnce(apiError('overloaded', 529));
      await expect(call()).rejects.toMatchObject({ retryable: true });
    });

    it('throws rather than return possibly half-written tool arguments', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'quote.create', input: {} }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'claude-opus-5-5',
        stop_reason: 'max_tokens',
      });

      await expect(
        provider.generateWithTools({ tools, messages: [{ role: 'user', content: 'x' }] }),
      ).rejects.toBeInstanceOf(AiProviderError);
    });

    it('passes a refusal through for the caller to handle', async () => {
      mockCreate.mockResolvedValue({
        content: [],
        usage: { input_tokens: 1, output_tokens: 0 },
        model: 'claude-opus-5-5',
        stop_reason: 'refusal',
      });

      const result = await provider.generateWithTools({
        tools,
        messages: [{ role: 'user', content: 'x' }],
      });
      expect(result.stopReason).toBe('refusal');
      expect(result.toolCalls).toEqual([]);
    });
  });
});
