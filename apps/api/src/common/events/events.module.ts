import { Global, Module } from '@nestjs/common';
import { CrmEventBusService } from './crm-event-bus.service';

@Global()
@Module({
  providers: [CrmEventBusService],
  exports: [CrmEventBusService],
})
export class EventsModule {}

export { CrmEventBusService };
