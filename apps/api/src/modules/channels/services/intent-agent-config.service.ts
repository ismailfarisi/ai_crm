import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntentAgentConfig } from '../entities/intent-agent-config.entity';
import { ChannelProviderType } from '../entities/channel-config.entity';

const DEFAULTS = {
  isEnabled: true,
  maxTurns: 5,
  replyTimeoutMinutes: 15,
  systemPrompt: null as string | null,
  eligibleProviders: [
    ChannelProviderType.TELEGRAM,
    ChannelProviderType.WHATSAPP_META,
  ],
};

export interface UpsertIntentAgentConfigInput {
  isEnabled?: boolean;
  maxTurns?: number;
  replyTimeoutMinutes?: number;
  systemPrompt?: string | null;
  /** Widened to string[] at the boundary — the zod schema (channel provider enum) already validated the values. */
  eligibleProviders?: string[];
}

@Injectable()
export class IntentAgentConfigService {
  constructor(
    @InjectRepository(IntentAgentConfig)
    private readonly repo: Repository<IntentAgentConfig>,
  ) {}

  async findOne(organizationId: string): Promise<IntentAgentConfig | null> {
    return this.repo.findOne({ where: { organizationId } });
  }

  /**
   * Always returns usable settings, even for an org whose row hasn't been
   * seeded yet — the caller (ChannelsService.processInboundWebhook) never
   * has to special-case "not configured".
   */
  async getEffective(
    organizationId: string,
  ): Promise<Pick<IntentAgentConfig, keyof typeof DEFAULTS>> {
    const row = await this.findOne(organizationId);
    return row ?? { ...DEFAULTS };
  }

  async upsert(
    organizationId: string,
    dto: UpsertIntentAgentConfigInput,
  ): Promise<IntentAgentConfig> {
    const patch = {
      ...dto,
      eligibleProviders: dto.eligibleProviders as
        ChannelProviderType[] | undefined,
    };
    let config = await this.findOne(organizationId);
    if (config) {
      Object.assign(config, patch);
    } else {
      config = this.repo.create({ organizationId, ...DEFAULTS, ...patch });
    }
    return this.repo.save(config);
  }
}
