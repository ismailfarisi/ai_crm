import { Test, TestingModule } from '@nestjs/testing';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseReceiptsService } from './expense-receipts.service';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';

describe('ExpensesController', () => {
  let controller: ExpensesController;
  let expensesService: jest.Mocked<Partial<ExpensesService>>;
  let receipts: { assertReceiptUrl: jest.Mock; attach: jest.Mock };

  const mockUser: AuthenticatedUser = {
    id: 'user-123',
    organizationId: 'tenant-123',
    email: 'employee@example.com',
    roleId: 'role-member',
    permissions: ['finance:read', 'expense:submit', 'expense:approve'],
  };

  beforeEach(async () => {
    expensesService = {
      findAll: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue({ id: 'exp-1' } as any),
      create: jest.fn().mockResolvedValue({ id: 'exp-1' } as any),
      update: jest.fn().mockResolvedValue({ id: 'exp-1' } as any),
      sendSignal: jest
        .fn()
        .mockResolvedValue({ id: 'exp-1', status: 'APPROVED' } as any),
      scanReceipt: jest.fn().mockResolvedValue({
        merchantName: 'Starbucks',
        amount: 12.5,
        currency: 'USD',
        category: 'Meals & Entertainment',
        confidence: 0.95,
        items: [],
        expenseDate: '2026-08-17',
      }),
    };

    receipts = {
      assertReceiptUrl: jest.fn().mockResolvedValue(undefined),
      attach: jest
        .fn()
        .mockResolvedValue({ id: 'exp-1', receiptUrl: 'attachment:f1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExpensesController],
      providers: [
        {
          provide: ExpensesService,
          useValue: expensesService,
        },
        { provide: ExpenseReceiptsService, useValue: receipts },
      ],
    }).compile();

    controller = module.get<ExpensesController>(ExpensesController);
  });

  it('should list all expense claims', async () => {
    const result = await controller.findAll(mockUser);
    expect(expensesService.findAll).toHaveBeenCalledWith('tenant-123');
    expect(result).toEqual([]);
  });

  it('should find expense claim by id', async () => {
    const result = await controller.findById(mockUser, 'exp-1');
    expect(expensesService.findById).toHaveBeenCalledWith(
      'tenant-123',
      'exp-1',
    );
    expect(result).toEqual({ id: 'exp-1' });
  });

  it('should submit new expense claim', async () => {
    const dto = { category: 'Travel', amount: 150 };
    const result = await controller.create(mockUser, dto);
    expect(expensesService.create).toHaveBeenCalledWith(
      'tenant-123',
      dto,
      mockUser,
    );
    expect(result).toEqual({ id: 'exp-1' });
  });

  it('should update an existing expense claim', async () => {
    const dto = { amount: 175 };
    const result = await controller.update(mockUser, 'exp-1', dto);
    expect(expensesService.update).toHaveBeenCalledWith(
      'tenant-123',
      'exp-1',
      dto,
    );
    expect(result).toEqual({ id: 'exp-1' });
  });

  it('checks the receipt reference before creating or updating', async () => {
    receipts.assertReceiptUrl.mockRejectedValueOnce(new Error('inline file'));
    await expect(
      controller.create(mockUser, { amount: 1, receiptUrl: 'data:x' }),
    ).rejects.toThrow('inline file');
    expect(expensesService.create).not.toHaveBeenCalled();

    await controller.update(mockUser, 'exp-1', { receiptUrl: 'attachment:f1' });
    expect(receipts.assertReceiptUrl).toHaveBeenLastCalledWith(
      'tenant-123',
      'exp-1',
      'attachment:f1',
    );
  });

  it('attaches an uploaded receipt to the claim', async () => {
    const file = {
      originalname: 'r.pdf',
      mimetype: 'application/pdf',
      size: 4,
      buffer: Buffer.from('%PDF'),
    };
    const result = await controller.attachReceipt(mockUser, 'exp-1', file);
    expect(receipts.attach).toHaveBeenCalledWith(mockUser, 'exp-1', file);
    expect(result.receiptUrl).toBe('attachment:f1');
  });

  it('should scan receipt with AI OCR', async () => {
    const dto = { rawText: 'Starbucks Total $12.50' };
    const result = await controller.scanReceipt(mockUser, dto);
    expect(expensesService.scanReceipt).toHaveBeenCalledWith(dto, {
      organizationId: 'tenant-123',
      userId: 'user-123',
    });
    expect(result.merchantName).toBe('Starbucks');
  });

  it('scans an uploaded PDF from its bytes, ignoring any link sent with it', async () => {
    const file = {
      originalname: 'receipt.pdf',
      mimetype: 'application/pdf',
      size: 8,
      buffer: Buffer.from('%PDF-1.7'),
    };
    await controller.scanReceipt(
      mockUser,
      { imageUrl: 'https://example.test/x.png' },
      file,
    );
    expect(expensesService.scanReceipt).toHaveBeenCalledWith(
      {
        base64: Buffer.from('%PDF-1.7').toString('base64'),
        mimeType: 'application/pdf',
        imageUrl: undefined,
      },
      { organizationId: 'tenant-123', userId: 'user-123' },
    );
  });

  it('refuses an uploaded file that is not a PDF or a photo', async () => {
    const file = {
      originalname: 'r.docx',
      mimetype: 'application/msword',
      size: 1,
      buffer: Buffer.from('x'),
    };
    await expect(controller.scanReceipt(mockUser, {}, file)).rejects.toThrow(
      'PDF or a photo',
    );
    expect(expensesService.scanReceipt).not.toHaveBeenCalled();
  });

  it('should send signal to expense claim', async () => {
    const dto = { action: 'APPROVE' as const, approvedBy: 'user-123' };
    const result = await controller.signal(mockUser, 'exp-1', dto);
    expect(expensesService.sendSignal).toHaveBeenCalledWith(
      'tenant-123',
      'exp-1',
      dto,
    );
    expect(result.status).toBe('APPROVED');
  });
});
