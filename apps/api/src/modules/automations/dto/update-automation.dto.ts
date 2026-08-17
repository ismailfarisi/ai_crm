import {
  AutomationEdge,
  AutomationNode,
  AutomationTriggerType,
  UpdateAutomationWorkflowPayload,
} from '@saas/shared';

export class UpdateAutomationDto implements UpdateAutomationWorkflowPayload {
  name?: string;
  description?: string | null;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  triggerType?: AutomationTriggerType;
  triggerConfig?: Record<string, any>;
  nodes?: AutomationNode[];
  edges?: AutomationEdge[];
}
