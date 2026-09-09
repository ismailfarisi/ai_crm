import { OpenAiCompatibleProvider } from './openai-compatible.provider';
import { AiProviderError } from '../interfaces/ai-provider.interface';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('OpenAiCompatibleProvider', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  function makeProvider(name: 'openai' | 'openrouter' = 'openai') {
    return new OpenAiCompatibleProvider({
      name,
      apiKey: 'test-key',
      baseUrl:
        name === 'openai'
          ? 'https://api.openai.com/v1'
          : 'https://openrouter.ai/api/v1',
      defaultModel: 'gpt-4o',
    });
  }

  describe('generateText', () => {
    it('sends the expected request shape/headers and extracts text + usage', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [
            { message: { content: 'Hello there' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 8 },
          model: 'gpt-4o',
        }),
      );

      const provider = makeProvider('openai');
      const result = await provider.generateText({
        system: 'Be terse.',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result).toEqual({
        text: 'Hello there',
        usage: { inputTokens: 12, outputTokens: 8 },
        model: 'gpt-4o',
        stopReason: 'stop',
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init.headers.Authorization).toBe('Bearer test-key');
      expect(init.headers['X-Title']).toBeUndefined();
      const body = JSON.parse(init.body);
      expect(body.messages).toEqual([
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Hi' },
      ]);
    });

    it('adds an X-Title header for openrouter', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'meta-llama/llama-3.1-70b-instruct',
        }),
      );

      const provider = makeProvider('openrouter');
      await provider.generateText({
        messages: [{ role: 'user', content: 'hi' }],
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(init.headers['X-Title']).toBe('Relay CRM');
    });

    it('maps image content blocks (base64 and url) to OpenAI image_url shape', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'gpt-4o',
        }),
      );

      const provider = makeProvider('openai');
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

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.messages[0].content[0]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,BASE64DATA' },
      });
    });

    it('throws AiProviderError on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: 'bad key' }, false, 401),
      );

      const provider = makeProvider('openai');
      await expect(
        provider.generateText({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toBeInstanceOf(AiProviderError);
    });
  });

  describe('generateStructured', () => {
    it('forces tool_choice and parses the stringified tool arguments', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [
            {
              message: {
                tool_calls: [
                  { function: { name: 'extract', arguments: '{"foo":"bar"}' } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
          model: 'gpt-4o',
        }),
      );

      const provider = makeProvider('openai');
      const result = await provider.generateStructured({
        messages: [{ role: 'user', content: 'hi' }],
        jsonSchema: { type: 'object' },
        schemaName: 'extract',
      });

      expect(result.data).toEqual({ foo: 'bar' });
      expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 3 });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({
        type: 'function',
        function: { name: 'extract' },
      });
    });

    it('throws AiProviderError when no tool call is returned', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [{ message: {} }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'gpt-4o',
        }),
      );

      const provider = makeProvider('openai');
      await expect(
        provider.generateStructured({
          messages: [{ role: 'user', content: 'hi' }],
          jsonSchema: { type: 'object' },
          schemaName: 'extract',
        }),
      ).rejects.toBeInstanceOf(AiProviderError);
    });

    it('throws AiProviderError when tool arguments are malformed JSON', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [
            {
              message: {
                tool_calls: [
                  { function: { name: 'extract', arguments: 'not json' } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'gpt-4o',
        }),
      );

      const provider = makeProvider('openai');
      await expect(
        provider.generateStructured({
          messages: [{ role: 'user', content: 'hi' }],
          jsonSchema: { type: 'object' },
          schemaName: 'extract',
        }),
      ).rejects.toBeInstanceOf(AiProviderError);
    });
  });
});
