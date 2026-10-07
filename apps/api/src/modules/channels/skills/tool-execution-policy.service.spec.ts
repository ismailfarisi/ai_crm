import { ToolExecutionPolicyService } from './tool-execution-policy.service';

describe('ToolExecutionPolicyService', () => {
  let policyService: ToolExecutionPolicyService;

  beforeEach(() => {
    policyService = new ToolExecutionPolicyService();
  });

  it('marks read-only tools as autonomous with no approval needed', () => {
    const result = policyService.evaluatePolicy('crm_search_customer', false);
    expect(result.isAutonomous).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.actionClass).toBe('READ');
  });

  it('marks mutating state-changing tools as requiring two-phase approval', () => {
    const result = policyService.evaluatePolicy('quote_create', true);
    expect(result.isAutonomous).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.actionClass).toBe('COMMIT_MUTATION');
  });

  it('marks sensitive mutation tools from ALWAYS_REQUIRE_APPROVAL as requiring approval', () => {
    const sensitiveTools = [
      'quote_send_customer',
      'sales_order_dispatch',
      'purchase_order_approve',
      'invoice_finalize',
      'record_delete',
    ];

    for (const tool of sensitiveTools) {
      const result = policyService.evaluatePolicy(tool, true);
      expect(result.isAutonomous).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.actionClass).toBe('COMMIT_MUTATION');
    }
  });
});
