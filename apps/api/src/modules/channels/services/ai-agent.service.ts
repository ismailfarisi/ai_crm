import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CreateAiAgentPayload, UpdateAiAgentPayload } from '@saas/shared';
import { AiAgent } from '../entities/ai-agent.entity';
import { MessageAiIntent } from '../entities/channel-message.entity';

@Injectable()
export class AiAgentService {
  constructor(
    @InjectRepository(AiAgent)
    private readonly agentRepo: Repository<AiAgent>,
  ) {}

  async create(
    organizationId: string,
    payload: CreateAiAgentPayload,
  ): Promise<AiAgent> {
    const agent = this.agentRepo.create({
      organizationId,
      name: payload.name,
      intent: payload.intent as MessageAiIntent,
      actionType: payload.actionType as AiAgent['actionType'],
      config: payload.config ?? {},
      confidenceThreshold: payload.confidenceThreshold ?? 0.75,
      eligibleProviders: (payload.eligibleProviders ??
        []) as AiAgent['eligibleProviders'],
      isEnabled: payload.isEnabled ?? true,
      // Null is the normal state: run on whatever the provider is set to.
      model: payload.model ?? null,
    });
    return this.agentRepo.save(agent);
  }

  async findAll(organizationId: string): Promise<AiAgent[]> {
    return this.agentRepo.find({
      where: { organizationId },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(organizationId: string, id: string): Promise<AiAgent> {
    const agent = await this.agentRepo.findOne({
      where: { organizationId, id },
    });
    if (!agent) {
      throw new NotFoundException(`AI agent ${id} not found`);
    }
    return agent;
  }

  async update(
    organizationId: string,
    id: string,
    payload: UpdateAiAgentPayload,
  ): Promise<AiAgent> {
    const agent = await this.findOne(organizationId, id);
    if (payload.name !== undefined) agent.name = payload.name;
    if (payload.intent !== undefined)
      agent.intent = payload.intent as MessageAiIntent;
    if (payload.actionType !== undefined)
      agent.actionType = payload.actionType as AiAgent['actionType'];
    if (payload.config !== undefined) agent.config = payload.config;
    if (payload.confidenceThreshold !== undefined)
      agent.confidenceThreshold = payload.confidenceThreshold;
    if (payload.eligibleProviders !== undefined)
      agent.eligibleProviders =
        payload.eligibleProviders as AiAgent['eligibleProviders'];
    if (payload.isEnabled !== undefined) agent.isEnabled = payload.isEnabled;
    // An explicit null clears the override and returns the agent to the
    // provider default, so `undefined` (absent) and `null` (cleared) differ.
    if (payload.model !== undefined) agent.model = payload.model;
    return this.agentRepo.save(agent);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    const agent = await this.findOne(organizationId, id);
    await this.agentRepo.remove(agent);
  }

  /** The one query the dispatch activity needs — trivial thanks to the UNIQUE(organizationId, intent) constraint. */
  async findEnabledForIntent(
    organizationId: string,
    intent: MessageAiIntent,
  ): Promise<AiAgent | null> {
    return this.agentRepo.findOne({
      where: { organizationId, intent, isEnabled: true },
    });
  }
}
