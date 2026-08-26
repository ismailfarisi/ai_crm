// Setup mocks before imports
const mockHandlers = new Map<any, Function>();
const mockActivities = {
  postJournalEntryActivity: jest.fn().mockResolvedValue({
    id: 'je-mock-123',
    entryNumber: 'JE-2026-001',
    success: true,
    totalAmount: 100,
  }),
  updateBudgetSpendActivity: jest.fn().mockResolvedValue({
    success: true,
    category: 'TRAVEL',
    amountAdded: 100,
  }),
  emitFinanceEventActivity: jest.fn().mockResolvedValue({
    emitted: true,
    event: 'EXPENSE_APPROVED',
    timestamp: new Date().toISOString(),
  }),
  deductAccountBalanceActivity: jest.fn().mockResolvedValue({
    success: true,
    accountId: 'acc-mock-bank',
    amountDeducted: 100,
  }),
  updateExpenseStatusActivity: jest.fn().mockResolvedValue({
    success: true,
    expenseId: 'exp-mock-1',
    status: 'APPROVED',
  }),
};

jest.mock('@temporalio/workflow', () => {
  return {
    proxyActivities: () => ({
      postJournalEntryActivity: (...args: any[]) =>
        (global as any).__mockActivities.postJournalEntryActivity(...args),
      updateBudgetSpendActivity: (...args: any[]) =>
        (global as any).__mockActivities.updateBudgetSpendActivity(...args),
      emitFinanceEventActivity: (...args: any[]) =>
        (global as any).__mockActivities.emitFinanceEventActivity(...args),
      deductAccountBalanceActivity: (...args: any[]) =>
        (global as any).__mockActivities.deductAccountBalanceActivity(...args),
      updateExpenseStatusActivity: (...args: any[]) =>
        (global as any).__mockActivities.updateExpenseStatusActivity(...args),
    }),
    setHandler: (def: any, handler: Function) => {
      (global as any).__mockHandlers.set(def, handler);
    },
    condition: jest.fn().mockImplementation(async (predicate: () => boolean) => {
      return predicate();
    }),
    sleep: jest.fn().mockResolvedValue(undefined),
    defineSignal: (name: string) => ({ name, type: 'signal' }),
    defineQuery: (name: string) => ({ name, type: 'query' }),
  };
});

(global as any).__mockActivities = mockActivities;
(global as any).__mockHandlers = mockHandlers;

import { expenseApprovalWorkflow } from './expense-approval.workflow';
import {
  approveExpenseSignal,
  rejectExpenseSignal,
  reimburseExpenseSignal,
  getExpenseWorkflowStateQuery,
  ExpenseWorkflowInput,
} from './interfaces';
import {
  postJournalEntryActivity,
  updateBudgetSpendActivity,
  emitFinanceEventActivity,
  deductAccountBalanceActivity,
  updateExpenseStatusActivity,
} from './activities/expense.activities';

describe('ExpenseApprovalWorkflow & Activities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHandlers.clear();
  });

  describe('expenseApprovalWorkflow', () => {
    it('should auto-approve when claim amount is under auto-approve threshold ($50)', async () => {
      const input: ExpenseWorkflowInput = {
        expenseId: 'exp-auto-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-101',
        employeeName: 'Alice Smith',
        category: 'MEALS',
        amount: 35.5,
        currency: 'USD',
      };

      const result = await expenseApprovalWorkflow(input);

      expect(result.status).toBe('APPROVED');
      expect(result.isAutoApproved).toBe(true);
      expect(mockActivities.updateExpenseStatusActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          expenseId: 'exp-auto-1',
          tenantId: 'tenant-1',
          status: 'APPROVED',
          approvedById: 'SYSTEM_AUTO_APPROVE',
        }),
      );
      expect(mockActivities.postJournalEntryActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          referenceType: 'EXPENSE',
          referenceId: 'exp-auto-1',
          totalAmount: 35.5,
          lines: expect.arrayContaining([
            expect.objectContaining({ accountName: 'MEALS', debit: 35.5 }),
            expect.objectContaining({ accountName: 'Accounts Payable', credit: 35.5 }),
          ]),
        }),
      );
      expect(mockActivities.updateBudgetSpendActivity).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        category: 'MEALS',
        amount: 35.5,
      });
      expect(mockActivities.emitFinanceEventActivity).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        event: 'EXPENSE_APPROVED',
        payload: expect.objectContaining({
          expenseId: 'exp-auto-1',
          amount: 35.5,
          category: 'MEALS',
          isAutoApproved: true,
        }),
      });
    });

    it('should handle approveExpenseSignal and trigger journal posting & EXPENSE_APPROVED event', async () => {
      const { condition } = require('@temporalio/workflow');

      const input: ExpenseWorkflowInput = {
        expenseId: 'exp-manual-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-102',
        employeeName: 'Bob Jones',
        category: 'TRAVEL',
        amount: 350.0,
        currency: 'USD',
      };

      (condition as jest.Mock).mockImplementationOnce(async (predicate) => {
        const handler = mockHandlers.get(approveExpenseSignal);
        expect(handler).toBeDefined();
        handler({ approvedBy: 'usr-mgr-99', notes: 'Client onsite travel' });
        return predicate();
      });

      const result = await expenseApprovalWorkflow(input);

      expect(result.status).toBe('APPROVED');
      expect(result.isAutoApproved).toBe(false);
      expect(result.approvedBy).toBe('usr-mgr-99');
      expect(mockActivities.updateExpenseStatusActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          expenseId: 'exp-manual-1',
          status: 'SUBMITTED',
        }),
      );
      expect(mockActivities.updateExpenseStatusActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          expenseId: 'exp-manual-1',
          status: 'APPROVED',
          approvedById: 'usr-mgr-99',
        }),
      );
      expect(mockActivities.postJournalEntryActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceType: 'EXPENSE',
          referenceId: 'exp-manual-1',
          totalAmount: 350.0,
        }),
      );
      expect(mockActivities.updateBudgetSpendActivity).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        category: 'TRAVEL',
        amount: 350.0,
      });
      expect(mockActivities.emitFinanceEventActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'EXPENSE_APPROVED',
          payload: expect.objectContaining({
            expenseId: 'exp-manual-1',
            approvedBy: 'usr-mgr-99',
          }),
        }),
      );
    });

    it('should handle rejectExpenseSignal with rejection reason and skip journal posting', async () => {
      const { condition } = require('@temporalio/workflow');

      const input: ExpenseWorkflowInput = {
        expenseId: 'exp-rej-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-103',
        employeeName: 'Charlie Brown',
        category: 'SOFTWARE',
        amount: 500.0,
        currency: 'USD',
      };

      (condition as jest.Mock).mockImplementationOnce(async (predicate) => {
        const handler = mockHandlers.get(rejectExpenseSignal);
        expect(handler).toBeDefined();
        handler({ rejectedBy: 'usr-cfo-1', reason: 'Unapproved license subscription' });
        return predicate();
      });

      const result = await expenseApprovalWorkflow(input);

      expect(result.status).toBe('REJECTED');
      expect(result.reason).toBe('Unapproved license subscription');
      expect(mockActivities.updateExpenseStatusActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          expenseId: 'exp-rej-1',
          status: 'REJECTED',
          rejectionReason: 'Unapproved license subscription',
        }),
      );
      expect(mockActivities.emitFinanceEventActivity).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        event: 'EXPENSE_REJECTED',
        payload: expect.objectContaining({
          expenseId: 'exp-rej-1',
          reason: 'Unapproved license subscription',
        }),
      });
      expect(mockActivities.postJournalEntryActivity).not.toHaveBeenCalled();
      expect(mockActivities.updateBudgetSpendActivity).not.toHaveBeenCalled();
    });

    it('should handle SLA timeout (7 days default) and mark expense REJECTED', async () => {
      const { condition } = require('@temporalio/workflow');

      const input: ExpenseWorkflowInput = {
        expenseId: 'exp-timeout-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-104',
        employeeName: 'David Miller',
        category: 'HARDWARE',
        amount: 1200.0,
        currency: 'USD',
        slaDuration: '7 days',
      };

      // Condition returns false representing SLA expiration
      (condition as jest.Mock).mockResolvedValueOnce(false);

      const result = await expenseApprovalWorkflow(input);

      expect(result.status).toBe('REJECTED');
      expect(result.reason).toContain('timed out');
      expect(mockActivities.updateExpenseStatusActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          expenseId: 'exp-timeout-1',
          status: 'REJECTED',
        }),
      );
      expect(mockActivities.emitFinanceEventActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'EXPENSE_REJECTED',
        }),
      );
      expect(mockActivities.postJournalEntryActivity).not.toHaveBeenCalled();
    });

    it('should handle reimburseExpenseSignal by deducting account balance and marking PAID', async () => {
      const { condition } = require('@temporalio/workflow');

      const input: ExpenseWorkflowInput = {
        expenseId: 'exp-paid-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-105',
        employeeName: 'Eve Davis',
        category: 'MARKETING',
        amount: 250.0,
        currency: 'USD',
      };

      // 1st condition: approve
      (condition as jest.Mock).mockImplementationOnce(async (predicate) => {
        const approveHandler = mockHandlers.get(approveExpenseSignal);
        approveHandler({ approvedBy: 'usr-mgr-1' });
        return predicate();
      });

      // 2nd condition: reimburse
      (condition as jest.Mock).mockImplementationOnce(async (predicate) => {
        const reimburseHandler = mockHandlers.get(reimburseExpenseSignal);
        expect(reimburseHandler).toBeDefined();
        reimburseHandler({ accountId: 'acc-bank-primary', reimbursedBy: 'usr-treasury-1' });
        return predicate();
      });

      const result = await expenseApprovalWorkflow(input);

      expect(result.status).toBe('PAID');
      expect(result.paidFromAccountId).toBe('acc-bank-primary');
      expect(mockActivities.deductAccountBalanceActivity).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        accountId: 'acc-bank-primary',
        amount: 250.0,
        currency: 'USD',
        description: expect.stringContaining('exp-paid-1'),
      });
      expect(mockActivities.updateExpenseStatusActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          expenseId: 'exp-paid-1',
          status: 'PAID',
        }),
      );
      expect(mockActivities.emitFinanceEventActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'EXPENSE_PAID',
          payload: expect.objectContaining({
            expenseId: 'exp-paid-1',
            paidFromAccountId: 'acc-bank-primary',
          }),
        }),
      );
    });

    it('should support getExpenseWorkflowStateQuery query handler', async () => {
      const input: ExpenseWorkflowInput = {
        expenseId: 'exp-query-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-106',
        employeeName: 'Frank White',
        category: 'OFFICE',
        amount: 150.0,
        currency: 'USD',
      };

      const workflowPromise = expenseApprovalWorkflow(input);

      const queryHandler = mockHandlers.get(getExpenseWorkflowStateQuery);
      expect(queryHandler).toBeDefined();

      const currentState = queryHandler();
      expect(currentState.expenseId).toBe('exp-query-1');
      expect(currentState.tenantId).toBe('tenant-1');
      expect(currentState.amount).toBe(150.0);
      expect(currentState.category).toBe('OFFICE');

      const result = await workflowPromise;
      expect(result).toBeDefined();
    });

    it('should respect custom autoApproveThreshold parameter', async () => {
      const input: ExpenseWorkflowInput = {
        expenseId: 'exp-custom-thresh-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-107',
        employeeName: 'Grace Hopper',
        category: 'TRAINING',
        amount: 150.0,
        autoApproveThreshold: 200.0,
      };

      const result = await expenseApprovalWorkflow(input);

      expect(result.status).toBe('APPROVED');
      expect(result.isAutoApproved).toBe(true);
      expect(mockActivities.postJournalEntryActivity).toHaveBeenCalled();
    });
  });

  describe('Expense Activities Unit Execution', () => {
    it('postJournalEntryActivity should generate entryNumber and return valid response', async () => {
      const res = await postJournalEntryActivity({
        tenantId: 'tenant-1',
        referenceType: 'EXPENSE',
        referenceId: 'exp-1',
        lines: [
          { accountName: 'MEALS', debit: 50, credit: 0, description: 'Lunch' },
          { accountName: 'Accounts Payable', debit: 0, credit: 50, description: 'Payable' },
        ],
        totalAmount: 50,
      });

      expect(res.success).toBe(true);
      expect(res.id).toBeDefined();
      expect(res.entryNumber).toBeDefined();
      expect(res.totalAmount).toBe(50);
    });

    it('updateBudgetSpendActivity should record category budget spend', async () => {
      const res = await updateBudgetSpendActivity({
        tenantId: 'tenant-1',
        category: 'MEALS',
        amount: 50,
      });

      expect(res.success).toBe(true);
      expect(res.category).toBe('MEALS');
      expect(res.amountAdded).toBe(50);
    });

    it('emitFinanceEventActivity should emit event and return timestamp', async () => {
      const res = await emitFinanceEventActivity({
        tenantId: 'tenant-1',
        event: 'EXPENSE_APPROVED',
        payload: { expenseId: 'exp-1' },
      });

      expect(res.emitted).toBe(true);
      expect(res.event).toBe('EXPENSE_APPROVED');
      expect(res.timestamp).toBeDefined();
    });

    it('deductAccountBalanceActivity should deduct balance', async () => {
      const res = await deductAccountBalanceActivity({
        tenantId: 'tenant-1',
        accountId: 'acc-1',
        amount: 50,
      });

      expect(res.success).toBe(true);
      expect(res.accountId).toBe('acc-1');
      expect(res.amountDeducted).toBe(50);
    });

    it('updateExpenseStatusActivity should record status update', async () => {
      const res = await updateExpenseStatusActivity({
        expenseId: 'exp-1',
        tenantId: 'tenant-1',
        status: 'APPROVED',
      });

      expect(res.success).toBe(true);
      expect(res.expenseId).toBe('exp-1');
      expect(res.status).toBe('APPROVED');
    });
  });
});
