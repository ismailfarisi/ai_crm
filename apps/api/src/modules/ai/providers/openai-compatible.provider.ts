import {
  AiProvider,
  AiProviderError,
  AiGenerateOptions,
  AiGenerateResult,
  AiStructuredOptions,
  AiStructuredResult,
  AiMessage,
  AiContentBlock,
} from '../interfaces/ai-provider.interface';

const DEFAULT_MAX_TOKENS = 4096;

interface OpenAiToolCall {
  function: { name: string; arguments: string };
}

interface OpenAiChatCompletionResponse {
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string; tool_calls?: OpenAiToolCall[] };
  }>;
}

/**
 * Implements the OpenAI-compatible Chat Completions API — used for both OpenAI
 * itself and OpenRouter (which mirrors OpenAI's request/response shape and lets
 * `model` be any of the open/third-party models it proxies).
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(opts: {
    name: string;
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
  }) {
    this.name = opts.name;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl;
    this.defaultModel = opts.defaultModel;
  }

  async generateText(options: AiGenerateOptions): Promise<AiGenerateResult> {
    const json = await this.request<OpenAiChatCompletionResponse>({
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: this.buildMessages(options),
    });

    const choice = json.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      model: json.model ?? this.defaultModel,
      stopReason: choice?.finish_reason ?? null,
    };
  }

  async generateStructured<T>(
    options: AiStructuredOptions,
  ): Promise<AiStructuredResult<T>> {
    const json = await this.request<OpenAiChatCompletionResponse>({
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: this.buildMessages(options),
      tools: [
        {
          type: 'function',
          function: {
            name: options.schemaName,
            parameters: options.jsonSchema,
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: { name: options.schemaName },
      },
    });

    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new AiProviderError(
        'AI response did not include the expected structured output',
      );
    }

    let data: T;
    try {
      data = JSON.parse(toolCall.function.arguments) as T;
    } catch {
      throw new AiProviderError(
        'AI response tool arguments were not valid JSON',
      );
    }

    return {
      data,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      model: json.model ?? this.defaultModel,
    };
  }

  private buildMessages(options: AiGenerateOptions): unknown[] {
    const messages: unknown[] = [];
    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push(...options.messages.map((m) => this.mapMessage(m)));
    return messages;
  }

  private mapMessage(message: AiMessage): unknown {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content };
    }
    return {
      role: message.role,
      content: message.content.map((block) => this.mapContentBlock(block)),
    };
  }

  private mapContentBlock(block: AiContentBlock): unknown {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
    const url =
      block.url ?? `data:${block.mimeType};base64,${block.data ?? ''}`;
    return { type: 'image_url', image_url: { url } };
  }

  private async request<T>(body: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.name === 'openrouter') {
      headers['X-Title'] = 'Relay CRM';
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AiProviderError(`Failed to call ${this.name}: ${message}`);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new AiProviderError(
        `${this.name} API error (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    return (await response.json()) as T;
  }
}
