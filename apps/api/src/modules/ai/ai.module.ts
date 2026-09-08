import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiUsageLog } from './entities/ai-usage-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AiUsageLog])],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
