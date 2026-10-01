import { Reflector } from '@nestjs/core';
import { StreamableFile } from '@nestjs/common';
import { PERMISSIONS } from '@saas/shared';
import { PERMISSIONS_KEY } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { InvoicesService } from './invoices.service';
import { QuoteAcceptanceService } from './quote-acceptance.service';

describe('QuotesController', () => {
  let controller: QuotesController;
  let quotesService: jest.Mocked<Partial<QuotesService>>;
  let invoicesService: jest.Mocked<Partial<InvoicesService>>;
  let acceptanceService: jest.Mocked<Partial<QuoteAcceptanceService>>;
  const reflector = new Reflector();

  const user: AuthenticatedUser = {
    id: 'user-1',
    organizationId: 'org-111',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    roles: ['member'],
    level: 10,
    permissions: [],
    isOwner: false,
    teamId: null,
    managerId: null,
  };

  beforeEach(() => {
    quotesService = {
      getPdf: jest.fn().mockResolvedValue({
        buffer: Buffer.from('%PDF-1.4 mock quote pdf'),
        filename: 'QT-2026-0001.pdf',
      }),
    };
    invoicesService = {
      getPdf: jest.fn().mockResolvedValue({
        buffer: Buffer.from('%PDF-1.4 mock invoice pdf'),
        filename: 'INV-2026-0001.pdf',
      }),
    };
    acceptanceService = {};

    controller = new QuotesController(
      quotesService as QuotesService,
      invoicesService as InvoicesService,
      acceptanceService as QuoteAcceptanceService,
    );
  });

  describe('GET /quotes/:id/pdf', () => {
    it('should protect downloadQuotePdf with PERMISSIONS.QUOTE_READ', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.downloadQuotePdf,
      );
      expect(perms).toEqual([PERMISSIONS.QUOTE_READ]);
    });

    it('should call quotesService.getPdf, set headers, and return StreamableFile', async () => {
      const mockRes = {
        set: jest.fn(),
      } as any;

      const file = await controller.downloadQuotePdf(
        user,
        'quote-123',
        mockRes,
      );

      expect(quotesService.getPdf).toHaveBeenCalledWith('org-111', 'quote-123');
      expect(mockRes.set).toHaveBeenCalledWith({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="QT-2026-0001.pdf"',
      });
      expect(file).toBeInstanceOf(StreamableFile);
    });
  });
});
