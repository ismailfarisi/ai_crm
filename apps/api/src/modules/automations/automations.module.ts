import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { AutomationEventBridgeService } from './services/automation-event-bridge.service';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';
import { TemporalModule } from '../temporal/temporal.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AutomationWorkflow, AutomationExecution]),
    TemporalModule,
    AiModule,
  ],
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationEventBridgeService],
  exports: [AutomationsService, AutomationEventBridgeService],
})
export class AutomationsModule {}
