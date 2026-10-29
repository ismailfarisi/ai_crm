import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { AutomationEventBridgeService } from './services/automation-event-bridge.service';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';
import { AutomationApproval } from './entities/automation-approval.entity';
import { TemporalModule } from '../temporal/temporal.module';
import { AiModule } from '../ai/ai.module';
import { BillingModule } from '../billing/billing.module';
import { AutomationWebhookController } from './webhooks/automation-webhook.controller';
import { AutomationWebhookService } from './webhooks/automation-webhook.service';
import { AutomationSchedulesService } from './schedules/automation-schedules.service';
import { AutomationApprovalsController } from './approvals/automation-approvals.controller';
import { AutomationApprovalsService } from './approvals/automation-approvals.service';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AutomationWorkflow,
      AutomationExecution,
      AutomationApproval,
      // Read-only, for the names of whoever decided an approval.
      User,
    ]),
    TemporalModule,
    AiModule,
    // Webhook runs check the organisation's subscription (no cycle: billing
    // depends only on notifications and its own tables).
    BillingModule,
  ],
  controllers: [
    AutomationsController,
    AutomationWebhookController,
    AutomationApprovalsController,
  ],
  providers: [
    AutomationsService,
    AutomationEventBridgeService,
    AutomationWebhookService,
    AutomationSchedulesService,
    AutomationApprovalsService,
  ],
  exports: [
    AutomationsService,
    AutomationEventBridgeService,
    AutomationSchedulesService,
  ],
})
export class AutomationsModule {}
