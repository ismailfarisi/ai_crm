import { DynamicModule, Global, Module } from '@nestjs/common';
import { CrmEventBusService } from './crm-event-bus.service';
import { EventOutboxService, OUTBOX_DISPATCH } from './event-outbox.service';

/**
 * Imported bare, the bus writes events to the outbox but never drains it —
 * the Temporal worker uses it that way, because it does not load the
 * subscribers (AutomationsModule) and would otherwise mark events delivered to
 * nobody. `EventsModule.forRoot({ dispatch: true })` adds the dispatcher; the
 * API process, where the subscribers live, imports it like that.
 */
@Global()
@Module({
  providers: [EventOutboxService, CrmEventBusService],
  exports: [EventOutboxService, CrmEventBusService],
})
export class EventsModule {
  static forRoot(options: { dispatch: boolean }): DynamicModule {
    return {
      module: EventsModule,
      global: true,
      providers: [
        { provide: OUTBOX_DISPATCH, useValue: options.dispatch },
        EventOutboxService,
        CrmEventBusService,
      ],
      exports: [EventOutboxService, CrmEventBusService],
    };
  }
}
