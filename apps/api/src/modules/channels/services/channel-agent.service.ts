import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CUSTOMER_AGENT_TOOLS,
  type ChannelAgentDto,
  type ChannelAgentKind,
  type ChannelAgentSkillOptionDto,
  type CreateChannelAgentPayload,
  type UpdateChannelAgentPayload,
} from '@saas/shared';
import { ChannelAgent } from '../entities/channel-agent.entity';
import { SkillRegistry } from '../skills/skill.registry';

/**
 * The agents an organization has defined: what each handles, how it behaves,
 * which model it runs on, and the tools and channels it is allowed.
 */
@Injectable()
export class ChannelAgentService {
  constructor(
    @InjectRepository(ChannelAgent)
    private readonly repo: Repository<ChannelAgent>,
    private readonly registry: SkillRegistry,
  ) {}

  /**
   * Tools an agent of this kind can be given. Staff agents take the chat
   * skills; customer agents take a short list that is safe to run for someone
   * outside the organization.
   */
  toolOptions(kind: ChannelAgentKind): ChannelAgentSkillOptionDto[] {
    if (kind === 'CUSTOMER') return [...CUSTOMER_AGENT_TOOLS];
    return this.registry
      .all()
      .filter((skill) => !skill.surfaces || skill.surfaces.includes('channel'))
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        isMutating: skill.isMutating !== false,
      }));
  }

  findAll(organizationId: string): Promise<ChannelAgent[]> {
    return this.repo.find({
      where: { organizationId },
      order: { createdAt: 'ASC' },
    });
  }

  /** Enabled agents of one kind that answer on a channel, oldest first. */
  async findEnabled(
    organizationId: string,
    kind: ChannelAgentKind,
    provider: string,
  ): Promise<ChannelAgent[]> {
    const agents = await this.repo.find({
      where: { organizationId, kind, isEnabled: true },
      order: { createdAt: 'ASC' },
    });
    return agents.filter((agent) => agent.channels.includes(provider));
  }

  async findOne(organizationId: string, id: string): Promise<ChannelAgent> {
    const agent = await this.repo.findOne({ where: { organizationId, id } });
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  async create(
    organizationId: string,
    payload: CreateChannelAgentPayload,
  ): Promise<ChannelAgent> {
    this.assertTools(payload.kind, payload.skills);
    await this.assertNameFree(organizationId, payload.name);
    return this.repo.save(
      this.repo.create({
        organizationId,
        name: payload.name,
        description: payload.description,
        instructions: payload.instructions,
        kind: payload.kind,
        provider: payload.provider ?? null,
        model: payload.model ?? null,
        skills: payload.skills,
        channels: payload.channels,
        isEnabled: payload.isEnabled,
        showStockQuantity: payload.showStockQuantity,
      }),
    );
  }

  async update(
    organizationId: string,
    id: string,
    payload: UpdateChannelAgentPayload,
  ): Promise<ChannelAgent> {
    const agent = await this.findOne(organizationId, id);
    const kind = payload.kind ?? agent.kind;
    const skills = payload.skills ?? agent.skills;
    if (payload.kind !== undefined || payload.skills !== undefined) {
      this.assertTools(kind, skills);
    }
    if (payload.name !== undefined && payload.name !== agent.name) {
      await this.assertNameFree(organizationId, payload.name);
      agent.name = payload.name;
    }
    if (payload.description !== undefined)
      agent.description = payload.description;
    if (payload.instructions !== undefined)
      agent.instructions = payload.instructions;
    agent.kind = kind;
    agent.skills = skills;
    // An explicit null returns the agent to the organization's default.
    if (payload.provider !== undefined) agent.provider = payload.provider;
    if (payload.model !== undefined) agent.model = payload.model;
    if (payload.channels !== undefined) agent.channels = payload.channels;
    if (payload.isEnabled !== undefined) agent.isEnabled = payload.isEnabled;
    if (payload.showStockQuantity !== undefined)
      agent.showStockQuantity = payload.showStockQuantity;
    return this.repo.save(agent);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    const agent = await this.findOne(organizationId, id);
    await this.repo.remove(agent);
  }

  toDto(agent: ChannelAgent): ChannelAgentDto {
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions,
      kind: agent.kind,
      model: agent.model,
      provider: agent.provider,
      skills: agent.skills,
      channels: agent.channels,
      isEnabled: agent.isEnabled,
      showStockQuantity: agent.showStockQuantity ?? false,
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
    };
  }

  private assertTools(kind: ChannelAgentKind, skills: string[]): void {
    const allowed = new Set(this.toolOptions(kind).map((tool) => tool.name));
    const unknown = skills.filter((name) => !allowed.has(name));
    if (unknown.length) {
      throw new BadRequestException(
        `${kind === 'CUSTOMER' ? 'A customer' : 'A staff'} agent cannot use: ${unknown.join(', ')}`,
      );
    }
  }

  private async assertNameFree(
    organizationId: string,
    name: string,
  ): Promise<void> {
    const taken = await this.repo.findOne({ where: { organizationId, name } });
    if (taken) {
      throw new ConflictException(`An agent called "${name}" already exists`);
    }
  }
}
