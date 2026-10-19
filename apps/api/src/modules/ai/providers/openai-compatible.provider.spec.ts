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
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
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
      expect(init.headers['X-Title']).toBe('Kerf');
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
      expect(result.usage).toEqual({
        inputTokens: 5,
        outputTokens: 3,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      });

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

    it('throws AiProviderError when the output was cut off', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [
            {
              finish_reason: 'length',
              message: {
                tool_calls: [{ function: { name: 'extract', arguments: '{"foo":' } }],
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'gpt-4o',
        }),
      );

      await expect(
        makeProvider('openai').generateStructured({
          messages: [{ role: 'user', content: 'hi' }],
          jsonSchema: { type: 'object' },
          schemaName: 'extract',
        }),
      ).rejects.toThrow('cut off');
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

    it('sends function tools without forcing one and splits cached tokens out of usage', async () => {
      const message = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'quote.create', arguments: '{"customer":"Acme"}' },
          },
        ],
      };
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [{ finish_reason: 'tool_calls', message }],
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 1024 },
          },
          model: 'gpt-4o',
        }),
      );

      const result = await makeProvider('openai').generateWithTools({
        tools,
        messages: [{ role: 'user', content: 'quote Acme' }],
        cache: true,
      });

      expect(result.toolCalls).toEqual([
        { id: 'call_1', name: 'quote.create', input: { customer: 'Acme' } },
      ]);
      expect(result.raw).toEqual({ provider: 'openai', content: message });
      expect(result.usage).toEqual({
        inputTokens: 176,
        outputTokens: 20,
        cacheReadInputTokens: 1024,
        cacheCreationInputTokens: 0,
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.tool_choice).toBeUndefined();
      expect(body.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'quote.create',
            description: 'Create a quote',
            parameters: tools[0].inputSchema,
          },
        },
      ]);
    });

    it('maps tool calls and results to assistant tool_calls and tool messages', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [{ finish_reason: 'stop', message: { content: 'Done.' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'gpt-4o',
        }),
      );

      const result = await makeProvider('openrouter').generateWithTools({
        system: 'Be useful.',
        tools,
        messages: [
          { role: 'user', content: 'quote Acme and Beta' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'On it.' },
              { type: 'tool_use', id: 'toolu_1', name: 'quote.create', input: { customer: 'Acme' } },
              { type: 'tool_use', id: 'toolu_2', name: 'quote.create', input: { customer: 'Beta' } },
            ],
            // Recorded by another provider, so it is rebuilt rather than replayed.
            raw: { provider: 'anthropic', content: [] },
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', toolUseId: 'toolu_1', content: '{"ok":true}' },
              { type: 'tool_result', toolUseId: 'toolu_2', content: '{"error":"x"}', isError: true },
            ],
          },
        ],
      });

      expect(result.text).toBe('Done.');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: 'system', content: 'Be useful.' },
        { role: 'user', content: 'quote Acme and Beta' },
        {
          role: 'assistant',
          content: 'On it.',
          tool_calls: [
            {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'quote.create', arguments: '{"customer":"Acme"}' },
            },
            {
              id: 'toolu_2',
              type: 'function',
              function: { name: 'quote.create', arguments: '{"customer":"Beta"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'toolu_1', content: '{"ok":true}' },
        { role: 'tool', tool_call_id: 'toolu_2', content: '{"error":"x"}' },
      ]);
    });

    it('replays its own raw turn verbatim', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [{ finish_reason: 'stop', message: { content: 'Done.' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
      const raw = { role: 'assistant', content: null, tool_calls: [{ id: 'call_1' }] };

      await makeProvider('openai').generateWithTools({
        tools,
        messages: [
          { role: 'user', content: 'x' },
          { role: 'assistant', content: [], raw: { provider: 'openai', content: raw } },
        ],
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.messages[1]).toEqual(raw);
    });

    it('reports a content filter stop as a refusal', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [{ finish_reason: 'content_filter', message: { content: '' } }],
          usage: { prompt_tokens: 1, completion_tokens: 0 },
        }),
      );

      const result = await makeProvider('openai').generateWithTools({
        tools,
        messages: [{ role: 'user', content: 'x' }],
      });
      expect(result.stopReason).toBe('refusal');
    });
  });
});
