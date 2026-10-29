import Anthropic, { APIError } from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlock,
  ContentBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
  Tool,
  TextBlock,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
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
  AiUsage,
} from '../interfaces/ai-provider.interface';
import { fromProviderToolName, toProviderToolName } from './tool-names';
import { toStructuredOutputSchema } from './structured-output-schema';

/** Rejected on retry too: the request itself is wrong, not the connection. */
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 413, 422]);

/**
 * Generous enough that structured output and tool arguments are not cut off
 * mid-JSON, while staying a non-streaming request.
 */
const DEFAULT_MAX_TOKENS = 16_000;

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly defaultMaxTokens = DEFAULT_MAX_TOKENS;
  private readonly client: Anthropic;
  private readonly defaultModel: string;

  constructor(opts: { apiKey: string; defaultModel: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.defaultModel = opts.defaultModel;
  }

  async generateText(options: AiGenerateOptions): Promise<AiGenerateResult> {
    const response = await this.create(options);
    return {
      text: this.textOf(response.content),
      usage: this.usageOf(response),
      model: response.model,
      stopReason: response.stop_reason,
    };
  }

  /**
   * Structured outputs (`output_config.format`) rather than a forced tool
   * call: forcing `tool_choice` is rejected by the current Claude models.
   */
  async generateStructured<T>(
    options: AiStructuredOptions,
  ): Promise<AiStructuredResult<T>> {
    const response = await this.create(options, {
      output_config: {
        format: {
          type: 'json_schema',
          schema: toStructuredOutputSchema(options.jsonSchema),
        },
      },
    });
    if (response.stop_reason === 'refusal') {
      throw new AiProviderError('The AI provider declined to answer this request', false);
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiProviderError(
        'AI response was cut off before the structured output was complete',
        false,
      );
    }

    const text = this.textOf(response.content);
    if (!text) {
      throw new AiProviderError(
        'AI response did not include the expected structured output',
        false,
      );
    }
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new AiProviderError('AI response structured output was not valid JSON', false);
    }

    return { data, usage: this.usageOf(response), model: response.model };
  }

  async generateWithTools(options: AiToolOptions): Promise<AiToolResult> {
    const tools: Tool[] = options.tools.map((tool) => ({
      name: toProviderToolName(tool.name),
      description: tool.description,
      input_schema: tool.inputSchema as Tool['input_schema'],
    }));
    const response = await this.create(options, tools.length ? { tools } : {});
    if (response.stop_reason === 'max_tokens') {
      // A tool call's arguments may be half-written; never act on them.
      throw new AiProviderError('AI response was cut off before it was complete', false);
    }

    return {
      text: this.textOf(response.content),
      toolCalls: response.content
        .filter((b): b is ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          name: fromProviderToolName(b.name),
          input: (b.input ?? {}) as Record<string, unknown>,
        })),
      raw: { provider: this.name, content: response.content },
      usage: this.usageOf(response),
      model: response.model,
      stopReason: response.stop_reason,
    };
  }

  private async create(
    options: AiGenerateOptions,
    extra: Partial<MessageCreateParamsNonStreaming> = {},
  ): Promise<Message> {
    try {
      return await this.client.messages.create({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: options.system,
        messages: options.messages.map((m) => this.mapMessage(m)),
        // Caches the longest stable prefix (tools, system, earlier turns),
        // so the next request of an agent loop reads it back at a discount.
        ...(options.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
        ...extra,
      });
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  private textOf(content: ContentBlock[]): string {
    return content
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  private usageOf(response: Message): AiUsage {
    return {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
  }

  private mapMessage(message: AiMessage): MessageParam {
    if (message.raw?.provider === this.name) {
      // Replayed exactly as returned: thinking blocks must not be dropped or edited.
      return { role: message.role, content: message.raw.content as ContentBlockParam[] };
    }
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content };
    }
    return {
      role: message.role,
      content: message.content.map((block) => this.mapContentBlock(block)),
    };
  }

  private mapContentBlock(block: AiContentBlock): ContentBlockParam {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id,
          name: toProviderToolName(block.name),
          input: block.input,
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.toolUseId,
          content: block.content,
          ...(block.isError ? { is_error: true } : {}),
        };
      case 'image':
        if (block.url) {
          return { type: 'image', source: { type: 'url', url: block.url } };
        }
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: block.mimeType,
            data: block.data ?? '',
          },
        };
      case 'document':
        return {
          type: 'document',
          source: {
            type: 'base64',
            media_type: block.mimeType,
            data: block.data,
          },
        };
    }
  }

  private normalizeError(err: unknown): AiProviderError {
    if (err instanceof AiProviderError) return err;
    if (err instanceof APIError) {
      const retryable =
        typeof err.status !== 'number' || !NON_RETRYABLE_STATUSES.has(err.status);
      return new AiProviderError(`Anthropic API error: ${err.message}`, retryable);
    }
    const message = err instanceof Error ? err.message : String(err);
    return new AiProviderError(`Failed to call Anthropic: ${message}`);
  }
}
