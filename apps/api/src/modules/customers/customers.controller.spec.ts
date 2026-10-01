import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerStatementService } from './customer-statement.service';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { BadRequestException } from '@nestjs/common';

describe('CustomersController', () => {
  let controller: CustomersController;
  let mockCustomersService: Partial<CustomersService>;
  let mockStatementService: Partial<CustomerStatementService>;

  const actor: AuthenticatedUser = {
    id: 'user-1',
    organizationId: 'org-1',
    email: 'admin@northwind.test',
    firstName: 'Ada',
    lastName: 'Admin',
    roles: ['admin'],
    level: 10,
    permissions: [],
    isOwner: false,
    teamId: null,
    managerId: null,
  };

  beforeEach(() => {
    mockCustomersService = {};
    mockStatementService = {
      getStatementPdf: jest.fn().mockResolvedValue({
        buffer: Buffer.from('%PDF-1.4 mock buffer'),
        filename: 'Statement-Acme_Industries-2026-09-30.pdf',
      }),
    };

    controller = new CustomersController(
      mockCustomersService as CustomersService,
      mockStatementService as CustomerStatementService,
    );
  });

  describe('getStatementPdf', () => {
    it('should call statementService.getStatementPdf and stream PDF to response', async () => {
      const mockRes = {
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.getStatementPdf(
        actor,
        'cust-1',
        '2026-09-01',
        '2026-09-30',
        mockRes,
      );

      const expectedTo = new Date('2026-09-30');
      expectedTo.setUTCHours(23, 59, 59, 999);

      expect(mockStatementService.getStatementPdf).toHaveBeenCalledWith(
        'org-1',
        'cust-1',
        new Date('2026-09-01'),
        expectedTo,
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="Statement-Acme_Industries-2026-09-30.pdf"',
      );
      expect(mockRes.end).toHaveBeenCalledWith(
        Buffer.from('%PDF-1.4 mock buffer'),
      );
    });

    it('should default from and to dates if not provided', async () => {
      const mockRes = {
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.getStatementPdf(
        actor,
        'cust-1',
        undefined,
        undefined,
        mockRes,
      );

      expect(mockStatementService.getStatementPdf).toHaveBeenCalled();
      const callArgs = (mockStatementService.getStatementPdf as jest.Mock).mock
        .calls[0];
      expect(callArgs[0]).toBe('org-1');
      expect(callArgs[1]).toBe('cust-1');
      expect(callArgs[2]).toBeInstanceOf(Date);
      expect(callArgs[3]).toBeInstanceOf(Date);
    });

    it('should preserve time if to date includes time component', async () => {
      const mockRes = {
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.getStatementPdf(
        actor,
        'cust-1',
        '2026-09-01T08:00:00.000Z',
        '2026-09-30T12:00:00.000Z',
        mockRes,
      );

      expect(mockStatementService.getStatementPdf).toHaveBeenCalledWith(
        'org-1',
        'cust-1',
        new Date('2026-09-01T08:00:00.000Z'),
        new Date('2026-09-30T12:00:00.000Z'),
      );
    });

    it('should throw BadRequestException if from date string is invalid', async () => {
      const mockRes = { setHeader: jest.fn(), end: jest.fn() } as any;

      await expect(
        controller.getStatementPdf(
          actor,
          'cust-1',
          'invalid-date',
          '2026-09-30',
          mockRes,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if to date string is invalid', async () => {
      const mockRes = { setHeader: jest.fn(), end: jest.fn() } as any;

      await expect(
        controller.getStatementPdf(
          actor,
          'cust-1',
          '2026-09-01',
          'invalid-date',
          mockRes,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if from date is after to date', async () => {
      const mockRes = { setHeader: jest.fn(), end: jest.fn() } as any;

      await expect(
        controller.getStatementPdf(
          actor,
          'cust-1',
          '2026-10-01',
          '2026-09-01',
          mockRes,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
