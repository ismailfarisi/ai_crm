import type { TenantContextService } from '@/common/context/tenant-context.service';
import type { AssistantEventInput } from '../channels/workflows/activities/agent-react.activities';
import type { AssistantEventsService } from './assistant-events.service';

export function createAssistantActivities(deps: {
  events: AssistantEventsService;
  tenantContext: TenantContextService;
}) {
  return {
    async emitAssistantEventActivity(input: AssistantEventInput): Promise<void> {
      await deps.tenantContext.runWithTenant(input.organizationId, () => deps.events.emit(input));
    },
  };
}
