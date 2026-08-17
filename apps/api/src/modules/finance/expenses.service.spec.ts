import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ExpensesService } from './expenses.service';
import { ExpenseClaim } from './entities/expense-claim.entity';
import { FinanceAccount } from './entities/finance-account.entity';
import { CategoryBudget } from './entities/category-budget.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { TemporalService } from '../temporal/temporal.service';
import { CreateExpenseClaimDto, UpdateExpenseClaimDto, SignalExpenseDto, ScanReceiptDto } from './dto';

describe('ExpensesService', () => {
  let service: ExpensesService;
  let expenseRepo: jest.Mocked<Partial<Repository<ExpenseClaim>>>;
  let accountRepo: jest.Mocked<Partial<Repository<FinanceAccount>>>;
  let budgetRepo: jest.Mocked<Partial<Repository<CategoryBudget>>>;
  let journalRepo: jest.Mocked<Partial<Repository<JournalEntry>>>;
  let temporalService: jest.Mocked<Partial<TemporalService>>;
  let mockWorkflowHandle: any;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const expenseId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    mockWorkflowHandle = {
      workflowId: `expense-${expenseId}`,
      signal: jest.fn().mockResolvedValue(undefined),
    };

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
    };

    accountRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async (a) => a),
    };

    budgetRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async (b) => b),
    };

    journalRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'je-1', ...dto })),
      save: jest.fn().mockImplementation(async (j) => j),
    };

    temporalService = {
      getClient: jest.fn().mockReturnValue({
        workflow: {
          start: jest.fn().mockResolvedValue(mockWorkflowHandle),
          getHandle: jest.fn().mockReturnValue(mockWorkflowHandle),
        },
      } as any),
    };

    service = new ExpensesService(
      expenseRepo as unknown as Repository<ExpenseClaim>,
      accountRepo as unknown as Repository<FinanceAccount>,
      budgetRepo as unknown as Repository<CategoryBudget>,
      journalRepo as unknown as Repository<JournalEntry>,
      temporalService as unknown as TemporalService,
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
      await expect(service.findById(tenantId, 'non-existent')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates expense claim with sequential claim number and starts Temporal workflow', async () => {
      expenseRepo.count = jest.fn().mockResolvedValue(4);

      const dto: CreateExpenseClaimDto = {
        category: 'Travel',
        amount: 250,
        currency: 'USD',
        merchantName: 'Delta Air Lines',
        expenseDate: '2026-08-15',
        employeeId: 'emp-101',
        employeeName: 'Sarah Connor',
        items: [{ description: 'Flight to SFO', quantity: 1, unitPrice: 250, amount: 250 }],
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
      temporalService.getClient = jest.fn().mockReturnValue({
        workflow: {
          start: jest.fn().mockRejectedValue(new Error('Temporal connection failed')),
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
  });

  describe('update', () => {
    it('updates expense claim properties', async () => {
      const existing = { id: expenseId, tenantId, category: 'Meals', amount: 30 } as ExpenseClaim;
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
  });

  describe('sendSignal', () => {
    it('signals APPROVE and updates status to APPROVED', async () => {
      const existing = { id: expenseId, tenantId, status: 'SUBMITTED', temporalWorkflowId: `expense-${expenseId}` } as ExpenseClaim;
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
      const existing = { id: expenseId, tenantId, status: 'SUBMITTED', temporalWorkflowId: `expense-${expenseId}` } as ExpenseClaim;
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

    it('signals REIMBURSE and updates status to PAID', async () => {
      const existing = { id: expenseId, tenantId, amount: 80, status: 'APPROVED', temporalWorkflowId: `expense-${expenseId}` } as ExpenseClaim;
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

    it('throws BadRequestException for invalid signal action', async () => {
      const existing = { id: expenseId, tenantId, status: 'SUBMITTED' } as ExpenseClaim;
      expenseRepo.findOne = jest.fn().mockResolvedValue(existing);

      await expect(
        service.sendSignal(tenantId, expenseId, { action: 'UNKNOWN' as any }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('scanReceipt (AI OCR)', () => {
    it('extracts merchant, amount, items, and date from raw receipt text', async () => {
      const receiptText = `
        STARBUCKS STORE #1042
        Date: 2026-08-10
        1x Caramel Macchiato    $5.50
        1x Blueberry Muffin     $3.75
        Subtotal:               $9.25
        Tax (8%):               $0.74
        Total:                 $9.99
      `;

      const dto: ScanReceiptDto = {
        rawText: receiptText,
      };

      const scanResult = await service.scanReceipt(dto);

      expect(scanResult.merchantName).toContain('STARBUCKS');
      expect(scanResult.amount).toBe(9.99);
      expect(scanResult.currency).toBe('USD');
      expect(scanResult.category).toBe('Meals & Entertainment');
      expect(scanResult.confidence).toBeGreaterThan(0.8);
      expect(scanResult.items.length).toBeGreaterThanOrEqual(1);
    });

    it('provides intelligent fallback structured receipt if image url is provided', async () => {
      const dto: ScanReceiptDto = {
        imageUrl: 'https://storage.crm.example/receipts/rec-sample-uber.png',
      };

      const scanResult = await service.scanReceipt(dto);

      expect(scanResult.merchantName).toBeDefined();
      expect(scanResult.amount).toBeGreaterThan(0);
      expect(scanResult.currency).toBe('USD');
      expect(scanResult.category).toBeDefined();
      expect(scanResult.confidence).toBeGreaterThan(0.7);
    });
  });
});
