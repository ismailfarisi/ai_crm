import {
  AiProvider,
  AiProviderError,
  AiGenerateOptions,
  AiGenerateResult,
  AiStructuredOptions,
  AiStructuredResult,
  AiToolOptions,
  AiToolResult,
  AiMessage,
  AiContentBlock,
  AiTextContent,
  AiToolUseContent,
  AiToolResultContent,
  AiUsage,
} from '../interfaces/ai-provider.interface';
import { fromProviderToolName, toProviderToolName } from './tool-names';

/** Kept low: OpenRouter proxies models whose output cap is far below OpenAI's. */
const DEFAULT_MAX_TOKENS = 4096;

/** Worth another attempt: the request was fine, the service was not. */
const RETRYABLE_STATUSES = new Set([408, 409, 429]);

interface OpenAiToolCall {
  id?: string;
  type?: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiAssistantMessage {
  role?: 'assistant';
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  /** OpenRouter's reasoning blocks; sent back so the model keeps its own reasoning. */
  reasoning_details?: unknown;
}

interface OpenAiChatCompletionResponse {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  choices?: Array<{
    finish_reason?: string;
    message?: OpenAiAssistantMessage;
  }>;
}

/**
 * Implements the OpenAI-compatible Chat Completions API — used for both OpenAI
 * itself and OpenRouter (which mirrors OpenAI's request/response shape and lets
 * `model` be any of the open/third-party models it proxies).
 *
 * Prompt caching is automatic on OpenAI for long prompts, so `cache` needs no
 * request field here; cached tokens are read back from the usage block.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: string;
  readonly defaultMaxTokens = DEFAULT_MAX_TOKENS;
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
      usage: this.usageOf(json),
      model: json.model ?? this.defaultModel,
      stopReason: choice?.finish_reason ?? null,
    };
  }

  /**
   * A forced function call rather than `response_format: json_schema`:
   * function calling is the more widely supported of the two across the
   * models OpenRouter proxies.
   */
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

    const choice = json.choices?.[0];
    this.assertComplete(choice?.finish_reason);
    const toolCall = choice?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new AiProviderError(
        'AI response did not include the expected structured output',
      );
    }

    return {
      data: this.parseArguments(toolCall) as T,
      usage: this.usageOf(json),
      model: json.model ?? this.defaultModel,
    };
  }

  async generateWithTools(options: AiToolOptions): Promise<AiToolResult> {
    const json = await this.request<OpenAiChatCompletionResponse>({
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: this.buildMessages(options),
      ...(options.tools.length
        ? {
            tools: options.tools.map((tool) => ({
              type: 'function',
              function: {
                name: toProviderToolName(tool.name),
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
          }
        : {}),
    });

    const choice = json.choices?.[0];
    if (choice?.finish_reason === 'length') {
      // A tool call's arguments may be half-written; never act on them.
      throw new AiProviderError('AI response was cut off before it was complete', false);
    }
    const message = choice?.message ?? {};
    return {
      text: message.content ?? '',
      toolCalls: (message.tool_calls ?? []).map((call) => ({
        id: call.id ?? '',
        name: fromProviderToolName(call.function.name),
        input: this.parseArguments(call),
      })),
      raw: { provider: this.name, content: this.replayableTurn(message) },
      usage: this.usageOf(json),
      model: json.model ?? this.defaultModel,
      stopReason:
        choice?.finish_reason === 'content_filter'
          ? 'refusal'
          : (choice?.finish_reason ?? null),
    };
  }

  /**
   * Only the request-side fields of the assistant message. A response also
   * carries `refusal`, `annotations`, `audio` and provider extras, which
   * strict endpoints reject when they come back inside `messages`.
   */
  private replayableTurn(message: OpenAiAssistantMessage): OpenAiAssistantMessage {
    return {
      role: 'assistant',
      content: message.content ?? null,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
      ...(message.reasoning_details !== undefined
        ? { reasoning_details: message.reasoning_details }
        : {}),
    };
  }

  private assertComplete(finishReason: string | undefined): void {
    if (finishReason === 'length') {
      throw new AiProviderError(
        'AI response was cut off before the structured output was complete',
        false,
      );
    }
    if (finishReason === 'content_filter') {
      throw new AiProviderError('The AI provider declined to answer this request', false);
    }
  }

  private parseArguments(call: OpenAiToolCall): Record<string, unknown> {
    try {
      return JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      throw new AiProviderError(
        'AI response tool arguments were not valid JSON',
        false,
      );
    }
  }

  /** `prompt_tokens` includes cached tokens; split them out to match AiUsage. */
  private usageOf(json: OpenAiChatCompletionResponse): AiUsage {
    const cached = json.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      inputTokens: (json.usage?.prompt_tokens ?? 0) - cached,
      outputTokens: json.usage?.completion_tokens ?? 0,
      cacheReadInputTokens: cached,
      cacheCreationInputTokens: 0,
    };
  }

  private buildMessages(options: AiGenerateOptions): unknown[] {
    const messages: unknown[] = [];
    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }
    for (const message of options.messages) {
      messages.push(...this.mapMessage(message));
    }
    return messages;
  }

  /** One AiMessage can become several: each tool result is its own `tool` message. */
  private mapMessage(message: AiMessage): unknown[] {
    if (message.raw?.provider === this.name) return [message.raw.content];
    if (typeof message.content === 'string') {
      return [{ role: message.role, content: message.content }];
    }

    const toolUses = message.content.filter(
      (b): b is AiToolUseContent => b.type === 'tool_use',
    );
    const toolResults = message.content.filter(
      (b): b is AiToolResultContent => b.type === 'tool_result',
    );
    const other = message.content.filter(
      (b) => b.type !== 'tool_use' && b.type !== 'tool_result',
    );

    if (message.role === 'assistant' && toolUses.length) {
      const text = other
        .filter((b): b is AiTextContent => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return [
        {
          role: 'assistant',
          content: text || null,
          tool_calls: toolUses.map((b) => ({
            id: b.id,
            type: 'function',
            function: {
              name: toProviderToolName(b.name),
              arguments: JSON.stringify(b.input),
            },
          })),
        },
      ];
    }

    const mapped: unknown[] = toolResults.map((b) => ({
      role: 'tool',
      tool_call_id: b.toolUseId,
      content: b.content,
    }));
    if (other.length) {
      mapped.push({
        role: message.role,
        content: other.map((block) => this.mapContentBlock(block)),
      });
    }
    return mapped;
  }

  private mapContentBlock(block: AiContentBlock): unknown {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
    if (block.type === 'image') {
      const url =
        block.url ?? `data:${block.mimeType};base64,${block.data ?? ''}`;
      return { type: 'image_url', image_url: { url } };
    }
    throw new AiProviderError(`Unexpected ${block.type} block in a ${this.name} message`);
  }

  private async request<T>(body: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.name === 'openrouter') {
      headers['X-Title'] = 'Kerf';
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
        response.status >= 500 || RETRYABLE_STATUSES.has(response.status),
      );
    }

    return (await response.json()) as T;
  }
}
