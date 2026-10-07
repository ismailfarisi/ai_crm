import { Injectable } from '@nestjs/common';

export interface PolicyEvaluation {
  isAutonomous: boolean;
  requiresApproval: boolean;
  actionClass: 'READ' | 'DRAFT_WRITE' | 'COMMIT_MUTATION';
}

@Injectable()
export class ToolExecutionPolicyService {
  private readonly ALWAYS_REQUIRE_APPROVAL = new Set([
    'quote_send_customer',
    'sales_order_dispatch',
    'purchase_order_approve',
    'invoice_finalize',
    'record_delete',
  ]);

  evaluatePolicy(toolName: string, isMutation: boolean): PolicyEvaluation {
    if (!isMutation) {
      return {
        isAutonomous: true,
        requiresApproval: false,
        actionClass: 'READ',
      };
    }

    if (this.ALWAYS_REQUIRE_APPROVAL.has(toolName) || isMutation) {
      return {
        isAutonomous: false,
        requiresApproval: true,
        actionClass: 'COMMIT_MUTATION',
      };
    }

    return {
      isAutonomous: true,
      requiresApproval: false,
      actionClass: 'DRAFT_WRITE',
    };
  }
}
