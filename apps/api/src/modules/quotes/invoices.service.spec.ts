import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LedgerService } from '../finance/ledger.service';
import { InvoicesService } from './invoices.service';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { InvoicePayment } from './entities/invoice-payment.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { FinanceService } from '../finance/finance.service';
import { MailService } from '../mail/mail.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { AutomationEventBridgeService } from '../automations/services/automation-event-bridge.service';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let invoiceRepo: jest.Mocked<Partial<Repository<Invoice>>>;
  let paymentRepo: jest.Mocked<Partial<Repository<InvoicePayment>>>;
  let orgRepo: jest.Mocked<Partial<Repository<Organization>>>;
  let financeService: jest.Mocked<Partial<FinanceService>>;
  let mailService: jest.Mocked<Partial<MailService>>;
  let pdfService: jest.Mocked<Partial<InvoicePdfService>>;
  let automationEventBridgeService: jest.Mocked<
    Partial<AutomationEventBridgeService>
  >;
  let sequenceValue: number;
  let paymentSum: number;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const invoiceId = '22222222-2222-2222-2222-222222222222';
  const quoteId = '33333333-3333-3333-3333-333333333333';

  const baseInvoice = (): Invoice => ({
    id: invoiceId,
    tenantId,
    quoteId,
    invoiceNumber: 'INV-2026-0001',
    customerId: null,
    customerName: 'Acme Inc',
    customerEmail: 'billing@acme.com',
    currency: 'USD',
    items: [],
    subtotalAmount: 1000,
    discountAmount: 0,
    taxAmount: 0,
    amount: 1000,
    status: InvoiceStatus.ISSUED,
    paymentTerms: 'net_30',
    dueDate: null,
    notes: null,
    paidAt: null,
    paidAmount: 0,
    paidViaAccountId: null,
    sentAt: null,
    voidedAt: null,
    voidedById: null,
    voidReason: null,
    overdueNotifiedAt: null,
    issuedAt: new Date(),
    salesOrderId: null,
    billingScheduleLineId: null,
    stageLabel: null,
    deliveryNoteId: null,
    taxBreakdown: null,
    creditedAmount: 0,
    refundedAmount: 0,
  });

  beforeEach(() => {
    sequenceValue = 0;
    paymentSum = 0;

    invoiceRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((dto) => ({ ...dto })),
      save: jest.fn().mockImplementation(async (inv) => inv),
      manager: {
        query: jest.fn().mockImplementation(async () => {
          sequenceValue += 1;
          return [{ current_value: sequenceValue }];
        }),
      } as any,
    };

    const qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest
        .fn()
        .mockImplementation(async () => ({ sum: String(paymentSum) })),
    };

    paymentRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((dto) => ({ id: 'pay-1', ...dto })),
      save: jest.fn().mockImplementation(async (p) => p),
      createQueryBuilder: jest.fn().mockReturnValue(qb) as any,
    };

    orgRepo = {
      findOne: jest.fn().mockResolvedValue({ id: tenantId, name: 'Acme Org' }),
    };

    financeService = {
      recordInvoicePayment: jest.fn().mockResolvedValue({} as any),
      reverseInvoicePayment: jest.fn().mockResolvedValue({} as any),
    };

    mailService = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };

    pdfService = {
      generate: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    };

    automationEventBridgeService = {
      handleCrmEvent: jest.fn().mockResolvedValue([]),
    };

    // The service works inside a transaction; route its repositories back to
    // the fakes above, looked up lazily because tests replace them per case.
    const manager = {
      getRepository: (entity: { name: string }) => {
        if (entity.name === 'Invoice') {
          return {
            createQueryBuilder: () => {
              const qb: any = {
                setLock: () => qb,
                where: () => qb,
                andWhere: () => qb,
                getOne: () => invoiceRepo.findOne!({}),
              };
              return qb;
            },
            save: (row: Invoice) => invoiceRepo.save!(row),
          };
        }
        if (entity.name === 'InvoicePayment') return paymentRepo;
        if (entity.name === 'Organization') {
          return {
            findOne: jest.fn().mockResolvedValue({ baseCurrency: 'USD' }),
          };
        }
        if (entity.name === 'JournalEntry') {
          return { findOne: jest.fn().mockResolvedValue(null) };
        }
        return { update: jest.fn() };
      },
    };
    const dataSource = {
      transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
    };

    service = new InvoicesService(
      invoiceRepo as unknown as Repository<Invoice>,
      paymentRepo as unknown as Repository<InvoicePayment>,
      orgRepo as unknown as Repository<Organization>,
      financeService as unknown as FinanceService,
      mailService as unknown as MailService,
      pdfService as unknown as InvoicePdfService,
      automationEventBridgeService as unknown as AutomationEventBridgeService,
      {} as LedgerService,
      dataSource as unknown as DataSource,
    );
  });

  describe('recordPayment', () => {
    it('records a partial payment and sets status to PARTIALLY_PAID', async () => {
      invoiceRepo.findOne = jest.fn().mockResolvedValue(baseInvoice());
      paymentSum = 400;

      const result = await service.recordPayment(
        tenantId,
        invoiceId,
        { accountId: 'acc-1', amount: 400 },
        'user-1',
      );

      expect(financeService.recordInvoicePayment).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({ invoiceId, accountId: 'acc-1', amount: 400 }),
        expect.anything(),
      );
      expect(result.status).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(result.paidAmount).toBe(400);
      expect(automationEventBridgeService.handleCrmEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'invoice.partially_paid' }),
      );
    });

    it('records the final payment and flips status to PAID', async () => {
      const invoice = { ...baseInvoice(), paidAmount: 400 };
      invoiceRepo.findOne = jest.fn().mockResolvedValue(invoice);
      paymentSum = 1000;

      const result = await service.recordPayment(
        tenantId,
        invoiceId,
        { accountId: 'acc-1', amount: 600 },
        'user-1',
      );

      expect(result.status).toBe(InvoiceStatus.PAID);
      expect(result.paidAt).toBeTruthy();
      expect(automationEventBridgeService.handleCrmEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'invoice.paid' }),
      );
    });

    it('defaults the amount to the remaining balance when omitted', async () => {
      const invoice = { ...baseInvoice(), paidAmount: 300 };
      invoiceRepo.findOne = jest.fn().mockResolvedValue(invoice);
      paymentSum = 1000;

      await service.recordPayment(
        tenantId,
        invoiceId,
        { accountId: 'acc-1' },
        'user-1',
      );

      expect(financeService.recordInvoicePayment).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({ amount: 700 }),
        expect.anything(),
      );
    });

    it('rejects a payment exceeding the remaining balance', async () => {
      invoiceRepo.findOne = jest.fn().mockResolvedValue(baseInvoice());

      await expect(
        service.recordPayment(
          tenantId,
          invoiceId,
          { accountId: 'acc-1', amount: 5000 },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects recording a payment on an already-paid invoice', async () => {
      invoiceRepo.findOne = jest
        .fn()
        .mockResolvedValue({ ...baseInvoice(), status: InvoiceStatus.PAID });

      await expect(
        service.recordPayment(
          tenantId,
          invoiceId,
          { accountId: 'acc-1', amount: 100 },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects recording a payment on a voided invoice', async () => {
      invoiceRepo.findOne = jest.fn().mockResolvedValue({
        ...baseInvoice(),
        status: InvoiceStatus.CANCELLED,
      });

      await expect(
        service.recordPayment(
          tenantId,
          invoiceId,
          { accountId: 'acc-1', amount: 100 },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException for an unknown invoice', async () => {
      invoiceRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.recordPayment(
          tenantId,
          'missing',
          { accountId: 'acc-1', amount: 100 },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('voidInvoice', () => {
    it('reverses every recorded payment and cancels the invoice', async () => {
      invoiceRepo.findOne = jest.fn().mockResolvedValue({
        ...baseInvoice(),
        status: InvoiceStatus.PARTIALLY_PAID,
        paidAmount: 400,
      });
      paymentRepo.find = jest.fn().mockResolvedValue([
        {
          id: 'pay-1',
          invoiceId,
          amount: 300,
          accountId: 'acc-1',
        } as InvoicePayment,
        {
          id: 'pay-2',
          invoiceId,
          amount: 100,
          accountId: 'acc-2',
        } as InvoicePayment,
      ]);

      const result = await service.voidInvoice(
        tenantId,
        invoiceId,
        { reason: 'Issued in error' },
        'user-1',
      );

      expect(financeService.reverseInvoicePayment).toHaveBeenCalledTimes(2);
      expect(financeService.reverseInvoicePayment).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          paymentId: 'pay-1',
          accountId: 'acc-1',
          amount: 300,
        }),
        expect.anything(),
      );
      expect(financeService.reverseInvoicePayment).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          paymentId: 'pay-2',
          accountId: 'acc-2',
          amount: 100,
        }),
        expect.anything(),
      );
      expect(result.status).toBe(InvoiceStatus.CANCELLED);
      expect(result.voidedById).toBe('user-1');
      expect(result.voidReason).toBe('Issued in error');
      expect(automationEventBridgeService.handleCrmEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'invoice.voided' }),
      );
    });

    it('skips reversal for payments with no recorded account', async () => {
      invoiceRepo.findOne = jest.fn().mockResolvedValue(baseInvoice());
      paymentRepo.find = jest.fn().mockResolvedValue([
        {
          id: 'pay-1',
          invoiceId,
          amount: 300,
          accountId: null,
        },
      ]);

      await service.voidInvoice(tenantId, invoiceId, {}, 'user-1');

      expect(financeService.reverseInvoicePayment).not.toHaveBeenCalled();
    });

    it('rejects voiding an already-voided invoice', async () => {
      invoiceRepo.findOne = jest.fn().mockResolvedValue({
        ...baseInvoice(),
        status: InvoiceStatus.CANCELLED,
      });

      await expect(
        service.voidInvoice(tenantId, invoiceId, {}, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
