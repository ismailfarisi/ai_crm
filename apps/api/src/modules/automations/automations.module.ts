import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { AutomationEventBridgeService } from './services/automation-event-bridge.service';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';
import { TemporalModule } from '../temporal/temporal.module';
import { AiModule } from '../ai/ai.module';
import { BillingModule } from '../billing/billing.module';
import { AutomationWebhookController } from './webhooks/automation-webhook.controller';
import { AutomationWebhookService } from './webhooks/automation-webhook.service';
import { AutomationSchedulesService } from './schedules/automation-schedules.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AutomationWorkflow, AutomationExecution]),
    TemporalModule,
    AiModule,
    // Webhook runs check the organisation's subscription (no cycle: billing
    // depends only on notifications and its own tables).
    BillingModule,
  ],
  controllers: [AutomationsController, AutomationWebhookController],
  providers: [
    AutomationsService,
    AutomationEventBridgeService,
    AutomationWebhookService,
    AutomationSchedulesService,
  ],
  exports: [
    AutomationsService,
    AutomationEventBridgeService,
    AutomationSchedulesService,
  ],
})
export class AutomationsModule {}
