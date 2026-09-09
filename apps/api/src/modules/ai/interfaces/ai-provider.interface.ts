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

export type AiContentBlock = AiTextContent | AiImageContent;

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string | AiContentBlock[];
}

export interface AiGenerateOptions {
  /** Request a specific org-configured provider for this call instead of the org's default — lets a future per-feature (e.g. workflow step) config pick its own provider. */
  provider?: AiProviderType;
  /** Provider-specific model id; falls back to the provider's configured default. */
  model?: string;
  system?: string;
  messages: AiMessage[];
  maxTokens?: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
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

export interface AiProvider {
  readonly name: string;
  generateText(options: AiGenerateOptions): Promise<AiGenerateResult>;
  generateStructured<T>(
    options: AiStructuredOptions,
  ): Promise<AiStructuredResult<T>>;
}

/** Normalizes provider-SDK-specific errors so callers don't need to know about them. */
export class AiProviderError extends Error {}

/** Thrown when the configured provider has no API key set — callers should degrade gracefully. */
export class AiNotConfiguredException extends ServiceUnavailableException {
  constructor(message = 'AI provider is not configured') {
    super(message);
  }
}
