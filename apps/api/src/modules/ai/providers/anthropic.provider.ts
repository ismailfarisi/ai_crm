import Anthropic, { APIError } from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlockParam,
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
  AiMessage,
  AiContentBlock,
} from '../interfaces/ai-provider.interface';

const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly defaultModel: string;

  constructor(opts: { apiKey: string; defaultModel: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.defaultModel = opts.defaultModel;
  }

  async generateText(options: AiGenerateOptions): Promise<AiGenerateResult> {
    try {
      const response = await this.client.messages.create({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: options.system,
        messages: options.messages.map((m) => this.mapMessage(m)),
      });

      const textBlock = response.content.find(
        (b): b is TextBlock => b.type === 'text',
      );

      return {
        text: textBlock?.text ?? '',
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        model: response.model,
        stopReason: response.stop_reason,
      };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  async generateStructured<T>(
    options: AiStructuredOptions,
  ): Promise<AiStructuredResult<T>> {
    try {
      const tool: Tool = {
        name: options.schemaName,
        input_schema: options.jsonSchema as Tool['input_schema'],
        strict: true,
      };

      const response = await this.client.messages.create({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: options.system,
        messages: options.messages.map((m) => this.mapMessage(m)),
        tools: [tool],
        tool_choice: { type: 'tool', name: options.schemaName },
      });

      const toolUseBlock = response.content.find(
        (b): b is ToolUseBlock => b.type === 'tool_use',
      );
      if (!toolUseBlock) {
        throw new AiProviderError(
          'AI response did not include the expected structured output',
        );
      }

      return {
        data: toolUseBlock.input as T,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        model: response.model,
      };
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      throw this.normalizeError(err);
    }
  }

  private mapMessage(message: AiMessage): MessageParam {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content };
    }
    return {
      role: message.role,
      content: message.content.map((block) => this.mapContentBlock(block)),
    };
  }

  private mapContentBlock(block: AiContentBlock): ContentBlockParam {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
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
  }

  private normalizeError(err: unknown): AiProviderError {
    if (err instanceof APIError) {
      return new AiProviderError(`Anthropic API error: ${err.message}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    return new AiProviderError(`Failed to call Anthropic: ${message}`);
  }
}
