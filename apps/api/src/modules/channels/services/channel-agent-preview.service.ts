import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  type ChannelAgentTestResultDto,
  type Permission,
  type TestChannelAgentPayload,
} from '@saas/shared';
import { AiService } from '../../ai/ai.service';
import { ChannelAgentRunner } from '../agents/channel-agent-runner';
import { SkillRegistry } from '../skills/skill.registry';
import {
  AiUnavailableError,
  SkillRouterService,
} from '../skills/skill-router.service';
import { ChannelAgentService } from './channel-agent.service';
import { CustomerLookupService } from './customer-lookup.service';
import {
  CustomerSenderService,
  type VerifiedSender,
} from './customer-sender.service';

/** What a reply written as a customer can quote, so what the tester must be able to see. */
const AS_CUSTOMER_PERMISSIONS: Permission[] = [
  PERMISSIONS.CUSTOMER_READ,
  PERMISSIONS.SALES_ORDER_READ,
  PERMISSIONS.QUOTE_READ,
];

const EMPTY: Omit<ChannelAgentTestResultDto, 'outcome'> = {
  agent: null,
  transfers: [],
  reply: null,
  tool: null,
  actions: [],
  handoverSummary: null,
};

/**
 * What the agents would do with a message, for the settings page's "try a
 * message" box. Runs the same routing and the same agent as a real message,
 * but sends nothing, drafts nothing and records nothing. The model calls are
 * real and are billed.
 */
@Injectable()
export class ChannelAgentPreviewService {
  private readonly runner: ChannelAgentRunner;

  constructor(
    aiService: AiService,
    private readonly agents: ChannelAgentService,
    private readonly registry: SkillRegistry,
    private readonly router: SkillRouterService,
    private readonly senders: CustomerSenderService,
    lookup: CustomerLookupService,
  ) {
    this.runner = new ChannelAgentRunner({ aiService, agents, lookup });
  }

  async preview(
    actor: {
      organizationId: string;
      userId: string;
      permissions: Permission[];
    },
    input: TestChannelAgentPayload,
  ): Promise<ChannelAgentTestResultDto> {
    // Without a customer the sender is a stranger, as an unknown number is.
    let previewSender: VerifiedSender | null = null;
    if (input.kind === 'CUSTOMER' && input.asCustomerId) {
      if (
        !AS_CUSTOMER_PERMISSIONS.every((p) => actor.permissions.includes(p))
      ) {
        throw new ForbiddenException(
          'Trying a message as a customer shows their orders and quotes, which your role cannot see.',
        );
      }
      previewSender = await this.senders.asCustomer(
        actor.organizationId,
        input.asCustomerId,
      );
    }
    try {
      return input.kind === 'CUSTOMER'
        ? await this.previewCustomer(actor.organizationId, input, previewSender)
        : await this.previewStaff(actor, input);
    } catch {
      // No provider, no model, over budget, or the provider failed.
      return { ...EMPTY, outcome: 'UNAVAILABLE' };
    }
  }

  private async previewCustomer(
    organizationId: string,
    input: TestChannelAgentPayload,
    previewSender: VerifiedSender | null,
  ): Promise<ChannelAgentTestResultDto> {
    const result = await this.runner.runCustomerTurn({
      organizationId,
      provider: input.provider,
      contactId: '',
      senderIdentifier: '',
      transcript: [{ role: 'customer', body: input.body }],
      dryRun: true,
      previewSender,
    });
    return {
      ...EMPTY,
      outcome:
        result.outcome === 'REPLIED'
          ? 'REPLY'
          : result.outcome === 'HANDOVER'
            ? 'HANDOVER'
            : 'NO_AGENT',
      agent: result.agent,
      transfers: result.transfers,
      reply: result.reply,
      actions: result.actions,
      handoverSummary: result.handoverSummary,
    };
  }

  /** As the person testing: a tool they lack permission for is not offered to them either. */
  private async previewStaff(
    actor: {
      organizationId: string;
      userId: string;
      permissions: Permission[];
    },
    input: TestChannelAgentPayload,
  ): Promise<ChannelAgentTestResultDto> {
    const permitted = this.registry.permittedFor(actor.permissions, 'channel');
    const candidates = (
      await this.agents.findEnabled(
        actor.organizationId,
        'STAFF',
        input.provider,
      )
    ).filter((agent) =>
      permitted.some((skill) => agent.skills.includes(skill.name)),
    );
    const agent = await this.runner.route(
      actor.organizationId,
      input.body,
      candidates,
    );
    if (!agent) return { ...EMPTY, outcome: 'NO_AGENT' };

    const skills = permitted.filter(
      (skill) =>
        agent.skills.includes(skill.name) && skill.attachment !== 'required',
    );
    let tool: string | null = null;
    try {
      const route = await this.router.route(input.body, skills, actor, agent);
      if (route.skill && route.confidence >= this.router.minConfidence) {
        tool = route.skill;
      }
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      return { ...EMPTY, outcome: 'UNAVAILABLE' };
    }
    return {
      ...EMPTY,
      outcome: 'TOOL',
      agent: { id: agent.id, name: agent.name },
      tool,
    };
  }
}
