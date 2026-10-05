import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductionService } from '../../production/production.service';
import { ChannelsService } from '../channels.service';
import { StaffChannelIdentity } from '../entities/staff-channel-identity.entity';
import { ChannelConfig, ChannelProviderType } from '../entities/channel-config.entity';
import { ChannelConversation } from '../entities/channel-conversation.entity';
import { CHANNEL_SKILLS, type WorkOrderDto, type WorkOrderQueryPayload } from '@saas/shared';

const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

@Injectable()
export class ProductionCheckInService {
  private readonly logger = new Logger(ProductionCheckInService.name);
  private readonly lastPings = new Map<string, number>();

  constructor(
    private readonly production: ProductionService,
    private readonly channelsService: ChannelsService,
    @InjectRepository(StaffChannelIdentity)
    private readonly identityRepo: Repository<StaffChannelIdentity>,
    @InjectRepository(ChannelConfig)
    private readonly configRepo: Repository<ChannelConfig>,
    @InjectRepository(ChannelConversation)
    private readonly convRepo: Repository<ChannelConversation>,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleScheduledCheckIns(): Promise<void> {
    const activeConfigs = await this.configRepo.find({
      where: { isEnabled: true },
    });

    const orgIds = [...new Set(activeConfigs.map((c) => c.organizationId))];
    for (const orgId of orgIds) {
      try {
        await this.checkAndNotifyOrg(orgId);
      } catch (err) {
        this.logger.error(`Error during production check-in for org ${orgId}:`, err);
      }
    }
  }

  async checkAndNotifyOrg(orgId: string): Promise<number> {
    const jobs = await this.production.list(orgId, {} as WorkOrderQueryPayload, false);
    let pingsSent = 0;

    for (const job of jobs) {
      // 1. Check running operations exceeding estimated duration
      for (const op of job.operations) {
        if (op.status === 'RUNNING' && op.runningSince) {
          const runningMinutes = Math.round((Date.now() - new Date(op.runningSince).getTime()) / 60000);
          const totalEstimated = op.estimatedSetupMinutes + op.estimatedRunMinutes;

          if (totalEstimated > 0 && op.actualMinutes + runningMinutes > totalEstimated) {
            const cooldownKey = `op:${op.id}`;
            const lastPing = this.lastPings.get(cooldownKey);
            if (!lastPing || Date.now() - lastPing > COOLDOWN_MS) {
              const sent = await this.dispatchOpPing(orgId, job, op, runningMinutes, totalEstimated);
              if (sent) {
                this.lastPings.set(cooldownKey, Date.now());
                pingsSent++;
              }
            }
          }
        }
      }

      // 2. Check delayed / overdue jobs
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (job.status !== 'COMPLETE' && job.status !== 'CANCELLED' && job.dueDate && new Date(job.dueDate) < today) {
        const cooldownKey = `wo-overdue:${job.id}`;
        const lastPing = this.lastPings.get(cooldownKey);
        if (!lastPing || Date.now() - lastPing > COOLDOWN_MS) {
          const sent = await this.dispatchOverduePing(orgId, job);
          if (sent) {
            this.lastPings.set(cooldownKey, Date.now());
            pingsSent++;
          }
        }
      }
    }

    return pingsSent;
  }

  private async dispatchOpPing(
    orgId: string,
    job: WorkOrderDto,
    op: WorkOrderDto['operations'][number],
    runningMinutes: number,
    estimatedMinutes: number,
  ): Promise<boolean> {
    const recipient = await this.resolveRecipient(orgId, op.operatorId);
    if (!recipient) return false;

    const body = `⏱️ **Shop Floor Check-in:**\n**${job.woNumber}** (*${job.description}*) has been running on **${op.label}** for ${runningMinutes}m (estimated ${estimatedMinutes}m).\n\nIs this operation finished, still running, or delayed? Reply directly to update status or log time.`;

    try {
      await this.channelsService.sendMessage(orgId, recipient.userId, {
        provider: recipient.provider,
        recipient: recipient.identifier,
        body,
      });

      const ttlDate = new Date(Date.now() + 15 * 60 * 1000); // 15 mins TTL
      await this.convRepo.save(
        this.convRepo.create({
          organizationId: orgId,
          provider: recipient.provider,
          recipient: recipient.identifier,
          userId: recipient.userId,
          skillName: CHANNEL_SKILLS.WORK_ORDER_MANAGE,
          status: 'COLLECTING',
          slots: {
            workOrderNumber: job.woNumber,
            operationQuery: op.label,
          },
          expiresAt: ttlDate,
        }),
      );

      return true;
    } catch (err) {
      this.logger.warn(`Failed to dispatch check-in ping to ${recipient.identifier}:`, err);
      return false;
    }
  }

  private async dispatchOverduePing(orgId: string, job: WorkOrderDto): Promise<boolean> {
    const recipient = await this.resolveRecipient(orgId);
    if (!recipient) return false;

    const dueStr = job.dueDate ? new Date(job.dueDate).toLocaleDateString() : 'today';
    const body = `⚠️ **Overdue Job Notice:**\n**${job.woNumber}** (*${job.description}*) was due on ${dueStr} and is currently in status **${job.status}**.\n\nReply with "status of ${job.woNumber}" or update its current step.`;

    try {
      await this.channelsService.sendMessage(orgId, recipient.userId, {
        provider: recipient.provider,
        recipient: recipient.identifier,
        body,
      });
      return true;
    } catch (err) {
      this.logger.warn(`Failed to dispatch overdue ping to ${recipient.identifier}:`, err);
      return false;
    }
  }

  private async resolveRecipient(
    orgId: string,
    operatorId?: string | null,
  ): Promise<StaffChannelIdentity | null> {
    if (operatorId) {
      const match = await this.identityRepo.findOne({
        where: { organizationId: orgId, userId: operatorId },
      });
      if (match) return match;
    }

    // Fallback: any staff identity with Telegram configured for this org
    const anyStaff = await this.identityRepo.findOne({
      where: { organizationId: orgId, provider: ChannelProviderType.TELEGRAM },
    });
    return anyStaff ?? null;
  }
}
