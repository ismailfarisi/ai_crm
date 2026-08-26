import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutomationWorkflow } from '../entities/automation-workflow.entity';
import { AutomationsService } from '../automations.service';
import type { AutomationExecution } from '../entities/automation-execution.entity';

export interface CrmEventPayload {
  tenantId: string;
  eventType: string;
  entityId?: string;
  data: Record<string, any>;
}

@Injectable()
export class AutomationEventBridgeService {
  private readonly logger = new Logger(AutomationEventBridgeService.name);

  constructor(
    @InjectRepository(AutomationWorkflow)
    private readonly workflowRepo: Repository<AutomationWorkflow>,
    private readonly automationsService: AutomationsService,
  ) {}

  /**
   * Broadcasts a CRM / Business event to any active automation workflows
   * subscribed to this event type for the given tenant.
   */
  async handleCrmEvent(event: CrmEventPayload): Promise<AutomationExecution[]> {
    const { tenantId, eventType, entityId, data } = event;

    // Find all ACTIVE workflows with CRM_EVENT trigger for this tenant
    const workflows = await this.workflowRepo.find({
      where: {
        tenantId,
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
      },
    });

    const triggeredExecutions: AutomationExecution[] = [];

    for (const wf of workflows) {
      // Check if workflow trigger configuration matches this event type
      const targetEvent = wf.triggerConfig?.event || wf.triggerConfig?.eventType;
      if (!targetEvent || targetEvent === eventType || targetEvent === '*') {
        this.logger.log(
          `Triggering Automation "${wf.name}" (${wf.id}) for event ${eventType}`,
        );

        try {
          const exec = await this.automationsService.triggerExecution(
            tenantId,
            wf.id,
            {
              eventType,
              entityId,
              timestamp: new Date().toISOString(),
              payload: data,
            },
          );
          triggeredExecutions.push(exec);
        } catch (err: any) {
          this.logger.warn(
            `Failed to trigger automation "${wf.name}" for event ${eventType}: ${err.message}`,
          );
        }
      }
    }

    return triggeredExecutions;
  }
}
