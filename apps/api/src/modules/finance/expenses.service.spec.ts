import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { ExpensesService } from './expenses.service';
import { ExpenseClaim } from './entities/expense-claim.entity';
import { FinanceAccount } from './entities/finance-account.entity';
import { CategoryBudget } from './entities/category-budget.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { LedgerService } from './ledger.service';
import { TemporalService } from '../temporal/temporal.service';
import { AiService } from '../ai/ai.service';
import { AiNotConfiguredException } from '../ai/interfaces/ai-provider.interface';
import { AiBudgetExceededException } from '../ai/exceptions/ai-budget-exceeded.exception';
import {
  CreateExpenseClaimDto,
  UpdateExpenseClaimDto,
  SignalExpenseDto,
  ScanReceiptDto,
} from './dto';

describe('ExpensesService', () => {
  let service: ExpensesService;
  let expenseRepo: jest.Mocked<Partial<Repository<ExpenseClaim>>>;
  let accountRepo: jest.Mocked<Partial<Repository<FinanceAccount>>>;
  let budgetRepo: jest.Mocked<Partial<Repository<CategoryBudget>>>;
  let journalRepo: jest.Mocked<Partial<Repository<JournalEntry>>>;
  let temporalService: jest.Mocked<Partial<TemporalService>>;
  let aiService: jest.Mocked<Partial<AiService>>;
  let ledgerService: jest.Mocked<Partial<LedgerService>>;
  let mockWorkflowHandle: any;
  let claimSequenceValue: number;
  let txManager: { getRepository: jest.Mock; query: jest.Mock };
  let events: string[];

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const expenseId = '22222222-2222-2222-2222-222222222222';
  const actor = { organizationId: tenantId, userId: 'user-1' };

  beforeEach(() => {
    mockWorkflowHandle = {
      workflowId: `expense-${expenseId}`,
      signal: jest.fn().mockResolvedValue(undefined),
    };

    claimSequenceValue = 0;
    expenseRepo = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => ({
        id: expenseId,
        createdAt: new Date('2026-08-17T00:00:00Z'),
        updatedAt: new Date('2026-08-17T00:00:00Z'),
        ...dto,
      })),
      save: jest.fn().mockImplementation(async (exp) => ({
        id: expenseId,
        ...exp,
      })),
      manager: {
        query: jest.fn().mockImplementation(async () => {
          claimSequenceValue += 1;
          return [{ current_value: claimSequenceValue }];
        }),
        // The organization, read for its base currency.
        getRepository: jest.fn(() => ({
          findOne: jest.fn().mockResolvedValue({ baseCurrency: 'USD' }),
        })),
      } as any,
    };

    accountRepo = {
      // A reimbursement has to leave a real account, so there is one to leave.
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'acc-1', name: 'Operating', balance: 5000 }),
      find: jest
        .fn()
        .mockResolvedValue([{ id: 'acc-1', name: 'Operating', balance: 5000 }]),
      save: jest.fn().mockImplementation(async (a) => a),
    };

    budgetRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async (b) => b),
    };

    journalRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'je-1', ...dto })),
      save: jest.fn().mockImplementation(async (j) => j),
      // Nothing posted yet, so the idempotency check always finds nothing.
      findOne: jest.fn().mockResolvedValue(null),
    };

    // A signal's writes happen inside one transaction. The fake hands its
    // callback a manager distinct from the repositories' own, records when
    // the transaction "commits", and rethrows so a failure rolls back.
    events = [];
    txManager = {
      getRepository: jest.fn((entity: { name: string }) => {
        if (entity.name === 'ExpenseClaim') return expenseRepo;
        if (entity.name === 'FinanceAccount') return accountRepo;
        return journalRepo;
      }),
      query: jest.fn().mockResolvedValue([]),
    };
    (expenseRepo.manager as any).transaction = jest.fn(
      async (work: (m: unknown) => unknown) => {
        const result = await work(txManager);
        events.push('commit');
        return result;
      },
    );
    mockWorkflowHandle.signal.mockImplementation(async () => {
      events.push('signal');
    });

    temporalService = {
      getClient: jest.fn().mockResolvedValue({
        workflow: {
          start: jest.fn().mockResolvedValue(mockWorkflowHandle),
          getHandle: jest.fn().mockReturnValue(mockWorkflowHandle),
        },
      } as any),
    };

    aiService = {
      generateStructured: jest.fn(),
    };

    // Approval and reimbursement post through the ledger now, so the double
    // entry has to be resolvable here. Echoing the lines back is enough: the
    // service's own arithmetic is what these tests are about.
    ledgerService = {
      resolveLines: jest
        .fn()
        .mockImplementation(async (_tenantId, lines) => lines),
      provisionChartOfAccounts: jest.fn().mockResolvedValue([]),
    };

    service = new ExpensesService(
      expenseRepo as unknown as Repository<ExpenseClaim>,
      accountRepo as unknown as Repository<FinanceAccount>,
      budgetRepo as unknown as Repository<CategoryBudget>,
      journalRepo as unknown as Repository<JournalEntry>,
      temporalService as unknown as TemporalService,
      aiService as unknown as AiService,
      ledgerService as unknown as LedgerService,
    );
  });

  describe('findAll and findById', () => {
    it('returns all expenses ordered by createdAt DESC', async () => {
      const claims = [{ id: '1' }, { id: '2' }] as ExpenseClaim[];
      expenseRepo.find = jest.fn().mockResolvedValue(claims);

      const res = await service.findAll(tenantId);
      expect(res).toBe(claims);
      expect(expenseRepo.find).toHaveBeenCalledWith({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns claim by ID', async () => {
      const claim = { id: expenseId, tenantId, amount: 150 } as ExpenseClaim;
      expenseRepo.findOne = jest.fn().mockResolvedValue(claim);

      const res = await service.findById(tenantId, expenseId);
      expect(res).toBe(claim);
      expect(expenseRepo.findOne).toHaveBeenCalledWith({
        where: { id: expenseId, tenantId },
      });
    });

    it('throws NotFoundException when claim is not found', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue(null);
      await expect(
        service.findById(tenantId, 'non-existent'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates expense claim with sequential claim number and starts Temporal workflow', async () => {
      claimSequenceValue = 4;

      const dto: CreateExpenseClaimDto = {
        category: 'Travel',
        amount: 250,
        currency: 'USD',
        merchantName: 'Delta Air Lines',
        expenseDate: '2026-08-15',
        employeeId: 'emp-101',
        employeeName: 'Sarah Connor',
        items: [
          {
            description: 'Flight to SFO',
            quantity: 1,
            unitPrice: 250,
            amount: 250,
          },
        ],
      };

      const result = await service.create(tenantId, dto);

      const currentYear = new Date().getFullYear();
      expect(expenseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          claimNumber: `EXP-${currentYear}-0005`,
          category: 'Travel',
          amount: 250,
          employeeId: 'emp-101',
          employeeName: 'Sarah Connor',
          merchantName: 'Delta Air Lines',
          status: 'SUBMITTED',
        }),
      );
      expect(result.temporalWorkflowId).toBe(`expense-${expenseId}`);
    });

    it('handles Temporal server offline gracefully during creation', async () => {
      temporalService.getClient = jest.fn().mockResolvedValue({
        workflow: {
          start: jest
            .fn()
            .mockRejectedValue(new Error('Temporal connection failed')),
        },
      } as any);

      const dto: CreateExpenseClaimDto = {
        category: 'Meals',
        amount: 35,
        employeeId: 'emp-1',
        employeeName: 'John Doe',
      };

      const result = await service.create(tenantId, dto);
      expect(result.temporalWorkflowId).toBe(`expense-${expenseId}`);
      expect(expenseRepo.save).toHaveBeenCalled();
    });

    it('keeps the notes the claimant wrote, trimmed', async () => {
      const result = await service.create(tenantId, {
        category: 'Meals & Entertainment',
        amount: 120,
        notes: '  Lunch with the Al Futtaim site team after the survey.  ',
      });

      expect(expenseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: 'Lunch with the Al Futtaim site team after the survey.',
        }),
      );
      expect(result.notes).toBe(
        'Lunch with the Al Futtaim site team after the survey.',
      );
    });

    it('stores blank notes as none rather than an empty string', async () => {
      await service.create(tenantId, {
        category: 'Consumables',
        amount: 40,
        notes: '   ',
      });
      expect(expenseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ notes: null }),
      );
    });

    it('refuses notes longer than a paragraph', async () => {
      await expect(
        service.create(tenantId, {
          category: 'Consumables',
          amount: 40,
          notes: 'x'.repeat(2001),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(expenseRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates expense claim properties', async () => {
      const existing = {
        id: expenseId,
        tenantId,
        category: 'Meals',
        amount: 30,
      } as ExpenseClaim;
      expenseRepo.findOne = jest.fn().mockResolvedValue(existing);

      const updateDto: UpdateExpenseClaimDto = {
        category: 'Meals & Entertainment',
        amount: 45,
        merchantName: 'Starbucks',
      };

      const updated = await service.update(tenantId, expenseId, updateDto);
      expect(expenseRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'Meals & Entertainment',
          amount: 45,
          merchantName: 'Starbucks',
        }),
      );
      expect(updated.category).toBe('Meals & Entertainment');
    });

    it('updates the notes, and clears them when sent blank', async () => {
      expenseRepo.findOne = jest
        .fn()
        .mockResolvedValue({ id: expenseId, tenantId, notes: 'Old' });

      const updated = await service.update(tenantId, expenseId, {
        notes: ' Fuel for the delivery van ',
      });
      expect(updated.notes).toBe('Fuel for the delivery van');

      const cleared = await service.update(tenantId, expenseId, { notes: '' });
      expect(cleared.notes).toBeNull();
    });
  });

  describe('sendSignal', () => {
    it('signals APPROVE and updates status to APPROVED', async () => {
      const existing = {
        id: expenseId,
        tenantId,
        status: 'SUBMITTED',
        temporalWorkflowId: `expense-${expenseId}`,
      } as ExpenseClaim;
      expenseRepo.findOne = jest.fn().mockResolvedValue({ ...existing });

      const signalDto: SignalExpenseDto = {
        action: 'APPROVE',
        approvedBy: 'manager-1',
      };

      const res = await service.sendSignal(tenantId, expenseId, signalDto);
      expect(mockWorkflowHandle.signal).toHaveBeenCalled();
      expect(expenseRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'APPROVED',
          approvedById: 'manager-1',
        }),
      );
      expect(res.status).toBe('APPROVED');
    });

    it('signals REJECT and updates status to REJECTED with reason', async () => {
      const existing = {
        id: expenseId,
        tenantId,
        status: 'SUBMITTED',
        temporalWorkflowId: `expense-${expenseId}`,
      } as ExpenseClaim;
      expenseRepo.findOne = jest.fn().mockResolvedValue({ ...existing });

      const signalDto: SignalExpenseDto = {
        action: 'REJECT',
        rejectedBy: 'manager-1',
        reason: 'Missing itemized receipt',
      };

      const res = await service.sendSignal(tenantId, expenseId, signalDto);
      expect(mockWorkflowHandle.signal).toHaveBeenCalled();
      expect(expenseRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'REJECTED',
          rejectionReason: 'Missing itemized receipt',
        }),
      );
      expect(res.status).toBe('REJECTED');
    });

    it('refuses a rejection without a reason', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue({
        id: expenseId,
        tenantId,
        status: 'SUBMITTED',
      });

      await expect(
        service.sendSignal(tenantId, expenseId, {
          action: 'REJECT',
          reason: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(expenseRepo.save).not.toHaveBeenCalled();
      expect(mockWorkflowHandle.signal).not.toHaveBeenCalled();
    });

    it('signals REIMBURSE and updates status to PAID', async () => {
      const existing = {
        id: expenseId,
        tenantId,
        amount: 80,
        status: 'APPROVED',
        temporalWorkflowId: `expense-${expenseId}`,
      } as ExpenseClaim;
      expenseRepo.findOne = jest.fn().mockResolvedValue({ ...existing });

      const signalDto: SignalExpenseDto = {
        action: 'REIMBURSE',
        accountId: 'acc-1',
        reimbursedBy: 'finance-admin',
      };

      const res = await service.sendSignal(tenantId, expenseId, signalDto);
      expect(mockWorkflowHandle.signal).toHaveBeenCalled();
      expect(expenseRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'PAID',
        }),
      );
      expect(res.status).toBe('PAID');
    });

    // The workflow's posting activity only ever logged, so an approved claim
    // never reached the ledger: the P&L read zero expenses however much had
    // been claimed, and the bank balance never moved when it was paid.
    it('posts the cost to the ledger on approval', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue({
        id: expenseId,
        tenantId,
        amount: 4200,
        category: 'Travel',
        claimNumber: 'EXP-2026-0001',
        status: 'SUBMITTED',
        temporalWorkflowId: `expense-${expenseId}`,
      });

      await service.sendSignal(tenantId, expenseId, {
        action: 'APPROVE',
        approvedBy: 'manager-1',
      });

      expect(journalRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceType: 'EXPENSE',
          referenceId: expenseId,
          totalAmount: 4200,
          lines: expect.arrayContaining([
            expect.objectContaining({ role: 'TRAVEL', debit: 4200 }),
            expect.objectContaining({ role: 'ACCOUNTS_PAYABLE', credit: 4200 }),
          ]),
        }),
      );
    });

    it('posts a cost-of-sales claim to COGS', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue({
        id: expenseId,
        tenantId,
        amount: 4200,
        category: 'Raw materials',
        claimNumber: 'EXP-2026-0001',
        status: 'SUBMITTED',
        temporalWorkflowId: `expense-${expenseId}`,
      });

      await service.sendSignal(tenantId, expenseId, {
        action: 'APPROVE',
        approvedBy: 'manager-1',
      });

      expect(ledgerService.resolveLines).toHaveBeenCalledWith(
        tenantId,
        expect.arrayContaining([
          expect.objectContaining({ role: 'COGS', debit: 4200 }),
          expect.objectContaining({ role: 'ACCOUNTS_PAYABLE', credit: 4200 }),
        ]),
        expect.anything(),
        // Claim in base currency: converted at 1.
        1,
      );
    });

    it('settles the payable and takes the money out of the account on reimbursement', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue({
        id: expenseId,
        tenantId,
        amount: 4200,
        claimNumber: 'EXP-2026-0001',
        status: 'APPROVED',
        temporalWorkflowId: `expense-${expenseId}`,
      });

      await service.sendSignal(tenantId, expenseId, {
        action: 'REIMBURSE',
        accountId: 'acc-1',
        reimbursedBy: 'finance-admin',
      });

      expect(journalRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceId: `${expenseId}:reimbursement`,
          lines: expect.arrayContaining([
            expect.objectContaining({ role: 'ACCOUNTS_PAYABLE', debit: 4200 }),
            expect.objectContaining({
              financeAccountId: 'acc-1',
              credit: 4200,
            }),
          ]),
        }),
      );
      // Treasury has to move with the ledger, or the two disagree — and by a
      // relative UPDATE, so a concurrent payment into the account is not lost.
      expect(accountRepo.save).not.toHaveBeenCalled();
      expect(txManager.query).toHaveBeenCalledWith(
        expect.stringContaining('"balance" = "balance" - $1'),
        [4200, 'acc-1', tenantId],
      );
    });

    /*
     * The journal, the account deduction and the claim's status used to be
     * three separate writes, with the Temporal signal sent before any of them.
     * A failure in between left the books and the claim disagreeing, and two
     * reimbursements at once could both pass the "already posted" check.
     */
    it('posts, deducts and marks the claim paid in one transaction', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue({
        id: expenseId,
        tenantId,
        amount: 4200,
        claimNumber: 'EXP-2026-0001',
        status: 'APPROVED',
        temporalWorkflowId: `expense-${expenseId}`,
      });

      await service.sendSignal(tenantId, expenseId, {
        action: 'REIMBURSE',
        accountId: 'acc-1',
        reimbursedBy: 'finance-admin',
      });

      expect((expenseRepo.manager as any).transaction).toHaveBeenCalledTimes(1);
      expect(txManager.getRepository).toHaveBeenCalledWith(ExpenseClaim);
      expect(txManager.getRepository).toHaveBeenCalledWith(JournalEntry);
      expect(ledgerService.resolveLines).toHaveBeenCalledWith(
        tenantId,
        expect.any(Array),
        txManager,
        1,
      );
      // The claim row is locked before its status is read.
      expect(expenseRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: expenseId, tenantId },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(expenseRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PAID' }),
      );
    });

    it('signals the workflow only after the transaction commits', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue({
        id: expenseId,
        tenantId,
        amount: 4200,
        status: 'APPROVED',
        temporalWorkflowId: `expense-${expenseId}`,
      });

      await service.sendSignal(tenantId, expenseId, {
        action: 'REIMBURSE',
        accountId: 'acc-1',
      });

      expect(events).toEqual(['commit', 'signal']);
    });

    it('does not signal the workflow when the transaction fails', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue({
        id: expenseId,
        tenantId,
        amount: 4200,
        status: 'APPROVED',
        temporalWorkflowId: `expense-${expenseId}`,
      });
      journalRepo.save = jest.fn().mockRejectedValue(new Error('db down'));

      await expect(
        service.sendSignal(tenantId, expenseId, {
          action: 'REIMBURSE',
          accountId: 'acc-1',
        }),
      ).rejects.toThrow('db down');
      expect(mockWorkflowHandle.signal).not.toHaveBeenCalled();
    });

    it('refuses to reimburse a claim that is already paid', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue({
        id: expenseId,
        tenantId,
        amount: 4200,
        status: 'PAID',
        temporalWorkflowId: `expense-${expenseId}`,
      });

      await expect(
        service.sendSignal(tenantId, expenseId, {
          action: 'REIMBURSE',
          accountId: 'acc-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(journalRepo.save).not.toHaveBeenCalled();
      expect(txManager.query).not.toHaveBeenCalled();
      expect(mockWorkflowHandle.signal).not.toHaveBeenCalled();
    });

    it('refuses to approve a claim that has already been rejected', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue({
        id: expenseId,
        tenantId,
        amount: 4200,
        status: 'REJECTED',
      });

      await expect(
        service.sendSignal(tenantId, expenseId, { action: 'APPROVE' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(journalRepo.save).not.toHaveBeenCalled();
    });

    // The partial unique index on journal_entries is the backstop for a
    // second posting that slips past the in-transaction check.
    it('turns a duplicate-posting unique violation into a 409', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue({
        id: expenseId,
        tenantId,
        amount: 4200,
        status: 'SUBMITTED',
        temporalWorkflowId: `expense-${expenseId}`,
      });
      journalRepo.save = jest.fn().mockRejectedValue(
        new QueryFailedError('INSERT', [], {
          code: '23505',
          constraint: 'uq_journal_entries_single_posting',
          message: 'duplicate key value violates unique constraint',
        } as unknown as Error),
      );

      await expect(
        service.sendSignal(tenantId, expenseId, { action: 'APPROVE' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockWorkflowHandle.signal).not.toHaveBeenCalled();
    });

    it('refuses to reimburse when the organization has no account to pay from', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue({
        id: expenseId,
        tenantId,
        amount: 4200,
        status: 'APPROVED',
        temporalWorkflowId: `expense-${expenseId}`,
      });
      accountRepo.find = jest.fn().mockResolvedValue([]);

      await expect(
        service.sendSignal(tenantId, expenseId, {
          action: 'REIMBURSE',
          reimbursedBy: 'finance-admin',
        }),
      ).rejects.toThrow(/no bank or cash account/i);
    });

    it('does not post twice when a claim is signalled again', async () => {
      expenseRepo.findOne = jest.fn().mockResolvedValue({
        id: expenseId,
        tenantId,
        amount: 4200,
        status: 'SUBMITTED',
        temporalWorkflowId: `expense-${expenseId}`,
      });
      journalRepo.findOne = jest.fn().mockResolvedValue({ id: 'je-existing' });

      await service.sendSignal(tenantId, expenseId, {
        action: 'APPROVE',
        approvedBy: 'manager-1',
      });

      expect(journalRepo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for invalid signal action', async () => {
      const existing = {
        id: expenseId,
        tenantId,
        status: 'SUBMITTED',
      } as ExpenseClaim;
      expenseRepo.findOne = jest.fn().mockResolvedValue(existing);

      await expect(
        service.sendSignal(tenantId, expenseId, { action: 'UNKNOWN' as any }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('VAT on a claim', () => {
    const TRN = '100123456700003';
    const SR = {
      id: 'code-sr',
      tenantId,
      kind: 'PURCHASE',
      code: 'SR',
      name: 'Standard rated 5%',
      rate: 5,
      isReverseCharge: false,
      treatment: 'STANDARD',
      isActive: true,
    };
    const BL = { ...SR, id: 'code-bl', code: 'BL', treatment: 'BLOCKED' };
    const RC = {
      ...SR,
      id: 'code-rc',
      code: 'RC',
      isReverseCharge: true,
      treatment: 'REVERSE_CHARGE',
    };
    const uaeOrg = {
      id: tenantId,
      baseCurrency: 'AED',
      country: 'AE',
      taxId: '100999888700003',
    };
    let codes: Array<typeof SR>;
    let organization: Record<string, unknown>;

    const lookups = (entity: { name: string }) => {
      if (entity.name === 'TaxCode') {
        return {
          findOne: jest.fn(
            async ({ where }: { where: { id: string } }) =>
              codes.find((c) => c.id === where.id) ?? null,
          ),
          find: jest.fn(async () => codes.filter((c) => c.isActive)),
        };
      }
      if (entity.name === 'Organization') {
        return { findOne: jest.fn().mockResolvedValue(organization) };
      }
      return undefined;
    };

    const claimOf = (over: Partial<ExpenseClaim> = {}) =>
      ({
        id: expenseId,
        tenantId,
        amount: 210,
        currency: 'AED',
        category: 'Travel',
        claimNumber: 'EXP-2026-0007',
        status: 'SUBMITTED',
        expenseDate: new Date('2026-10-15T00:00:00Z'),
        temporalWorkflowId: `expense-${expenseId}`,
        taxCodeId: null,
        taxAmount: 0,
        supplierTaxId: null,
        recoverableTax: 0,
        reverseChargeTax: 0,
        taxPostedAt: null,
        taxReversedAt: null,
        ...over,
      }) as ExpenseClaim;

    const postedLines = () =>
      (journalRepo.save as jest.Mock).mock.calls.map(
        ([entry]) => entry as JournalEntry,
      );
    const line = (entry: JournalEntry, role: string) =>
      (entry.lines as any[]).filter((l) => l.role === role);

    beforeEach(() => {
      codes = [SR, BL, RC];
      organization = uaeOrg;
      const plain = (expenseRepo.manager as any).getRepository;
      (expenseRepo.manager as any).getRepository = jest.fn(
        (entity: { name: string }) => lookups(entity) ?? plain(entity),
      );
      const inTx = txManager.getRepository.getMockImplementation()!;
      txManager.getRepository.mockImplementation(
        (entity: { name: string }) => lookups(entity) ?? inTx(entity),
      );
    });

    describe('recording it', () => {
      const dto = (over: Partial<CreateExpenseClaimDto> = {}) =>
        ({
          category: 'Travel',
          amount: 210,
          currency: 'AED',
          ...over,
        }) as CreateExpenseClaimDto;

      it('stores no VAT by default, as every claim did before', async () => {
        const claim = await service.create(tenantId, dto());
        expect(claim.taxCodeId).toBeNull();
        expect(claim.taxAmount).toBe(0);
      });

      it('ignores a VAT amount sent without a VAT type', async () => {
        const claim = await service.create(tenantId, dto({ taxAmount: 10 }));
        expect(claim.taxCodeId).toBeNull();
        expect(claim.taxAmount).toBe(0);
      });

      it('stores the code, the VAT and the supplier tax number', async () => {
        const claim = await service.create(
          tenantId,
          dto({
            taxCodeId: SR.id,
            taxAmount: 10,
            supplierTaxId: '100-1234-5670-0003',
          }),
        );
        expect(claim).toMatchObject({
          taxCodeId: SR.id,
          taxAmount: 10,
          supplierTaxId: TRN,
        });
      });

      it('works the VAT out from the rate when none is given', async () => {
        const claim = await service.create(
          tenantId,
          dto({ taxCodeId: SR.id, supplierTaxId: TRN }),
        );
        expect(claim.taxAmount).toBe(10);
      });

      it('refuses recoverable VAT in the UAE without the supplier tax number', async () => {
        await expect(
          service.create(tenantId, dto({ taxCodeId: SR.id, taxAmount: 10 })),
        ).rejects.toThrow(/tax number \(TRN\)/);
        expect(expenseRepo.save).not.toHaveBeenCalled();
      });

      it('does not ask for the tax number outside UAE VAT mode', async () => {
        organization = { id: tenantId, baseCurrency: 'USD', country: 'GB' };
        const claim = await service.create(
          tenantId,
          dto({ taxCodeId: SR.id, taxAmount: 10 }),
        );
        expect(claim.taxAmount).toBe(10);
      });

      it('accepts blocked VAT without a tax number', async () => {
        const claim = await service.create(
          tenantId,
          dto({ taxCodeId: BL.id, taxAmount: 10 }),
        );
        expect(claim).toMatchObject({ taxCodeId: BL.id, taxAmount: 10 });
      });

      it('refuses more VAT than the rate allows on the total', async () => {
        await expect(
          service.create(
            tenantId,
            dto({ taxCodeId: SR.id, taxAmount: 50, supplierTaxId: TRN }),
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('refuses a code that is not one of the organisation’s, or is switched off', async () => {
        await expect(
          service.create(tenantId, dto({ taxCodeId: 'someone-elses' })),
        ).rejects.toThrow(/VAT type is not available/);
        codes = [{ ...SR, isActive: false }];
        await expect(
          service.create(
            tenantId,
            dto({ taxCodeId: SR.id, supplierTaxId: TRN }),
          ),
        ).rejects.toThrow(/VAT type is not available/);
      });

      it('recalculates the VAT when the amount of a claim changes', async () => {
        expenseRepo.findOne = jest.fn().mockResolvedValue(
          claimOf({ taxCodeId: SR.id, taxAmount: 10, supplierTaxId: TRN }),
        );
        const claim = await service.update(tenantId, expenseId, {
          amount: 420,
        });
        expect(claim.taxAmount).toBe(20);
      });

      it('clears the VAT when the claim is set back to No VAT', async () => {
        expenseRepo.findOne = jest.fn().mockResolvedValue(
          claimOf({ taxCodeId: SR.id, taxAmount: 10, supplierTaxId: TRN }),
        );
        const claim = await service.update(tenantId, expenseId, {
          taxCodeId: null,
        });
        expect(claim.taxCodeId).toBeNull();
        expect(claim.taxAmount).toBe(0);
      });

      it('lists the purchase codes for the claim form', async () => {
        const options = await service.taxOptions(tenantId);
        expect(options.supplierTaxIdRequired).toBe(true);
        expect(options.codes.map((c) => c.code)).toEqual(['SR', 'BL', 'RC']);
      });
    });

    describe('approval', () => {
      const approve = () =>
        service.sendSignal(tenantId, expenseId, {
          action: 'APPROVE',
          approvedBy: 'manager-1',
        });

      // The reproduced defect: Dr 6500 Travel 210 / Cr 2100 210, the VAT lost.
      it('posts recoverable VAT to the tax account, the net to the cost, and still owes the gross', async () => {
        expenseRepo.findOne = jest.fn().mockResolvedValue(
          claimOf({ taxCodeId: SR.id, taxAmount: 10, supplierTaxId: TRN }),
        );
        const claim = await approve();

        const [entry] = postedLines();
        expect(entry.totalAmount).toBe(210);
        expect(line(entry, 'TRAVEL')).toEqual([
          expect.objectContaining({ debit: 200, credit: 0 }),
        ]);
        expect(line(entry, 'TAX_PAYABLE')).toEqual([
          expect.objectContaining({
            accountName: 'Input tax',
            debit: 10,
            credit: 0,
          }),
        ]);
        expect(line(entry, 'ACCOUNTS_PAYABLE')).toEqual([
          expect.objectContaining({ debit: 0, credit: 210 }),
        ]);
        expect(claim).toMatchObject({
          status: 'APPROVED',
          taxAmount: 10,
          recoverableTax: 10,
          reverseChargeTax: 0,
          taxReversedAt: null,
        });
        expect(claim.taxPostedAt).toBeInstanceOf(Date);
      });

      it('posts a claim without VAT exactly as before', async () => {
        expenseRepo.findOne = jest.fn().mockResolvedValue(claimOf());
        const claim = await approve();
        const [entry] = postedLines();
        expect(entry.lines).toEqual([
          expect.objectContaining({ role: 'TRAVEL', debit: 210, credit: 0 }),
          expect.objectContaining({
            role: 'ACCOUNTS_PAYABLE',
            debit: 0,
            credit: 210,
          }),
        ]);
        expect(claim.recoverableTax).toBe(0);
      });

      it('keeps blocked VAT in the cost and off the tax account', async () => {
        expenseRepo.findOne = jest.fn().mockResolvedValue(
          claimOf({ taxCodeId: BL.id, taxAmount: 10 }),
        );
        const claim = await approve();
        const [entry] = postedLines();
        expect(line(entry, 'TAX_PAYABLE')).toHaveLength(0);
        expect(line(entry, 'TRAVEL')[0].debit).toBe(210);
        expect(line(entry, 'ACCOUNTS_PAYABLE')[0].credit).toBe(210);
        expect(claim).toMatchObject({ taxAmount: 10, recoverableTax: 0 });
      });

      it('self-assesses a reverse-charge claim on both sides of the tax account', async () => {
        expenseRepo.findOne = jest.fn().mockResolvedValue(
          claimOf({ amount: 200, taxCodeId: RC.id }),
        );
        const claim = await approve();
        const [entry] = postedLines();
        expect(
          line(entry, 'TAX_PAYABLE').map((l) => [l.debit, l.credit]),
        ).toEqual([
          [10, 0],
          [0, 10],
        ]);
        expect(line(entry, 'ACCOUNTS_PAYABLE')[0].credit).toBe(200);
        expect(claim).toMatchObject({ recoverableTax: 0, reverseChargeTax: 10 });
      });

      it('refuses to approve when the VAT can no longer be claimed, and posts nothing', async () => {
        // Filed before the organisation entered UAE VAT mode, with no TRN.
        expenseRepo.findOne = jest.fn().mockResolvedValue(
          claimOf({ taxCodeId: SR.id, taxAmount: 10, supplierTaxId: null }),
        );
        await expect(approve()).rejects.toThrow(
          /EXP-2026-0007 cannot be approved yet/,
        );
        expect(journalRepo.save).not.toHaveBeenCalled();
        expect(expenseRepo.save).not.toHaveBeenCalled();
      });

      it('refuses to approve a claim whose VAT type was deleted', async () => {
        codes = [];
        expenseRepo.findOne = jest.fn().mockResolvedValue(
          claimOf({ taxCodeId: SR.id, taxAmount: 10, supplierTaxId: TRN }),
        );
        await expect(approve()).rejects.toThrow(/VAT type no longer exists/);
        expect(journalRepo.save).not.toHaveBeenCalled();
      });

      it('leaves reimbursement as it was: the gross leaves the account', async () => {
        expenseRepo.findOne = jest.fn().mockResolvedValue(
          claimOf({
            status: 'APPROVED',
            taxCodeId: SR.id,
            taxAmount: 10,
            recoverableTax: 10,
            supplierTaxId: TRN,
          }),
        );
        await service.sendSignal(tenantId, expenseId, {
          action: 'REIMBURSE',
          accountId: 'acc-1',
        });
        const entry = postedLines().find(
          (e) => e.referenceId === `${expenseId}:reimbursement`,
        )!;
        expect(entry.totalAmount).toBe(210);
        expect(line(entry, 'ACCOUNTS_PAYABLE')[0].debit).toBe(210);
        expect(line(entry, 'TAX_PAYABLE')).toHaveLength(0);
      });
    });

    describe('rejection', () => {
      const reject = () =>
        service.sendSignal(tenantId, expenseId, {
          action: 'REJECT',
          rejectedBy: 'manager-1',
          reason: 'Personal purchase',
        });
      const accrual = {
        id: 'je-accrual',
        tenantId,
        referenceType: 'EXPENSE',
        referenceId: expenseId,
        totalAmount: 210,
        currency: 'AED',
        fxRate: 1,
        lines: [
          { ledgerAccountId: 'a-6500', accountName: 'Travel', debit: 200, credit: 0, description: 'Expense claim EXP-2026-0007 — Travel' },
          { ledgerAccountId: 'a-2200', accountName: 'Input tax', debit: 10, credit: 0, description: 'Input tax' },
          { ledgerAccountId: 'a-2100', accountName: 'Accounts payable', debit: 0, credit: 210, description: 'Payable' },
        ],
      };

      it('posts nothing for a claim rejected before it was approved', async () => {
        expenseRepo.findOne = jest.fn().mockResolvedValue(
          claimOf({ taxCodeId: SR.id, taxAmount: 10, supplierTaxId: TRN }),
        );
        const claim = await reject();
        expect(journalRepo.save).not.toHaveBeenCalled();
        expect(claim).toMatchObject({
          status: 'REJECTED',
          recoverableTax: 0,
          taxPostedAt: null,
          taxReversedAt: null,
        });
      });

      it('reverses the cost, the payable and the VAT of a claim rejected after approval', async () => {
        expenseRepo.findOne = jest.fn().mockResolvedValue(
          claimOf({
            status: 'APPROVED',
            taxCodeId: SR.id,
            taxAmount: 10,
            recoverableTax: 10,
            supplierTaxId: TRN,
            taxPostedAt: new Date('2026-10-16T00:00:00Z'),
          }),
        );
        journalRepo.findOne = jest.fn(async ({ where }: any) =>
          where.referenceId === expenseId ? accrual : null,
        ) as any;

        const claim = await reject();

        const [entry] = postedLines();
        expect(entry).toMatchObject({
          referenceType: 'EXPENSE',
          referenceId: `${expenseId}:reversal`,
          reversesEntryId: 'je-accrual',
          totalAmount: 210,
        });
        // The mirror image, account for account: nothing is left behind.
        expect(
          (entry.lines as any[]).map((l) => [
            l.ledgerAccountId,
            l.debit,
            l.credit,
          ]),
        ).toEqual([
          ['a-6500', 0, 200],
          ['a-2200', 0, 10],
          ['a-2100', 210, 0],
        ]);
        // The accrual itself is never edited.
        expect(accrual.lines[0]).toMatchObject({ debit: 200, credit: 0 });
        expect(claim.status).toBe('REJECTED');
        expect(claim.taxReversedAt).toBeInstanceOf(Date);
      });

      it('does not reverse twice', async () => {
        expenseRepo.findOne = jest.fn().mockResolvedValue(
          claimOf({ status: 'APPROVED', taxCodeId: SR.id, recoverableTax: 10 }),
        );
        journalRepo.findOne = jest.fn(async ({ where }: any) =>
          where.reversesEntryId ? { id: 'je-rev' } : accrual,
        ) as any;
        await reject();
        expect(journalRepo.save).not.toHaveBeenCalled();
      });
    });

    describe('scanning a receipt', () => {
      const scan = async (read: Record<string, unknown>) => {
        (aiService.generateStructured as jest.Mock).mockResolvedValue({
          data: {
            merchantName: 'ENOC',
            amount: 210,
            currency: 'AED',
            expenseDate: '2026-10-15',
            category: 'Travel',
            confidence: 0.9,
            items: [],
            ...read,
          },
          usage: { inputTokens: 1, outputTokens: 1 },
          model: 'm',
        });
        return service.scanReceipt({ rawText: 'ENOC TRN 100123456700003' }, actor);
      };

      it('suggests the standard code when the receipt shows VAT and the supplier tax number', async () => {
        const result = await scan({
          taxAmount: 10,
          supplierTaxId: 'TRN 100123456700003'.slice(4),
        });
        expect(result).toMatchObject({
          taxAmount: 10,
          supplierTaxId: TRN,
          taxCodeId: SR.id,
        });
      });

      it('suggests no code when the tax number is missing, so no VAT is claimed by default', async () => {
        const result = await scan({ taxAmount: 10 });
        expect(result.taxCodeId).toBeNull();
        expect(result.supplierTaxId).toBeNull();
      });

      it('starts an entertainment receipt on the blocked code', async () => {
        const result = await scan({
          taxAmount: 10,
          supplierTaxId: TRN,
          category: 'Meals & Entertainment',
        });
        expect(result.taxCodeId).toBe(BL.id);
      });

      it('says nothing about VAT for a receipt that shows none', async () => {
        const result = await scan({});
        expect(result).not.toHaveProperty('taxCodeId');
      });

      it('tells the model to read the VAT and the tax number, never to guess them', async () => {
        await scan({});
        const [, request] = (aiService.generateStructured as jest.Mock).mock
          .calls[0];
        expect(JSON.stringify(request)).toMatch(/supplierTaxId/);
        expect(JSON.stringify(request)).toMatch(/never guess/);
      });
    });

    describe('a claim already in the books', () => {
      const posted = () =>
        claimOf({
          status: 'APPROVED',
          taxCodeId: SR.id,
          taxAmount: 10,
          recoverableTax: 10,
          supplierTaxId: TRN,
          taxPostedAt: new Date('2026-10-16T00:00:00Z'),
        });

      beforeEach(() => {
        expenseRepo.findOne = jest.fn().mockResolvedValue(posted());
        journalRepo.findOne = jest.fn().mockResolvedValue({ id: 'je-accrual' });
      });

      // Otherwise the claim would say one thing and the ledger another, and a
      // status moved back by hand could be approved again with nothing posted.
      it.each([
        ['amount', { amount: 500 }],
        ['VAT type', { taxCodeId: null }],
        ['VAT amount', { taxAmount: 5 }],
        ['supplier tax number', { supplierTaxId: '100999999900003' }],
        ['category', { category: 'Consumables' }],
        ['status', { status: 'SUBMITTED' as const }],
      ])('cannot have its %s changed', async (_what, change) => {
        await expect(
          service.update(tenantId, expenseId, change as UpdateExpenseClaimDto),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(expenseRepo.save).not.toHaveBeenCalled();
      });

      it('can still have its notes and receipt changed', async () => {
        const claim = await service.update(tenantId, expenseId, {
          notes: 'Receipt re-photographed',
          amount: 210,
        });
        expect(claim.notes).toBe('Receipt re-photographed');
      });
    });
  });

  describe('scanReceipt (AI OCR)', () => {
    const validAiResult = {
      merchantName: 'Starbucks Store #1042',
      amount: 9.99,
      currency: 'USD',
      expenseDate: '2026-08-10',
      category: 'Meals & Entertainment',
      taxAmount: 0.74,
      confidence: 0.95,
      items: [
        {
          description: 'Caramel Macchiato',
          quantity: 1,
          unitPrice: 5.5,
          amount: 5.5,
        },
        {
          description: 'Blueberry Muffin',
          quantity: 1,
          unitPrice: 3.75,
          amount: 3.75,
        },
      ],
    };

    it('extracts structured data via AiService for raw receipt text', async () => {
      (aiService.generateStructured as jest.Mock).mockResolvedValue({
        data: validAiResult,
        usage: { inputTokens: 100, outputTokens: 50 },
        model: 'claude-sonnet-5',
      });

      const dto: ScanReceiptDto = {
        rawText: 'STARBUCKS STORE #1042\nTotal: $9.99',
      };
      const scanResult = await service.scanReceipt(dto, actor);

      expect(aiService.generateStructured).toHaveBeenCalledWith(
        'expense.scan_receipt',
        expect.objectContaining({
          messages: expect.any(Array),
          schemaName: 'extract_receipt',
        }),
        actor,
      );
      expect(scanResult.merchantName).toBe('Starbucks Store #1042');
      expect(scanResult.amount).toBe(9.99);
      expect(scanResult.category).toBe('Meals & Entertainment');
      expect(scanResult.items).toHaveLength(2);
      expect(scanResult.rawText).toContain('STARBUCKS');
    });

    it('sends an image content block for base64/imageUrl input', async () => {
      (aiService.generateStructured as jest.Mock).mockResolvedValue({
        data: validAiResult,
        usage: { inputTokens: 200, outputTokens: 50 },
        model: 'claude-sonnet-5',
      });

      const dto: ScanReceiptDto = {
        imageUrl: 'https://storage.crm.example/receipts/rec-sample.png',
        mimeType: 'image/png',
      };
      await service.scanReceipt(dto, actor);

      const callArgs = (aiService.generateStructured as jest.Mock).mock
        .calls[0][1];
      const content = callArgs.messages[0].content;
      expect(content[0]).toEqual(
        expect.objectContaining({
          type: 'image',
          url: dto.imageUrl,
          mimeType: 'image/png',
        }),
      );
    });

    it('sends a PDF data URL as a document, unpacked', async () => {
      (aiService.generateStructured as jest.Mock).mockResolvedValue({
        data: validAiResult,
        usage: { inputTokens: 200, outputTokens: 50 },
        model: 'claude-sonnet-5',
      });

      // What the browser form sends: the data URL in both fields.
      const dataUrl = 'data:application/pdf;base64,JVBERi0xLjc=';
      await service.scanReceipt(
        { base64: dataUrl, imageUrl: dataUrl, mimeType: 'image/jpeg' },
        actor,
      );

      const content = (aiService.generateStructured as jest.Mock).mock
        .calls[0][1].messages[0].content;
      expect(content[0]).toEqual({
        type: 'document',
        mimeType: 'application/pdf',
        data: 'JVBERi0xLjc=',
      });
    });

    it('sends an image data URL as base64 bytes, never as a URL', async () => {
      (aiService.generateStructured as jest.Mock).mockResolvedValue({
        data: validAiResult,
        usage: { inputTokens: 200, outputTokens: 50 },
        model: 'claude-sonnet-5',
      });

      await service.scanReceipt(
        { imageUrl: 'data:image/png;base64,iVBORw0KGgo=' },
        actor,
      );

      const content = (aiService.generateStructured as jest.Mock).mock
        .calls[0][1].messages[0].content;
      expect(content[0]).toEqual({
        type: 'image',
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
      });
    });

    it('sends raw base64 with a PDF mime type as a document', async () => {
      (aiService.generateStructured as jest.Mock).mockResolvedValue({
        data: validAiResult,
        usage: { inputTokens: 200, outputTokens: 50 },
        model: 'claude-sonnet-5',
      });

      await service.scanReceipt(
        { base64: 'JVBERi0xLjc=', mimeType: 'application/pdf' },
        actor,
      );

      const content = (aiService.generateStructured as jest.Mock).mock
        .calls[0][1].messages[0].content;
      expect(content[0]).toMatchObject({
        type: 'document',
        data: 'JVBERi0xLjc=',
      });
    });

    it('does not call the model with a file it cannot read', async () => {
      const scanResult = await service.scanReceipt(
        { imageUrl: 'data:image/svg+xml;utf8,<svg></svg>' },
        actor,
      );
      expect(aiService.generateStructured).not.toHaveBeenCalled();
      expect(scanResult.confidence).toBe(0);
    });

    it('throws BadRequestException when the AI response fails schema validation', async () => {
      (aiService.generateStructured as jest.Mock).mockResolvedValue({
        data: { merchantName: 'X' }, // missing required fields
        usage: { inputTokens: 10, outputTokens: 5 },
        model: 'claude-sonnet-5',
      });

      const dto: ScanReceiptDto = { rawText: 'some receipt text' };
      await expect(service.scanReceipt(dto, actor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('degrades gracefully without throwing when AI is not configured', async () => {
      (aiService.generateStructured as jest.Mock).mockRejectedValue(
        new AiNotConfiguredException(),
      );

      const dto: ScanReceiptDto = { rawText: 'some receipt text' };
      const scanResult = await service.scanReceipt(dto, actor);

      expect(scanResult.confidence).toBe(0);
      expect(scanResult.amount).toBe(0);
    });

    it('degrades gracefully without throwing when the AI call fails', async () => {
      (aiService.generateStructured as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      const dto: ScanReceiptDto = { rawText: 'some receipt text' };
      const scanResult = await service.scanReceipt(dto, actor);

      expect(scanResult.confidence).toBe(0);
    });

    it('degrades gracefully without throwing when the org has hit its AI budget', async () => {
      (aiService.generateStructured as jest.Mock).mockRejectedValue(
        new AiBudgetExceededException(tenantId, 10.5, 10),
      );

      const dto: ScanReceiptDto = { rawText: 'some receipt text' };
      const scanResult = await service.scanReceipt(dto, actor);

      expect(scanResult.confidence).toBe(0);
    });

    it('does not call AiService when neither rawText nor image is provided', async () => {
      const scanResult = await service.scanReceipt({}, actor);

      expect(aiService.generateStructured).not.toHaveBeenCalled();
      expect(scanResult.confidence).toBe(0);
    });
  });
});
