import { ChannelCommandService } from './channel-command.service';
import { ChannelProviderType } from '../entities/channel-config.entity';
import { QuoteStatus } from '../../quotes/entities/quote.entity';
import { AiNotConfiguredException } from '../../ai/interfaces/ai-provider.interface';
import { SkillRegistry } from '../skills/skill.registry';
import { SkillRouterService } from '../skills/skill-router.service';
import { CHANNEL_SKILLS, PERMISSIONS } from '@saas/shared';
import { FindOperator } from 'typeorm';

/**
 * The fake repositories below must honour TypeORM's find operators, not just
 * plain equality. `expireStale` filters on `Not(In([...]))` and
 * `LessThan(now)`; a fake that treats those as "matches anything" quietly
 * expires every live conversation and every confirmation test then falls
 * through to the help message.
 */
function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof FindOperator) {
    const op = expected.type as string;
    const value = expected.value as unknown;
    if (op === 'not') return !matchesValue(actual, value);
    if (op === 'in') return (value as unknown[]).includes(actual);
    if (op === 'lessThan')
      return new Date(actual as Date) < new Date(value as Date);
    if (op === 'moreThan')
      return new Date(actual as Date) > new Date(value as Date);
    throw new Error(`fake repository does not implement operator "${op}"`);
  }
  return actual === expected;
}

const matchesWhere = (row: any, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([k, v]) => matchesValue(row[k], v));

const orgId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const senderIdentifier = '998877';
const provider = ChannelProviderType.TELEGRAM;

const ALL_PERMS = [
  PERMISSIONS.QUOTE_APPROVE,
  PERMISSIONS.INVOICE_MANAGE,
  PERMISSIONS.PURCHASE_ORDER_CREATE,
];

interface Options {
  identities?: any[];
  linkCodes?: any[];
  conversations?: any[];
  quotes?: any[];
  suppliers?: any[];
  materials?: any[];
  prices?: any[];
  permissions?: string[];
  /** Queued AI responses, consumed in order: route, extract, route, extract... */
  aiResponses?: any[];
  aiError?: Error;
  sendToCustomer?: jest.Mock;
  createPurchaseOrder?: jest.Mock;
}

function makeService(o: Options = {}) {
  const identities = o.identities ?? [];
  const linkCodes = o.linkCodes ?? [];
  const conversations: any[] = o.conversations ?? [];
  const quotes = o.quotes ?? [];
  const suppliers = o.suppliers ?? [];
  const materials = o.materials ?? [];
  const prices = o.prices ?? [];

  const identityRepository = {
    findOne: jest.fn(
      async ({ where }: any) =>
        identities.find(
          (i) =>
            i.organizationId === where.organizationId &&
            i.provider === where.provider &&
            i.identifier === where.identifier,
        ) || null,
    ),
    find: jest.fn(async () => identities),
    create: jest.fn((dto: any) => ({ id: 'identity-1', ...dto })),
    save: jest.fn(async (i: any) => {
      identities.push(i);
      return i;
    }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const linkCodeRepository = {
    findOne: jest.fn(
      async ({ where }: any) =>
        linkCodes.find(
          (c) =>
            c.organizationId === where.organizationId &&
            c.code === where.code &&
            c.consumedAt == null,
        ) || null,
    ),
    create: jest.fn((dto: any) => ({ id: 'code-1', ...dto })),
    save: jest.fn(async (c: any) => {
      const idx = linkCodes.findIndex((x) => x.id === c.id);
      if (idx >= 0) linkCodes[idx] = c;
      else linkCodes.push(c);
      return c;
    }),
  };

  let seq = 0;
  const conversationRepository = {
    find: jest.fn(async ({ where }: any) => {
      const clauses = Array.isArray(where) ? where : [where];
      const hits = conversations.filter((c) =>
        clauses.some((w) => matchesWhere(c, w)),
      );
      return hits.sort((a, b) => b.createdAt - a.createdAt);
    }),
    create: jest.fn((dto: any) => ({
      id: `conv-${++seq}`,
      createdAt: Date.now(),
      ...dto,
    })),
    save: jest.fn(async (c: any) => {
      const idx = conversations.findIndex((x) => x.id === c.id);
      if (idx >= 0) conversations[idx] = { ...conversations[idx], ...c };
      else conversations.push(c);
      return c;
    }),
    update: jest.fn(async (criteria: any, patch: any) => {
      const match = (c: any) =>
        typeof criteria === 'string'
          ? c.id === criteria
          : matchesWhere(c, criteria);
      let affected = 0;
      for (const c of conversations) {
        if (match(c)) {
          Object.assign(c, patch);
          affected++;
        }
      }
      return { affected };
    }),
    createQueryBuilder: jest.fn(() => {
      const state: any = {};
      const builder: any = {
        update: () => builder,
        set: (patch: any) => {
          state.patch = patch;
          return builder;
        },
        where: (_sql: string, params: any) => {
          state.params = params;
          return builder;
        },
        execute: async () => {
          const row = conversations.find(
            (c) => c.id === state.params.id && c.status === state.params.status,
          );
          if (!row) return { affected: 0 };
          Object.assign(row, state.patch);
          return { affected: 1 };
        },
      };
      return builder;
    }),
  };

  const rbacService = {
    resolveAccess: jest.fn(async () => ({
      permissions: o.permissions ?? ALL_PERMS,
    })),
  };

  const quotesService = {
    findAllQuotes: jest.fn(async () => quotes),
    findQuoteById: jest.fn(async (_t: string, id: string) =>
      quotes.find((q) => q.id === id),
    ),
    sendSignal: jest.fn(async (_t: string, id: string) => ({
      ...quotes.find((q) => q.id === id),
      status: QuoteStatus.APPROVED,
    })),
  };

  const invoicesService = {
    findByQuoteId: jest.fn(async () => ({
      id: 'inv-1',
      invoiceNumber: 'INV-2026-0001',
      amount: 1000,
      currency: 'USD',
    })),
    sendToCustomer: o.sendToCustomer ?? jest.fn(async () => undefined),
  };

  const purchasingService = {
    findSuppliersByName: jest.fn(async (_t: string, q: string) =>
      suppliers.filter((s) =>
        s.companyName.toLowerCase().includes(q.toLowerCase()),
      ),
    ),
    findSupplierById: jest.fn(async (_t: string, id: string) =>
      suppliers.find((s) => s.id === id),
    ),
    findMaterialsByQuery: jest.fn(async (_t: string, q: string) =>
      materials.filter(
        (m) =>
          m.name.toLowerCase().includes(q.toLowerCase()) ||
          (m.sku ?? '').toLowerCase().includes(q.toLowerCase()),
      ),
    ),
    findMaterialById: jest.fn(async (_t: string, id: string) =>
      materials.find((m) => m.id === id),
    ),
    findSupplierPrice: jest.fn(
      async (_t: string, supplierId: string, materialId: string) =>
        prices.find(
          (p) => p.supplierId === supplierId && p.materialId === materialId,
        ) ?? null,
    ),
    createPurchaseOrder:
      o.createPurchaseOrder ??
      jest.fn(async () => ({
        id: 'po-1',
        poNumber: 'PO-2026-0042',
        totalAmount: 210,
        currency: 'GBP',
      })),
  };

  const queue = [...(o.aiResponses ?? [])];
  const aiService = {
    generateStructured: jest.fn(async () => {
      if (o.aiError) throw o.aiError;
      const next = queue.shift();
      return { data: next, model: 'claude-test' };
    }),
  };

  const registry = new SkillRegistry(
    quotesService as any,
    invoicesService as any,
    purchasingService as any,
    {} as any,
  );
  const router = new SkillRouterService(aiService as any);

  const service = new ChannelCommandService(
    identityRepository as any,
    linkCodeRepository as any,
    conversationRepository as any,
    rbacService as any,
    registry,
    router,
  );

  return {
    service,
    identities,
    linkCodes,
    conversations,
    quotesService,
    invoicesService,
    purchasingService,
    aiService,
    conversationRepository,
  };
}

const linkedIdentity = {
  id: 'identity-1',
  organizationId: orgId,
  provider,
  identifier: senderIdentifier,
  userId,
};

const openQuote = {
  id: 'quote-1',
  quoteNumber: 'QT-2026-0004',
  customerName: 'Acme Ltd',
  totalAmount: 1000,
  currency: 'USD',
  status: QuoteStatus.AWAITING_APPROVAL,
};

const papertree = {
  id: 'sup-1',
  companyName: 'Papertree Ltd',
  currency: 'GBP',
  leadTimeDays: 3,
};

const boardSra2 = {
  id: 'mat-1',
  name: '350gsm board SRA2',
  sku: 'BRD-350-SRA2',
  uom: 'SHEET',
};
const boardB1 = {
  id: 'mat-2',
  name: '350gsm board B1',
  sku: 'BRD-350-B1',
  uom: 'SHEET',
};

const send = (svc: ChannelCommandService, body: string) =>
  svc.handleInboundMessage(orgId, provider, senderIdentifier, body);

describe('ChannelCommandService', () => {
  describe('linking codes', () => {
    it('links a valid unexpired code and consumes it', async () => {
      const { service, identities, linkCodes } = makeService({
        linkCodes: [
          {
            id: 'code-1',
            organizationId: orgId,
            userId,
            code: 'ABCD2345',
            consumedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          },
        ],
      });

      const result = await send(service, 'ABCD2345');

      expect(result.handled).toBe(true);
      expect(result.userId).toBe(userId);
      expect(identities).toHaveLength(1);
      expect(linkCodes[0].consumedAt).not.toBeNull();
    });

    it('is case-insensitive when matching a code', async () => {
      const { service, identities } = makeService({
        linkCodes: [
          {
            id: 'code-1',
            organizationId: orgId,
            userId,
            code: 'ABCD2345',
            consumedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          },
        ],
      });

      await send(service, 'abcd2345');
      expect(identities).toHaveLength(1);
    });

    it('rejects an expired code and falls through as unhandled', async () => {
      const { service, identities } = makeService({
        linkCodes: [
          {
            id: 'code-1',
            organizationId: orgId,
            userId,
            code: 'ABCD2345',
            consumedAt: null,
            expiresAt: new Date(Date.now() - 1),
          },
        ],
      });

      const result = await send(service, 'ABCD2345');
      expect(result.handled).toBe(false);
      expect(identities).toHaveLength(0);
    });

    it('rejects an already-consumed code', async () => {
      const { service, identities } = makeService({
        linkCodes: [
          {
            id: 'code-1',
            organizationId: orgId,
            userId,
            code: 'ABCD2345',
            consumedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
          },
        ],
      });

      const result = await send(service, 'ABCD2345');
      expect(result.handled).toBe(false);
      expect(identities).toHaveLength(0);
    });
  });

  describe('unlinked sender', () => {
    it('returns handled: false and reveals nothing', async () => {
      const { service, aiService } = makeService();
      const result = await send(service, 'approve QT-2026-0004');

      expect(result.handled).toBe(false);
      expect(result.reply).toBeUndefined();
      // Never spends a model call on someone we do not recognise.
      expect(aiService.generateStructured).not.toHaveBeenCalled();
    });
  });

  describe('routing', () => {
    it('routes an approval to the quote skill and proposes it', async () => {
      const { service, conversations } = makeService({
        identities: [linkedIdentity],
        quotes: [openQuote],
        aiResponses: [
          { skill: CHANNEL_SKILLS.QUOTE_APPROVE, confidence: 0.95 },
          { action: 'APPROVE', quoteNumber: 'QT-2026-0004' },
        ],
      });

      const result = await send(service, 'approve QT-2026-0004');

      expect(result.reply?.body).toContain('QT-2026-0004');
      expect(result.reply?.body).toContain('Reply YES');
      expect(conversations[0].status).toBe('AWAITING_CONFIRM');
      expect(conversations[0].skillName).toBe(CHANNEL_SKILLS.QUOTE_APPROVE);
    });

    it('asks for clarification rather than acting on a low-confidence route', async () => {
      const { service, conversations } = makeService({
        identities: [linkedIdentity],
        quotes: [openQuote],
        aiResponses: [{ skill: CHANNEL_SKILLS.QUOTE_APPROVE, confidence: 0.3 }],
      });

      const result = await send(service, 'something vague');

      expect(result.reply?.body).toContain("I'm not sure");
      expect(conversations).toHaveLength(0);
    });

    it('offers help when the message is not a command at all', async () => {
      const { service } = makeService({
        identities: [linkedIdentity],
        aiResponses: [{ skill: null, confidence: 0.99 }],
      });

      const result = await send(service, 'morning!');
      expect(result.reply?.body).toContain('I can help with');
    });

    it('degrades to instructions when the AI provider is not configured', async () => {
      const { service } = makeService({
        identities: [linkedIdentity],
        aiError: new AiNotConfiguredException('nope'),
      });

      const result = await send(service, 'approve QT-2026-0004');
      expect(result.reply?.body).toContain("isn't available");
    });
  });

  describe('permissions', () => {
    it('never offers a skill the sender lacks permission for', async () => {
      const { service, aiService } = makeService({
        identities: [linkedIdentity],
        permissions: [PERMISSIONS.QUOTE_APPROVE],
        aiResponses: [{ skill: CHANNEL_SKILLS.QUOTE_APPROVE, confidence: 0.9 }],
        quotes: [openQuote],
      });

      await send(service, 'order 500 sheets from Papertree');

      // The router is shown only permitted skills, so purchase_order.create
      // cannot be routed to in the first place.
      const prompt =
        aiService.generateStructured.mock.calls[0][1].messages[0].content;
      expect(prompt).toContain(CHANNEL_SKILLS.QUOTE_APPROVE);
      expect(prompt).not.toContain(CHANNEL_SKILLS.PURCHASE_ORDER_CREATE);
    });

    it('tells a sender with no permissions that they have none', async () => {
      const { service, aiService } = makeService({
        identities: [linkedIdentity],
        permissions: [],
      });

      const result = await send(service, 'approve QT-2026-0004');
      expect(result.reply?.body).toContain("don't have permission");
      expect(aiService.generateStructured).not.toHaveBeenCalled();
    });

    it('refuses APPROVE_AND_SEND without INVOICE_MANAGE', async () => {
      const { service } = makeService({
        identities: [linkedIdentity],
        permissions: [PERMISSIONS.QUOTE_APPROVE],
        quotes: [openQuote],
        aiResponses: [
          { skill: CHANNEL_SKILLS.QUOTE_APPROVE, confidence: 0.95 },
          { action: 'APPROVE_AND_SEND', quoteNumber: 'QT-2026-0004' },
        ],
      });

      const result = await send(service, 'approve QT-2026-0004 and send it');
      expect(result.reply?.body).toContain(
        "don't have permission to send invoices",
      );
    });

    it('blocks execution when permission is revoked between proposal and confirmation', async () => {
      const conversations = [
        {
          id: 'conv-1',
          organizationId: orgId,
          userId,
          provider,
          senderIdentifier,
          skillName: CHANNEL_SKILLS.QUOTE_APPROVE,
          slots: {
            _resolved: {
              quoteId: 'quote-1',
              quoteNumber: 'QT-2026-0004',
              alsoSend: false,
            },
          },
          status: 'AWAITING_CONFIRM',
          createdAt: Date.now(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      ];
      const { service, quotesService } = makeService({
        identities: [linkedIdentity],
        conversations,
        permissions: [], // revoked since the proposal
      });

      const result = await send(service, 'yes');

      expect(result.reply?.body).toContain('permissions changed');
      expect(quotesService.sendSignal).not.toHaveBeenCalled();
    });
  });

  describe('confirmation', () => {
    const awaiting = () => [
      {
        id: 'conv-1',
        organizationId: orgId,
        userId,
        provider,
        senderIdentifier,
        skillName: CHANNEL_SKILLS.QUOTE_APPROVE,
        slots: {
          _resolved: {
            quoteId: 'quote-1',
            quoteNumber: 'QT-2026-0004',
            customerName: 'Acme Ltd',
            totalAmount: 1000,
            currency: 'USD',
            alsoSend: false,
          },
        },
        status: 'AWAITING_CONFIRM',
        createdAt: Date.now(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    ];

    it('executes on an affirmative reply', async () => {
      const conversations = awaiting();
      const { service, quotesService } = makeService({
        identities: [linkedIdentity],
        conversations,
        quotes: [openQuote],
      });

      const result = await send(service, 'yes');

      expect(quotesService.sendSignal).toHaveBeenCalledTimes(1);
      expect(result.reply?.body).toContain('INV-2026-0001');
      expect(conversations[0].status).toBe('CONFIRMED');
    });

    it('cancels on a negative reply without executing', async () => {
      const conversations = awaiting();
      const { service, quotesService } = makeService({
        identities: [linkedIdentity],
        conversations,
        quotes: [openQuote],
      });

      const result = await send(service, 'no');

      expect(quotesService.sendSignal).not.toHaveBeenCalled();
      expect(result.reply?.body).toContain('Cancelled');
      expect(conversations[0].status).toBe('CANCELLED');
    });

    it('re-prompts on an ambiguous reply and leaves the row pending', async () => {
      const conversations = awaiting();
      const { service, quotesService } = makeService({
        identities: [linkedIdentity],
        conversations,
        quotes: [openQuote],
      });

      const result = await send(service, 'maybe later');

      expect(quotesService.sendSignal).not.toHaveBeenCalled();
      expect(result.reply?.body).toContain('Reply YES');
      expect(conversations[0].status).toBe('AWAITING_CONFIRM');
    });

    it('executes once when the same confirmation is delivered twice', async () => {
      const conversations = awaiting();
      const { service, quotesService } = makeService({
        identities: [linkedIdentity],
        conversations,
        quotes: [openQuote],
      });

      const first = await send(service, 'yes');
      const second = await send(service, 'yes');

      // A provider retrying a webhook it believed failed must not approve twice.
      expect(quotesService.sendSignal).toHaveBeenCalledTimes(1);
      expect(first.reply?.body).toContain('INV-2026-0001');
      expect(second.reply?.body).toContain('already done');
    });

    it('reports a half-success honestly when sending the invoice fails', async () => {
      const conversations = awaiting();
      conversations[0].slots._resolved.alsoSend = true;
      const { service } = makeService({
        identities: [linkedIdentity],
        conversations,
        quotes: [openQuote],
        sendToCustomer: jest.fn(async () => {
          throw new Error('SMTP down');
        }),
      });

      const result = await send(service, 'yes');

      expect(result.reply?.body).toContain('approved');
      expect(result.reply?.body).toContain('SMTP down');
    });
  });

  describe('purchase order slot filling', () => {
    const poRoute = {
      skill: CHANNEL_SKILLS.PURCHASE_ORDER_CREATE,
      confidence: 0.93,
    };

    it('asks which material when the description is ambiguous, then resolves the choice in code', async () => {
      const { service, conversations, aiService } = makeService({
        identities: [linkedIdentity],
        suppliers: [papertree],
        materials: [boardSra2, boardB1],
        prices: [
          {
            supplierId: 'sup-1',
            materialId: 'mat-1',
            unitCost: 0.42,
            minOrderQty: null,
          },
        ],
        aiResponses: [
          poRoute,
          {
            supplierQuery: 'Papertree',
            lines: [{ materialQuery: '350gsm board', qty: 500 }],
          },
        ],
      });

      const ask = await send(
        service,
        'order 500 sheets of 350gsm board from Papertree',
      );
      expect(ask.reply?.body).toContain('BRD-350-SRA2');
      expect(ask.reply?.body).toContain('BRD-350-B1');
      expect(conversations[0].status).toBe('COLLECTING');

      const callsBefore = aiService.generateStructured.mock.calls.length;
      const proposal = await send(service, 'SRA2');

      // Answering a choice is deterministic — no model call, so no chance for
      // a model to invent an id.
      expect(aiService.generateStructured.mock.calls.length).toBe(callsBefore);
      expect(proposal.reply?.body).toContain('Papertree Ltd');
      expect(proposal.reply?.body).toContain('210.00 GBP');
      expect(proposal.reply?.body).toContain('DRAFT');
      expect(conversations[0].status).toBe('AWAITING_CONFIRM');
    });

    it('asks for a quantity rather than inventing one', async () => {
      const { service, conversations } = makeService({
        identities: [linkedIdentity],
        suppliers: [papertree],
        materials: [boardSra2],
        prices: [
          {
            supplierId: 'sup-1',
            materialId: 'mat-1',
            unitCost: 0.42,
            minOrderQty: null,
          },
        ],
        aiResponses: [
          poRoute,
          { supplierQuery: 'Papertree', lines: [{ materialQuery: 'SRA2' }] },
        ],
      });

      const result = await send(
        service,
        'order some SRA2 board from Papertree',
      );

      expect(result.reply?.body).toContain('How many');
      expect(conversations[0].status).toBe('COLLECTING');
    });

    it('refuses below the supplier minimum order quantity', async () => {
      const { service } = makeService({
        identities: [linkedIdentity],
        suppliers: [papertree],
        materials: [boardSra2],
        prices: [
          {
            supplierId: 'sup-1',
            materialId: 'mat-1',
            unitCost: 0.42,
            minOrderQty: 250,
          },
        ],
        aiResponses: [
          poRoute,
          {
            supplierQuery: 'Papertree',
            lines: [{ materialQuery: 'SRA2', qty: 10 }],
          },
        ],
      });

      const result = await send(service, 'order 10 SRA2 from Papertree');
      expect(result.reply?.body).toContain('minimum quantities of 250');
    });

    it('refuses when the supplier has no price on record', async () => {
      const { service } = makeService({
        identities: [linkedIdentity],
        suppliers: [papertree],
        materials: [boardSra2],
        prices: [],
        aiResponses: [
          poRoute,
          {
            supplierQuery: 'Papertree',
            lines: [{ materialQuery: 'SRA2', qty: 500 }],
          },
        ],
      });

      const result = await send(service, 'order 500 SRA2 from Papertree');
      expect(result.reply?.body).toContain('no price on record');
    });

    it('creates the order as a draft, priced from the supplier list', async () => {
      const createPurchaseOrder = jest.fn(async () => ({
        id: 'po-1',
        poNumber: 'PO-2026-0042',
        totalAmount: 210,
        currency: 'GBP',
      }));
      const conversations = [
        {
          id: 'conv-1',
          organizationId: orgId,
          userId,
          provider,
          senderIdentifier,
          skillName: CHANNEL_SKILLS.PURCHASE_ORDER_CREATE,
          slots: {
            _resolved: {
              supplierId: 'sup-1',
              supplierName: 'Papertree Ltd',
              currency: 'GBP',
              leadTimeDays: 3,
              lines: [
                {
                  materialId: 'mat-1',
                  description: '350gsm board SRA2',
                  qty: 500,
                  uom: 'SHEET',
                  unitCost: 0.42,
                },
              ],
            },
          },
          status: 'AWAITING_CONFIRM',
          createdAt: Date.now(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      ];

      const { service } = makeService({
        identities: [linkedIdentity],
        conversations,
        suppliers: [papertree],
        materials: [boardSra2],
        createPurchaseOrder,
      });

      const result = await send(service, 'yes');

      expect(createPurchaseOrder).toHaveBeenCalledTimes(1);
      const [, , input] = createPurchaseOrder.mock.calls[0] as any[];
      expect(input.lines[0].unitCost).toBe(0.42);
      expect(input.originMetadata.origin).toBe('AI_DRAFTED');
      expect(input.originMetadata.promptVersion).toBe('po-create/1');
      expect(result.reply?.body).toContain('PO-2026-0042');
      expect(result.reply?.body).toContain('draft');
    });
  });
});
