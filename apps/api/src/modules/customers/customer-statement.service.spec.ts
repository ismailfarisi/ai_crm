import { CustomerStatementService } from './customer-statement.service';
import { Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { Invoice } from '../quotes/entities/invoice.entity';
import { InvoicePayment } from '../quotes/entities/invoice-payment.entity';
import { DocumentPdfRendererService } from '../document-templates/document-pdf-renderer.service';
import { Organization } from '../organizations/entities/organization.entity';
import { universalDocumentDataSchema } from '@saas/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('CustomerStatementService', () => {
  let service: CustomerStatementService;
  let mockCustomerRepo: Partial<Repository<Customer>>;
  let mockInvoiceRepo: Partial<Repository<Invoice>>;
  let mockPaymentRepo: Partial<Repository<InvoicePayment>>;
  let mockOrgRepo: Partial<Repository<Organization>>;
  let mockRenderer: Partial<DocumentPdfRendererService>;
  let mockTemplatesService: { resolveForDocumentType: jest.Mock };

  beforeEach(() => {
    mockCustomerRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'cust-1',
        name: 'Acme Industries',
        companyName: 'Acme Industries',
        email: 'billing@acme.com',
        phone: '+1 555 1234',
        organizationId: 'org-1',
        currency: 'USD',
      }),
    };
    mockOrgRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'org-1',
        name: 'Northwind',
        email: 'accounts@northwind.com',
        phone: '+1 800 1234',
        addressLine1: '123 Market St',
        city: 'Metropolis',
        country: 'US',
      }),
    };
    mockInvoiceRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-2026-0001',
          amount: 1000,
          currency: 'USD',
          issuedAt: new Date('2026-09-10'),
          dueDate: new Date('2026-10-10'),
        },
      ]),
    };
    mockPaymentRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'pay-1',
          invoiceId: 'inv-1',
          amount: 400,
          paidAt: new Date('2026-09-15'),
          notes: 'WIRE-9921',
        },
      ]),
    };
    mockRenderer = {
      render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test buffer')),
    };
    mockTemplatesService = {
      resolveForDocumentType: jest.fn().mockResolvedValue(null),
    };

    service = new CustomerStatementService(
      mockCustomerRepo as any,
      mockInvoiceRepo as any,
      mockPaymentRepo as any,
      mockOrgRepo as any,
      mockRenderer as any,
      mockTemplatesService as any,
    );
  });

  describe('generateStatementData', () => {
    it('should compute opening balance, transaction ledger, and closing balance', async () => {
      const data = await service.generateStatementData(
        'org-1',
        'cust-1',
        new Date('2026-09-01'),
        new Date('2026-09-30'),
      );

      expect(data.type).toBe('STATEMENT');
      expect(data.party.name).toBe('Acme Industries');
      expect(data.statementSummary).toBeDefined();
      expect(data.statementSummary?.openingBalance).toBe(0);
      expect(data.statementSummary?.closingBalance).toBe(600); // 1000 invoice - 400 payment
      expect(data.items.length).toBe(2); // 1 invoice + 1 payment row
      expect(data.items[1].code).toBe('WIRE-9921');
      expect(data.items[1].description).toBe('Payment (WIRE-9921)');
      expect(data.totals.total).toBe(600);
      expect(data.totals.balanceDue).toBe(600);

      // Validate against shared schema
      const parseResult = universalDocumentDataSchema.safeParse(data);
      expect(parseResult.success).toBe(true);
    });

    it('should calculate opening balance from transactions before the from date', async () => {
      // Prior invoice (500) and prior payment (200) -> opening balance 300
      mockInvoiceRepo.find = jest.fn().mockResolvedValue([
        {
          id: 'inv-prior',
          invoiceNumber: 'INV-2026-0000',
          amount: 500,
          currency: 'USD',
          issuedAt: new Date('2026-08-15'),
          dueDate: new Date('2026-08-30'),
        },
        {
          id: 'inv-current',
          invoiceNumber: 'INV-2026-0001',
          amount: 1000,
          currency: 'USD',
          issuedAt: new Date('2026-09-10'),
          dueDate: new Date('2026-10-10'),
        },
      ]);

      mockPaymentRepo.find = jest.fn().mockResolvedValue([
        {
          id: 'pay-prior',
          invoiceId: 'inv-prior',
          amount: 200,
          paidAt: new Date('2026-08-20'),
          notes: 'WIRE-8800',
        },
        {
          id: 'pay-current',
          invoiceId: 'inv-current',
          amount: 400,
          paidAt: new Date('2026-09-15'),
          notes: 'WIRE-9921',
        },
      ]);

      const data = await service.generateStatementData(
        'org-1',
        'cust-1',
        new Date('2026-09-01'),
        new Date('2026-09-30'),
      );

      expect(data.statementSummary?.openingBalance).toBe(300); // 500 - 200
      expect(data.statementSummary?.closingBalance).toBe(900); // 300 + 1000 - 400
      expect(data.items.length).toBe(2); // Only current period transactions
    });

    it('should calculate aging breakdown for open balances as of the statement end date', async () => {
      const asOf = new Date('2026-09-30');
      mockInvoiceRepo.find = jest.fn().mockResolvedValue([
        // Current: due after asOf
        {
          id: 'inv-curr',
          invoiceNumber: 'INV-CURR',
          amount: 100,
          currency: 'USD',
          issuedAt: new Date('2026-09-20'),
          dueDate: new Date('2026-10-20'),
        },
        // 1-30 days overdue: due 2026-09-15 (15 days overdue)
        {
          id: 'inv-d30',
          invoiceNumber: 'INV-D30',
          amount: 200,
          currency: 'USD',
          issuedAt: new Date('2026-08-15'),
          dueDate: new Date('2026-09-15'),
        },
        // 31-60 days overdue: due 2026-08-15 (46 days overdue)
        {
          id: 'inv-d60',
          invoiceNumber: 'INV-D60',
          amount: 300,
          currency: 'USD',
          issuedAt: new Date('2026-07-15'),
          dueDate: new Date('2026-08-15'),
        },
        // 61-90 days overdue: due 2026-07-15 (77 days overdue)
        {
          id: 'inv-d90',
          invoiceNumber: 'INV-D90',
          amount: 400,
          currency: 'USD',
          issuedAt: new Date('2026-06-15'),
          dueDate: new Date('2026-07-15'),
        },
        // 90+ days overdue: due 2026-05-15 (138 days overdue)
        {
          id: 'inv-d90p',
          invoiceNumber: 'INV-D90P',
          amount: 500,
          currency: 'USD',
          issuedAt: new Date('2026-04-15'),
          dueDate: new Date('2026-05-15'),
        },
      ]);
      mockPaymentRepo.find = jest.fn().mockResolvedValue([]);

      const data = await service.generateStatementData(
        'org-1',
        'cust-1',
        new Date('2026-09-01'),
        asOf,
      );

      const aging = data.statementSummary?.aging;
      expect(aging?.current).toBe(100);
      expect(aging?.days30).toBe(200);
      expect(aging?.days60).toBe(300);
      expect(aging?.days90).toBe(400);
      expect(aging?.days90Plus).toBe(500);
    });

    it('should not leak future payments into historical aging calculation', async () => {
      // Invoice created in June for $1,000, due 2026-07-01.
      // In DB, inv.paidAmount is 1,000 because it was paid in August.
      mockInvoiceRepo.find = jest.fn().mockResolvedValue([
        {
          id: 'inv-june',
          invoiceNumber: 'INV-JUNE',
          amount: 1000,
          paidAmount: 1000,
          currency: 'USD',
          issuedAt: new Date('2026-06-15'),
          dueDate: new Date('2026-07-01'),
        },
      ]);

      // Payment was posted on August 15 (after statement end date June 30)
      mockPaymentRepo.find = jest.fn().mockResolvedValue([
        {
          id: 'pay-future',
          invoiceId: 'inv-june',
          amount: 1000,
          paidAt: new Date('2026-08-15'),
          notes: 'Full payment in August',
        },
      ]);

      // Generating statement as of June 30
      const data = await service.generateStatementData(
        'org-1',
        'cust-1',
        new Date('2026-06-01'),
        new Date('2026-06-30'),
      );

      // As of June 30, payment has not occurred, so $1,000 is still outstanding
      const aging = data.statementSummary?.aging;
      expect(aging?.current).toBe(1000);
      expect(data.totals.balanceDue).toBe(1000);
    });

    it('should support payment without notes or reference (defaults to PAYMENT / Payment Received)', async () => {
      mockInvoiceRepo.find = jest.fn().mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-1',
          amount: 500,
          currency: 'USD',
          issuedAt: new Date('2026-09-10'),
          dueDate: new Date('2026-10-10'),
        },
      ]);
      mockPaymentRepo.find = jest.fn().mockResolvedValue([
        {
          id: 'pay-no-notes',
          invoiceId: 'inv-1',
          amount: 250,
          paidAt: new Date('2026-09-15'),
          notes: null,
        },
      ]);

      const data = await service.generateStatementData(
        'org-1',
        'cust-1',
        new Date('2026-09-01'),
        new Date('2026-09-30'),
      );

      expect(data.items[1].code).toBe('PAYMENT');
      expect(data.items[1].description).toBe('Payment Received');
    });

    it('should throw BadRequestException if dates are invalid or from > to', async () => {
      await expect(
        service.generateStatementData(
          'org-1',
          'cust-1',
          'not-a-date',
          new Date('2026-09-30'),
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.generateStatementData(
          'org-1',
          'cust-1',
          new Date('2026-09-01'),
          'not-a-date',
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.generateStatementData(
          'org-1',
          'cust-1',
          new Date('2026-10-01'),
          new Date('2026-09-01'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should parse string dates and set to date to end-of-day', async () => {
      const data = await service.generateStatementData(
        'org-1',
        'cust-1',
        '2026-09-01',
        '2026-09-30',
      );

      const periodTo = data.statementSummary?.periodTo as Date;
      expect(periodTo.getUTCHours()).toBe(23);
      expect(periodTo.getUTCMinutes()).toBe(59);
      expect(periodTo.getUTCSeconds()).toBe(59);
      expect(periodTo.getUTCMilliseconds()).toBe(999);
    });

    it('should throw NotFoundException if customer does not exist', async () => {
      mockCustomerRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.generateStatementData(
          'org-1',
          'non-existent',
          new Date('2026-09-01'),
          new Date('2026-09-30'),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStatementPdf', () => {
    it('should render PDF via DocumentPdfRendererService', async () => {
      const result = await service.getStatementPdf(
        'org-1',
        'cust-1',
        new Date('2026-09-01'),
        new Date('2026-09-30'),
      );

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toContain('Statement-Acme_Industries');
      expect(result.filename.endsWith('.pdf')).toBe(true);
      expect(mockRenderer.render).toHaveBeenCalled();
    });
  });
});
