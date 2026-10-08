import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutomationWorkflow } from '../entities/automation-workflow.entity';
import { AutomationsService } from '../automations.service';
import type { AutomationExecution } from '../entities/automation-execution.entity';
import { CrmEventBusService } from '@/common/events';
import type { CrmDomainEvent } from '@saas/shared';

export interface CrmEventPayload {
  tenantId: string;
  eventType: string;
  entityId?: string;
  data: Record<string, any>;
}

@Injectable()
export class AutomationEventBridgeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutomationEventBridgeService.name);
  private unsubscribeBus?: () => void;

  constructor(
    @InjectRepository(AutomationWorkflow)
    private readonly workflowRepo: Repository<AutomationWorkflow>,
    private readonly automationsService: AutomationsService,
    @Optional()
    private readonly crmEventBusService?: CrmEventBusService,
  ) {}

  onModuleInit(): void {
    if (this.crmEventBusService) {
      this.unsubscribeBus = this.crmEventBusService.subscribe(
        async (event: CrmDomainEvent) => {
          await this.handleDomainEvent(event);
        },
      );
    }
  }

  onModuleDestroy(): void {
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = undefined;
    }
  }

  /**
   * Matches the workflow's configured event against the incoming domain event.
   * Supports:
   * - Wildcard '*'
   * - Exact eventType (e.g. 'record.created')
   * - Target event with entity name prefix (e.g. 'contact.created' or 'CONTACT_CREATED')
   */
  private matchesEvent(
    triggerConfig: Record<string, any> | undefined,
    event: CrmDomainEvent,
  ): boolean {
    const targetEvent = triggerConfig?.event || triggerConfig?.eventType;
    if (!targetEvent || targetEvent === '*') {
      return true;
    }

    const t = String(targetEvent).toLowerCase().trim();
    const e = String(event.eventType).toLowerCase().trim();

    if (t === e) {
      return true;
    }

    // Match entityName.action or entityName_action
    // e.g. if event is record.created and entityName is contact:
    // targetEvent can be 'contact.created' or 'contact_created' / 'CONTACT_CREATED'
    if (event.eventType.includes('.')) {
      const parts = event.eventType.split('.');
      const action = parts[parts.length - 1].toLowerCase();
      const entityName = (event.entityName || '').toLowerCase();
      if (t === `${entityName}.${action}` || t === `${entityName}_${action}`) {
        return true;
      }
    }

    // Match if eventType is already uppercase underscore (e.g. QUOTE_CREATED)
    if (event.eventType.includes('_')) {
      const parts = event.eventType.split('_');
      const action = parts[parts.length - 1].toLowerCase();
      const entity = parts.slice(0, -1).join('_').toLowerCase();
      if (t === `${entity}.${action}` || t === `${entity}_${action}`) {
        return true;
      }
    }

    return false;
  }

  /**
   * Matches entityName and entityType filters if specified in triggerConfig.
   */
  private matchesEntity(
    triggerConfig: Record<string, any> | undefined,
    event: CrmDomainEvent,
  ): boolean {
    if (triggerConfig?.entityName) {
      if (
        String(triggerConfig.entityName).toLowerCase() !==
        String(event.entityName).toLowerCase()
      ) {
        return false;
      }
    }

    if (triggerConfig?.entityType) {
      if (
        String(triggerConfig.entityType).toLowerCase() !==
        String(event.entityType).toLowerCase()
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Matches field-level difference conditions.
   * If fields or changedFields is configured as a non-empty array,
   * requires at least one changed field in event.snapshot.changedFields to match.
   */
  private matchesFieldDiff(
    triggerConfig: Record<string, any> | undefined,
    event: CrmDomainEvent,
  ): boolean {
    const configuredFields =
      triggerConfig?.fields || triggerConfig?.changedFields;

    if (Array.isArray(configuredFields) && configuredFields.length > 0) {
      const changed = event.snapshot?.changedFields ?? [];
      const hasMatch = configuredFields.some((field: string) =>
        changed.includes(field),
      );
      if (!hasMatch) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluates attribute condition filters against the entity's after/current state.
   */
  private matchesAttributeConditions(
    triggerConfig: Record<string, any> | undefined,
    event: CrmDomainEvent,
  ): boolean {
    const conditions = triggerConfig?.conditions ?? triggerConfig?.filter;
    if (!conditions) {
      return true;
    }

    const state = event.snapshot?.after ?? event.snapshot?.before ?? {};

    // Condition array: [{ field: 'status', operator?: 'equals', value: 'CUSTOMER' }]
    if (Array.isArray(conditions)) {
      return conditions.every((cond: any) => {
        if (!cond || typeof cond !== 'object') {
          return true;
        }

        const field = cond.field ?? cond.key ?? cond.property;
        if (field !== undefined) {
          const actualVal = state[field];
          const expectedVal = cond.value;
          const op = (cond.operator ?? cond.op ?? 'equals').toLowerCase();

          switch (op) {
            case 'equals':
            case 'eq':
            case '==':
            case '===':
              return actualVal === expectedVal;
            case 'not_equals':
            case 'ne':
            case '!=':
            case '!==':
              return actualVal !== expectedVal;
            case 'contains':
              return (
                typeof actualVal === 'string' &&
                actualVal.includes(String(expectedVal))
              );
            case 'in':
              return (
                Array.isArray(expectedVal) && expectedVal.includes(actualVal)
              );
            case 'gt':
            case '>':
              return actualVal > expectedVal;
            case 'gte':
            case '>=':
              return actualVal >= expectedVal;
            case 'lt':
            case '<':
              return actualVal < expectedVal;
            case 'lte':
            case '<=':
              return actualVal <= expectedVal;
            default:
              return actualVal === expectedVal;
          }
        }

        // Direct object key-value condition in array
        for (const [k, v] of Object.entries(cond)) {
          if (state[k] !== v) {
            return false;
          }
        }
        return true;
      });
    }

    // Condition object: { status: 'CUSTOMER' }
    if (typeof conditions === 'object') {
      for (const [k, v] of Object.entries(conditions)) {
        if (state[k] !== v) {
          return false;
        }
      }
      return true;
    }

    return true;
  }

  /**
   * Handles an incoming CRM domain event, evaluates trigger filters across
   * active workflows for the tenant, and dispatches executions.
   */
  async handleDomainEvent(
    event: CrmDomainEvent,
  ): Promise<AutomationExecution[]> {
    const workflows = await this.workflowRepo.find({
      where: {
        tenantId: event.tenantId,
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
      },
    });

    const triggeredExecutions: AutomationExecution[] = [];

    for (const wf of workflows) {
      const config = wf.triggerConfig;

      // 1. Event matching
      if (!this.matchesEvent(config, event)) {
        continue;
      }

      // 2. Entity matching
      if (!this.matchesEntity(config, event)) {
        continue;
      }

      // 3. Field-level diff matching
      if (!this.matchesFieldDiff(config, event)) {
        continue;
      }

      // 4. Attribute condition filters
      if (!this.matchesAttributeConditions(config, event)) {
        continue;
      }

      this.logger.log(
        `Triggering Automation "${wf.name}" (${wf.id}) for domain event "${event.eventType}" on ${event.entityName}:${event.entityId}`,
      );

      try {
        const exec = await this.automationsService.triggerExecution(
          event.tenantId,
          wf.id,
          {
            eventType: event.eventType,
            entityId: event.entityId,
            timestamp: event.timestamp,
            payload: event.snapshot?.after ?? event.snapshot?.before ?? {},
            snapshot: event.snapshot,
            event,
          },
        );
        if (exec) {
          triggeredExecutions.push(exec);
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to trigger automation "${wf.name}" (${wf.id}) for domain event ${event.eventType}: ${err.message}`,
        );
      }
    }

    return triggeredExecutions;
  }

  /**
   * Broadcasts a legacy CRM / Business event to any active automation workflows
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
      const targetEvent =
        wf.triggerConfig?.event || wf.triggerConfig?.eventType;
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
          if (exec) {
            triggeredExecutions.push(exec);
          }
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
