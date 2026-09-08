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
        usage: { inputTokens: 12, outputTokens: 8 },
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
    it('forces the tool choice and parses the tool_use block', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'extract_receipt',
            input: { merchantName: 'Starbucks', amount: 9.99 },
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
        model: 'claude-sonnet-5',
      });

      const result = await provider.generateStructured({
        messages: [{ role: 'user', content: 'extract this' }],
        jsonSchema: { type: 'object', properties: {} },
        schemaName: 'extract_receipt',
      });

      expect(result.data).toEqual({ merchantName: 'Starbucks', amount: 9.99 });
      expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });

      const call = mockCreate.mock.calls[0][0];
      expect(call.tool_choice).toEqual({
        type: 'tool',
        name: 'extract_receipt',
      });
      expect(call.tools).toEqual([
        expect.objectContaining({
          name: 'extract_receipt',
          input_schema: { type: 'object', properties: {} },
        }),
      ]);
    });

    it('throws AiProviderError when no tool_use block is returned', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'I refuse' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'claude-sonnet-5',
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
});
