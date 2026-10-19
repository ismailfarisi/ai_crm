import { ServiceUnavailableException } from '@nestjs/common';
import { AiProviderType } from '../entities/ai-config.entity';

export interface AiTextContent {
  type: 'text';
  text: string;
}

export interface AiImageContent {
  type: 'image';
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** Base64-encoded image bytes, no data-URL prefix. Provide this or `url`, not both. */
  data?: string;
  url?: string;
}

/** A tool call the model made, on an assistant message. */
export interface AiToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** The result of one tool call, on the user message that follows it. */
export interface AiToolResultContent {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type AiContentBlock =
  | AiTextContent
  | AiImageContent
  | AiToolUseContent
  | AiToolResultContent;

/**
 * An assistant turn exactly as one provider returned it. Replayed verbatim
 * when the conversation goes back to that same provider — thinking blocks
 * must come back unchanged — and ignored by any other provider, which
 * rebuilds the turn from `content` instead.
 */
export interface AiRawAssistantContent {
  provider: string;
  content: unknown;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string | AiContentBlock[];
  raw?: AiRawAssistantContent;
}

export interface AiGenerateOptions {
  /** Request a specific org-configured provider for this call instead of the org's default — lets a future per-feature (e.g. workflow step) config pick its own provider. */
  provider?: AiProviderType;
  /** Provider-specific model id; falls back to the provider's configured default. */
  model?: string;
  system?: string;
  messages: AiMessage[];
  maxTokens?: number;
  /**
   * The system prompt, tools and earlier messages will be sent again soon
   * (an agent loop). Providers that need opting in mark the prompt for
   * caching; a one-off call should leave this off, since writing a cache
   * entry costs more than an uncached prompt.
   */
  cache?: boolean;
}

export interface AiUsage {
  /** Input tokens billed at the full rate — cache reads and writes are counted separately. */
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface AiGenerateResult {
  text: string;
  usage: AiUsage;
  model: string;
  stopReason: string | null;
}

/** JSON-Schema-constrained generation, for reliably extracting structured data. */
export interface AiStructuredOptions extends AiGenerateOptions {
  /** JSON-Schema (not zod) describing the desired output shape. */
  jsonSchema: Record<string, unknown>;
  /** Name for the underlying tool/schema — also used for logging. */
  schemaName: string;
}

export interface AiStructuredResult<T> {
  /** Not yet validated against a zod schema — the caller must validate before trusting it. */
  data: T;
  usage: AiUsage;
  model: string;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON-Schema of the tool's arguments. */
  inputSchema: Record<string, unknown>;
}

/** One turn of native tool calling: the model answers in text, calls tools, or both. */
export interface AiToolOptions extends AiGenerateOptions {
  tools: AiToolDefinition[];
}

export interface AiToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AiToolResult {
  /** Text the model wrote this turn — its answer when it called no tools. */
  text: string;
  toolCalls: AiToolCall[];
  /** This turn as the provider returned it, to send back on the next request. */
  raw: AiRawAssistantContent;
  usage: AiUsage;
  model: string;
  /** 'refusal' when the provider declined; the caller decides what to tell the user. */
  stopReason: string | null;
}

export interface AiProvider {
  readonly name: string;
  /** Output cap used when a call sets no `maxTokens`; budget reservation reserves against it. */
  readonly defaultMaxTokens: number;
  generateText(options: AiGenerateOptions): Promise<AiGenerateResult>;
  generateStructured<T>(
    options: AiStructuredOptions,
  ): Promise<AiStructuredResult<T>>;
  generateWithTools(options: AiToolOptions): Promise<AiToolResult>;
}

/**
 * Normalizes provider-SDK-specific errors so callers don't need to know about
 * them. `retryable` is false when the same request would fail the same way
 * again (a rejected schema or tool name, a refusal, malformed output), so a
 * workflow can stop retrying — and paying for — a deterministic failure.
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

/** Thrown when the configured provider has no API key set — callers should degrade gracefully. */
export class AiNotConfiguredException extends ServiceUnavailableException {
  constructor(message = 'AI provider is not configured') {
    super(message);
  }
}
