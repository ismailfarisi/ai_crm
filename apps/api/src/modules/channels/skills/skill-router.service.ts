import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { SKILL_ROUTE_MIN_CONFIDENCE, type SkillRoute } from '@saas/shared';
import { AiService } from '../../ai/ai.service';
import { AiNotConfiguredException } from '../../ai/interfaces/ai-provider.interface';
import type { ChannelSkill } from './skill.types';

/** Raised when the provider is unconfigured or over budget — callers degrade, not fail. */
export class AiUnavailableError extends Error {}

const routeSchema = z.object({
  skill: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export interface ExtractionResult {
  slots: Record<string, unknown>;
  model: string;
}

/**
 * The two model calls, and nothing else.
 *
 * Routing and extraction are separate on purpose. A single growing schema
 * would become the file every sprint edits — the exact registry-conflict
 * shape we removed elsewhere — and would put the slot vocabulary of every
 * domain into the context of every message. The router never sees slot
 * structure; the extractor never sees skills it was not chosen for.
 */
@Injectable()
export class SkillRouterService {
  private readonly logger = new Logger(SkillRouterService.name);

  constructor(private readonly ai: AiService) {}

  async route(
    message: string,
    candidates: ChannelSkill<never>[],
    actor: { organizationId: string; userId: string },
  ): Promise<SkillRoute> {
    if (candidates.length === 0) return { skill: null, confidence: 1 };

    const catalogue = candidates
      .map(
        (skill) =>
          `- ${skill.name}: ${skill.description}\n  Examples: ${skill.examples
            .map((e) => `"${e}"`)
            .join('; ')}`,
      )
      .join('\n');

    const jsonSchema = {
      type: 'object',
      properties: {
        skill: {
          type: ['string', 'null'],
          enum: [...candidates.map((s) => s.name), null],
          description:
            'The single best matching capability, or null if the message is not a request to do any of them (a greeting, a question, a customer message).',
        },
        confidence: {
          type: 'number',
          description:
            'How certain the match is, 0 to 1. Be honest: below 0.6 the system will ask the user to clarify rather than act.',
        },
      },
      required: ['skill', 'confidence'],
      additionalProperties: false,
    };

    try {
      const result = await this.ai.generateStructured<unknown>(
        'channels.route_skill',
        {
          messages: [
            {
              role: 'user',
              content: `Capabilities available to this user:\n${catalogue}\n\nMessage: "${message}"\n\nWhich capability is being requested?`,
            },
          ],
          jsonSchema,
          schemaName: 'skill_route',
        },
        actor,
      );

      const parsed = routeSchema.safeParse(result.data);
      if (!parsed.success) return { skill: null, confidence: 0 };

      const name = parsed.data.skill;
      const known = candidates.find((s) => s.name === name);
      if (!name || !known)
        return { skill: null, confidence: parsed.data.confidence };

      return {
        skill: known.name,
        confidence: parsed.data.confidence,
      };
    } catch (err: unknown) {
      throw this.asDegradable(err, 'routing');
    }
  }

  /**
   * Fill the chosen skill's slots from the message.
   *
   * `priorSlots` carries what a half-finished conversation already knows, so a
   * bare reply of "500" lands in the quantity it was asked about rather than
   * being re-read as a new command.
   */
  async extract(
    message: string,
    skill: ChannelSkill<never>,
    priorSlots: Record<string, unknown>,
    actor: { organizationId: string; userId: string },
  ): Promise<ExtractionResult> {
    const known = Object.keys(priorSlots).length
      ? `\n\nAlready established (do not contradict, only add):\n${JSON.stringify(priorSlots)}`
      : '';

    try {
      const result = await this.ai.generateStructured<unknown>(
        'channels.extract_slots',
        {
          messages: [
            {
              role: 'user',
              content: `Task: ${skill.description}${known}\n\nMessage: "${message}"\n\nExtract only what the message actually states. Omit anything it does not.`,
            },
          ],
          jsonSchema: skill.jsonSchema,
          schemaName: skill.name.replace(/\./g, '_'),
        },
        actor,
      );

      // The safety net: model output is never handed to a service unparsed.
      const parsed = skill.slotSchema.safeParse(result.data);
      return {
        slots: parsed.success ? parsed.data : {},
        model: result.model,
      };
    } catch (err: unknown) {
      throw this.asDegradable(err, 'extraction');
    }
  }

  readonly minConfidence = SKILL_ROUTE_MIN_CONFIDENCE;

  private asDegradable(err: unknown, stage: string): Error {
    if (err instanceof AiNotConfiguredException) {
      this.logger.warn(`Channel ${stage} skipped: AI provider not configured`);
      return new AiUnavailableError();
    }
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Channel ${stage} failed, degrading: ${msg}`);
    return new AiUnavailableError();
  }
}
