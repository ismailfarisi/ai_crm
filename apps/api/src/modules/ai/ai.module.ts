import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AiUsageLog } from './entities/ai-usage-log.entity';
import { AiBudget } from './entities/ai-budget.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AiUsageLog, AiBudget])],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
