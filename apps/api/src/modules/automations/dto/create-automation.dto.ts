import {
  AutomationEdge,
  AutomationNode,
  AutomationTriggerType,
  CreateAutomationWorkflowPayload,
} from '@saas/shared';

export class CreateAutomationDto implements CreateAutomationWorkflowPayload {
  name: string;
  description?: string | null;
  triggerType: AutomationTriggerType;
  triggerConfig?: Record<string, any>;
  nodes?: AutomationNode[];
  edges?: AutomationEdge[];
}
