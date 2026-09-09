import { ChannelCommandService } from './channel-command.service';
import { ChannelProviderType } from '../entities/channel-config.entity';
import { PendingChannelCommandStatus } from '../entities/pending-channel-command.entity';
import { QuoteStatus } from '../../quotes/entities/quote.entity';
import { AiNotConfiguredException } from '../../ai/interfaces/ai-provider.interface';

const orgId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const senderIdentifier = '998877';
const provider = ChannelProviderType.TELEGRAM;

function makeService(
  overrides: {
    identities?: any[];
    linkCodes?: any[];
    pendings?: any[];
    quotes?: any[];
    resolveAccess?: jest.Mock;
    generateStructured?: jest.Mock;
    sendToCustomer?: jest.Mock;
  } = {},
) {
  const identities = overrides.identities ?? [];
  const linkCodes = overrides.linkCodes ?? [];
  const pendings = overrides.pendings ?? [];
  const quotes = overrides.quotes ?? [];

  const identityRepository = {
    findOne: jest
      .fn()
      .mockImplementation(
        async ({ where }: any) =>
          identities.find(
            (i) =>
              i.organizationId === where.organizationId &&
              i.provider === where.provider &&
              i.identifier === where.identifier,
          ) || null,
      ),
    find: jest
      .fn()
      .mockImplementation(async ({ where }: any) =>
        identities.filter(
          (i) =>
            i.organizationId === where.organizationId &&
            i.userId === where.userId,
        ),
      ),
    create: jest
      .fn()
      .mockImplementation((dto: any) => ({ id: 'identity-1', ...dto })),
    save: jest.fn().mockImplementation(async (i: any) => {
      identities.push(i);
      return i;
    }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const linkCodeRepository = {
    findOne: jest
      .fn()
      .mockImplementation(
        async ({ where }: any) =>
          linkCodes.find(
            (c) =>
              c.organizationId === where.organizationId &&
              c.code === where.code &&
              c.consumedAt == null,
          ) || null,
      ),
    create: jest
      .fn()
      .mockImplementation((dto: any) => ({ id: 'code-1', ...dto })),
    save: jest.fn().mockImplementation(async (c: any) => {
      const idx = linkCodes.findIndex((x) => x.id === c.id);
      if (idx >= 0) linkCodes[idx] = c;
      else linkCodes.push(c);
      return c;
    }),
  };

  const pendingRepository = {
    findOne: jest
      .fn()
      .mockImplementation(
        async ({ where }: any) =>
          pendings.find(
            (p) =>
              p.organizationId === where.organizationId &&
              p.provider === where.provider &&
              p.senderIdentifier === where.senderIdentifier &&
              p.status === where.status,
          ) || null,
      ),
    create: jest
      .fn()
      .mockImplementation((dto: any) => ({ id: 'pending-1', ...dto })),
    save: jest.fn().mockImplementation(async (p: any) => {
      const idx = pendings.findIndex((x) => x.id === p.id);
      if (idx >= 0) pendings[idx] = p;
      else pendings.push(p);
      return p;
    }),
  };

  const quotesService = {
    findAllQuotes: jest.fn().mockResolvedValue(quotes),
    findQuoteById: jest
      .fn()
      .mockImplementation(async (_tenantId: string, id: string) =>
        quotes.find((q) => q.id === id),
      ),
    sendSignal: jest
      .fn()
      .mockImplementation(async (_tenantId: string, quoteId: string) => {
        const quote = quotes.find((q) => q.id === quoteId);
        return { ...quote, status: QuoteStatus.APPROVED };
      }),
  };

  const invoicesService = {
    findByQuoteId: jest.fn().mockResolvedValue({
      id: 'invoice-1',
      invoiceNumber: 'INV-2026-0001',
      amount: 1000,
      currency: 'USD',
      customerEmail: 'billing@acme.com',
    }),
    sendToCustomer:
      overrides.sendToCustomer ?? jest.fn().mockResolvedValue(undefined),
  };

  const aiService = {
    generateStructured: overrides.generateStructured ?? jest.fn(),
  };

  const rbacService = {
    resolveAccess:
      overrides.resolveAccess ??
      jest.fn().mockResolvedValue({
        permissions: ['quote:approve', 'invoice:manage'],
      }),
  };

  const service = new ChannelCommandService(
    identityRepository as any,
    linkCodeRepository as any,
    pendingRepository as any,
    quotesService as any,
    invoicesService as any,
    aiService as any,
    rbacService as any,
  );

  return {
    service,
    identities,
    linkCodes,
    pendings,
    quotes,
    identityRepository,
    linkCodeRepository,
    pendingRepository,
    quotesService,
    invoicesService,
    aiService,
    rbacService,
  };
}

describe('ChannelCommandService', () => {
  describe('linking codes', () => {
    it('links a valid unexpired code and consumes it', async () => {
      const { service, identities, linkCodes } = makeService({
        linkCodes: [
          {
            id: 'code-1',
            organizationId: orgId,
            userId,
            code: 'ABCD1234',
            expiresAt: new Date(Date.now() + 60_000),
            consumedAt: null,
          },
        ],
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'ABCD1234',
      );

      expect(result.handled).toBe(true);
      expect(result.userId).toBe(userId);
      expect(identities).toHaveLength(1);
      expect(identities[0]).toMatchObject({
        organizationId: orgId,
        provider,
        identifier: senderIdentifier,
        userId,
      });
      expect(linkCodes[0].consumedAt).toBeInstanceOf(Date);
    });

    it('is case-insensitive when matching a code', async () => {
      const { service } = makeService({
        linkCodes: [
          {
            id: 'code-1',
            organizationId: orgId,
            userId,
            code: 'ABCD1234',
            expiresAt: new Date(Date.now() + 60_000),
            consumedAt: null,
          },
        ],
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'abcd1234',
      );
      expect(result.handled).toBe(true);
    });

    it('rejects an expired code and falls through as unhandled', async () => {
      const { service } = makeService({
        linkCodes: [
          {
            id: 'code-1',
            organizationId: orgId,
            userId,
            code: 'ABCD1234',
            expiresAt: new Date(Date.now() - 1000),
            consumedAt: null,
          },
        ],
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'ABCD1234',
      );
      expect(result).toEqual({ handled: false });
    });

    it('rejects an already-consumed code', async () => {
      const { service } = makeService({
        linkCodes: [
          {
            id: 'code-1',
            organizationId: orgId,
            userId,
            code: 'ABCD1234',
            expiresAt: new Date(Date.now() + 60_000),
            consumedAt: new Date(),
          },
        ],
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'ABCD1234',
      );
      expect(result).toEqual({ handled: false });
    });
  });

  describe('unlinked sender', () => {
    it('returns handled: false for a sender with no identity and no matching code', async () => {
      const { service } = makeService();
      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'hello there',
      );
      expect(result).toEqual({ handled: false });
    });
  });

  describe('fresh intent parsing', () => {
    const linkedIdentity = {
      organizationId: orgId,
      provider,
      identifier: senderIdentifier,
      userId,
    };
    const quote = {
      id: 'quote-1',
      tenantId: orgId,
      quoteNumber: 'QT-2026-0004',
      customerName: 'Acme Corp',
      totalAmount: 1200,
      currency: 'USD',
      status: QuoteStatus.AWAITING_APPROVAL,
    };

    it('creates a pending command on a valid parsed intent with an exact quote number', async () => {
      const generateStructured = jest.fn().mockResolvedValue({
        data: {
          isQuoteApprovalCommand: true,
          action: 'APPROVE',
          quoteNumber: 'QT-2026-0004',
        },
      });
      const { service, pendings } = makeService({
        identities: [linkedIdentity],
        quotes: [quote],
        generateStructured,
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'approve QT-2026-0004',
      );

      expect(result.handled).toBe(true);
      expect(result.reply?.body).toContain('QT-2026-0004');
      expect(pendings).toHaveLength(1);
      expect(pendings[0].status).toBe(PendingChannelCommandStatus.PENDING);
    });

    it('degrades to an instructional reply when AI is not configured', async () => {
      const generateStructured = jest
        .fn()
        .mockRejectedValue(new AiNotConfiguredException());
      const { service, pendings } = makeService({
        identities: [linkedIdentity],
        quotes: [quote],
        generateStructured,
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'please approve the acme quote',
      );

      expect(result.handled).toBe(true);
      expect(result.reply?.body).toMatch(/exact quote number/i);
      expect(pendings).toHaveLength(0);
    });

    it('replies with a help message when the intent is not a quote-approval command', async () => {
      const generateStructured = jest
        .fn()
        .mockResolvedValue({ data: { isQuoteApprovalCommand: false } });
      const { service, pendings } = makeService({
        identities: [linkedIdentity],
        generateStructured,
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'what time is it',
      );

      expect(result.handled).toBe(true);
      expect(pendings).toHaveLength(0);
    });
  });

  describe('quote resolution', () => {
    const linkedIdentity = {
      organizationId: orgId,
      provider,
      identifier: senderIdentifier,
      userId,
    };

    it('replies asking for the number when zero quotes match', async () => {
      const generateStructured = jest.fn().mockResolvedValue({
        data: {
          isQuoteApprovalCommand: true,
          action: 'APPROVE',
          customerName: 'Nobody Inc',
        },
      });
      const { service, pendings } = makeService({
        identities: [linkedIdentity],
        quotes: [],
        generateStructured,
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'approve the Nobody Inc quote',
      );
      expect(result.reply?.body).toMatch(/couldn't find/i);
      expect(pendings).toHaveLength(0);
    });

    it('asks the sender to be specific when multiple quotes match by customer name', async () => {
      const generateStructured = jest.fn().mockResolvedValue({
        data: {
          isQuoteApprovalCommand: true,
          action: 'APPROVE',
          customerName: 'Acme',
        },
      });
      const quotes = [
        {
          id: 'q1',
          tenantId: orgId,
          quoteNumber: 'QT-2026-0001',
          customerName: 'Acme Corp',
          totalAmount: 100,
          currency: 'USD',
          status: QuoteStatus.AWAITING_APPROVAL,
        },
        {
          id: 'q2',
          tenantId: orgId,
          quoteNumber: 'QT-2026-0002',
          customerName: 'Acme Industries',
          totalAmount: 200,
          currency: 'USD',
          status: QuoteStatus.DRAFT,
        },
      ];
      const { service, pendings } = makeService({
        identities: [linkedIdentity],
        quotes,
        generateStructured,
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'approve the Acme quote',
      );
      expect(result.reply?.body).toMatch(/multiple matching quotes/i);
      expect(pendings).toHaveLength(0);
    });

    it('refuses to create a pending command for an already-approved quote', async () => {
      const generateStructured = jest.fn().mockResolvedValue({
        data: {
          isQuoteApprovalCommand: true,
          action: 'APPROVE',
          quoteNumber: 'QT-2026-0009',
        },
      });
      const quotes = [
        {
          id: 'q1',
          tenantId: orgId,
          quoteNumber: 'QT-2026-0009',
          customerName: 'Acme',
          totalAmount: 100,
          currency: 'USD',
          status: QuoteStatus.APPROVED,
        },
      ];
      const { service, pendings } = makeService({
        identities: [linkedIdentity],
        quotes,
        generateStructured,
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'approve QT-2026-0009',
      );
      expect(result.reply?.body).toMatch(/already approved/i);
      expect(pendings).toHaveLength(0);
    });
  });

  describe('confirm / cancel / ambiguous replies', () => {
    const linkedIdentity = {
      organizationId: orgId,
      provider,
      identifier: senderIdentifier,
      userId,
    };
    const quote = {
      id: 'quote-1',
      tenantId: orgId,
      quoteNumber: 'QT-2026-0004',
      customerName: 'Acme',
      totalAmount: 1000,
      currency: 'USD',
      status: QuoteStatus.AWAITING_APPROVAL,
    };
    const pending = {
      id: 'pending-1',
      organizationId: orgId,
      userId,
      provider,
      senderIdentifier,
      action: 'APPROVE',
      quoteId: 'quote-1',
      status: PendingChannelCommandStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
    };

    it('executes the action on an affirmative reply', async () => {
      const { service, quotesService, pendings } = makeService({
        identities: [linkedIdentity],
        quotes: [quote],
        pendings: [{ ...pending }],
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'yes',
      );

      expect(quotesService.sendSignal).toHaveBeenCalledWith(
        orgId,
        'quote-1',
        'APPROVE',
      );
      expect(pendings[0].status).toBe(PendingChannelCommandStatus.CONFIRMED);
      expect(result.reply?.body).toContain('Approved');
    });

    it('sends the invoice too when the pending action is APPROVE_AND_SEND', async () => {
      const sendToCustomer = jest.fn().mockResolvedValue(undefined);
      const { service, invoicesService } = makeService({
        identities: [linkedIdentity],
        quotes: [quote],
        pendings: [{ ...pending, action: 'APPROVE_AND_SEND' }],
        sendToCustomer,
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'yes',
      );

      expect(invoicesService.sendToCustomer).toHaveBeenCalledWith(
        orgId,
        'invoice-1',
      );
      expect(result.reply?.body).toMatch(/emailed/i);
    });

    it('cancels on a negative reply without executing anything', async () => {
      const { service, quotesService, pendings } = makeService({
        identities: [linkedIdentity],
        quotes: [quote],
        pendings: [{ ...pending }],
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'no',
      );

      expect(quotesService.sendSignal).not.toHaveBeenCalled();
      expect(pendings[0].status).toBe(PendingChannelCommandStatus.CANCELLED);
      expect(result.reply?.body).toMatch(/cancelled/i);
    });

    it('re-prompts on an ambiguous reply, leaving the pending row untouched', async () => {
      const { service, quotesService, pendings } = makeService({
        identities: [linkedIdentity],
        quotes: [quote],
        pendings: [{ ...pending }],
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'maybe later',
      );

      expect(quotesService.sendSignal).not.toHaveBeenCalled();
      expect(pendings[0].status).toBe(PendingChannelCommandStatus.PENDING);
      expect(result.reply?.body).toMatch(/YES.*NO|reply YES/i);
    });
  });

  describe('permission checks', () => {
    const linkedIdentity = {
      organizationId: orgId,
      provider,
      identifier: senderIdentifier,
      userId,
    };
    const quote = {
      id: 'quote-1',
      tenantId: orgId,
      quoteNumber: 'QT-2026-0004',
      customerName: 'Acme',
      totalAmount: 1000,
      currency: 'USD',
      status: QuoteStatus.AWAITING_APPROVAL,
    };

    it('refuses when the user lacks QUOTE_APPROVE', async () => {
      const generateStructured = jest.fn().mockResolvedValue({
        data: {
          isQuoteApprovalCommand: true,
          action: 'APPROVE',
          quoteNumber: 'QT-2026-0004',
        },
      });
      const resolveAccess = jest.fn().mockResolvedValue({ permissions: [] });
      const { service, pendings } = makeService({
        identities: [linkedIdentity],
        quotes: [quote],
        generateStructured,
        resolveAccess,
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'approve QT-2026-0004',
      );

      expect(result.reply?.body).toMatch(/don't have permission to approve/i);
      expect(pendings).toHaveLength(0);
    });

    it('refuses APPROVE_AND_SEND when the user has QUOTE_APPROVE but not INVOICE_MANAGE', async () => {
      const generateStructured = jest.fn().mockResolvedValue({
        data: {
          isQuoteApprovalCommand: true,
          action: 'APPROVE_AND_SEND',
          quoteNumber: 'QT-2026-0004',
        },
      });
      const resolveAccess = jest
        .fn()
        .mockResolvedValue({ permissions: ['quote:approve'] });
      const { service, pendings } = makeService({
        identities: [linkedIdentity],
        quotes: [quote],
        generateStructured,
        resolveAccess,
      });

      const result = await service.handleInboundMessage(
        orgId,
        provider,
        senderIdentifier,
        'approve QT-2026-0004 and send it',
      );

      expect(result.reply?.body).toMatch(
        /don't have permission to send invoices/i,
      );
      expect(pendings).toHaveLength(0);
    });
  });
});
