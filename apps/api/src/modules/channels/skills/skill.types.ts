import type { ZodType } from 'zod';
import type {
  ChannelSkillName,
  Permission,
  SkillOutcome,
  SkillResolution,
} from '@saas/shared';
import type { ChannelProviderType } from '../entities/channel-config.entity';

/**
 * Everything a skill is allowed to know about who is talking to it.
 *
 * `permissions` is the caller's *resolved* effective permission list, passed
 * down rather than re-fetched, so a skill cannot accidentally consult a
 * different source of authority than the one the router gated on. It is
 * re-resolved before execution by the command service — see the note there.
 */
export interface SkillContext {
  organizationId: string;
  userId: string;
  provider: ChannelProviderType;
  senderIdentifier: string;
  permissions: Permission[];
  /** The raw inbound message, for skills that want to pattern-match it directly. */
  message: string;
}

/**
 * One staff chat capability.
 *
 * Mirrors the `ActionHandler` seam the customer-facing agent already uses —
 * "the one file to touch when adding a genuinely new action type". A sprint
 * that adds a document type adds a skill file and one registry line, rather
 * than another branch and two more injected services in a growing service.
 *
 * The division of labour is deliberate and load-bearing:
 *
 * - the model decides *which* skill and fills *slots* from prose;
 * - `resolve` turns names into ids against the database, and refuses or asks
 *   rather than guessing;
 * - `preview` states what will happen, in the user's terms;
 * - `execute` calls the ordinary domain service — the same method the HTTP
 *   controller calls, with the same tenant scoping and the same guardrails.
 *
 * Nothing here may compute a price. Prices come from the catalog.
 */
export interface ChannelSkill<
  TResolved = unknown,
  TSlots = Record<string, unknown>,
> {
  name: ChannelSkillName;

  /** Fed verbatim to the router. This text *is* the prompt — keep it concrete. */
  description: string;

  /** Real phrasings a person would use. Also the seed of the routing eval set. */
  examples: string[];

  /**
   * Checked before slot-filling, so nobody is interrogated about an order
   * they are not allowed to raise, and checked again before execution.
   */
  requiredPermissions: Permission[];

  /** The extractor's output contract, sent to the provider. */
  jsonSchema: Record<string, unknown>;

  /**
   * The safety net: extractor output is parsed through this before use.
   *
   * Typed separately from `TResolved` because the two are genuinely different
   * shapes. Extraction produces what the message *said* — "350gsm board",
   * "500" — while resolution produces what that turned out to *mean*: a
   * material id, a unit cost from the supplier's price list. Collapsing them
   * into one type is how a model's guess ends up typed as a resolved id.
   */
  slotSchema: ZodType<TSlots>;

  /**
   * Bumped whenever `description`, `jsonSchema` or the resolution rules
   * change. Recorded on whatever the skill creates, so a bad order can be
   * traced to the prompt revision that produced it.
   */
  promptVersion: string;

  /**
   * Turn partial slots into something executable, ask one question, or refuse.
   *
   * Called again on every inbound message while the conversation is
   * collecting, with the accumulated slots — so it must be pure with respect
   * to the slots it is given and must not assume it is being called for the
   * first time.
   */
  resolve(
    slots: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillResolution<TResolved>>;

  /** What the user is asked to confirm. Must state the money and the resulting state. */
  preview(resolved: TResolved, ctx: SkillContext): Promise<string>;

  execute(resolved: TResolved, ctx: SkillContext): Promise<SkillOutcome>;
}

/**
 * A choice put to the user, parked in the conversation's slots.
 *
 * Selection is matched in code, not by the model: a reply of "2", "SRA2" or
 * "the B1 one" resolves against these options deterministically. Sending an
 * ambiguity back through the extractor would let a model invent an id.
 */
export interface PendingChoice {
  /** Which slot the answer fills, e.g. `lines.0.materialId`. */
  field: string;
  question: string;
  options: { id: string; label: string; keywords: string[] }[];
}
