// assistant-sweep.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { TemporalService } from '../temporal/temporal.service';
import { AssistantTurn } from './entities/assistant-turn.entity';
import { AssistantEventsService } from './assistant-events.service';

// Longer than the commit activity's 5-minute timeout, which runs with nothing to emit.
const STALE_AFTER_MS = 7 * 60_000;

/** A RUNNING turn with no event for 7 minutes has lost its worker. Approval waits are exempt. */
@Injectable()
export class AssistantSweepService {
  private readonly logger = new Logger(AssistantSweepService.name);

  constructor(
    @InjectRepository(AssistantTurn) private readonly turns: Repository<AssistantTurn>,
    private readonly temporal: TemporalService,
    private readonly events: AssistantEventsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run() {
    const swept = await this.sweep();
    if (swept) this.logger.warn(`Marked ${swept} stale assistant turn(s) FAILED`);
  }

  async sweep(now = new Date()): Promise<number> {
    return this.tenantContext.runAsSystem(async () => {
      const stale = await this.turns.find({
        where: { status: 'RUNNING', lastProgressAt: LessThan(new Date(now.getTime() - STALE_AFTER_MS)) },
        take: 100,
      });
      let count = 0;
      for (const turn of stale) {
        const { affected } = await this.turns.update(
          { id: turn.id, status: 'RUNNING' },
          { status: 'FAILED', error: 'The assistant stopped responding', finishedAt: now },
        );
        if (!affected) continue;
        count++;
        await this.temporal.getClient().workflow.getHandle(turn.workflowId).terminate('stale assistant turn').catch(() => undefined);
        await this.tenantContext.runWithTenant(turn.tenantId, () => this.events.writeStatus(turn, 'swept:status'));
      }
      return count;
    });
  }
}
