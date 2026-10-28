import { Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';
import { AutomationsModule } from '../automations.module';
import { AutomationSchedulesService } from './automation-schedules.service';

/**
 * Rewrites every automation's Temporal Schedule from the database once the
 * API has booted. In the background: a slow or absent Temporal never holds up
 * boot, and `reconcile()` logs its own failures.
 */
@Injectable()
export class AutomationScheduleReconciler implements OnApplicationBootstrap {
  constructor(private readonly schedules: AutomationSchedulesService) {}

  onApplicationBootstrap(): void {
    void this.schedules.reconcile();
  }
}

/**
 * API process only: listed in `FEATURE_MODULES` (AppModule), never in
 * `WORKER_FEATURE_MODULES`. AutomationsModule itself also loads in the worker
 * (through QuotesModule), so the boot hook cannot live there.
 */
@Module({
  imports: [AutomationsModule],
  providers: [AutomationScheduleReconciler],
})
export class AutomationScheduleReconcileModule {}
