import { BadRequestException } from '@nestjs/common';
import { QuoteProofsService } from './quote-proofs.service';
import { QuoteStatus } from './entities/quote.entity';

const tenantId = '11111111-1111-1111-1111-111111111111';
const user: any = { id: 'u1', organizationId: tenantId };
const at = new Date('2026-11-01T10:00:00Z');

function proof(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'p1',
    tenantId,
    quoteId: 'q1',
    attachmentId: 'a1',
    version: 1,
    status: 'PENDING',
    staffNote: null,
    uploadedById: 'u1',
    respondedAt: null,
    respondedByName: null,
    responseComment: null,
    supersededAt: null,
    createdAt: at,
    ...overrides,
  };
}

function makeService(
  options: { quote?: Record<string, unknown>; rows?: any[]; orgDefault?: boolean } = {},
) {
  const quote: any = {
    id: 'q1',
    tenantId,
    quoteNumber: 'QT-2026-0001',
    status: QuoteStatus.APPROVED,
    supersededAt: null,
    acceptedAt: null,
    proofRequired: null,
    customerResponse: null,
    ...options.quote,
  };
  const rows = options.rows ?? [];
  const saved: any[] = [];
  const managerQuery = jest.fn(async () => []);
  const txRepo = {
    findOne: jest.fn(async () => rows[0] ?? null),
    create: (v: any) => v,
    save: jest.fn(async (v: any) => saved.push(v)),
  };
  const proofs: any = {
    find: jest.fn(async () => rows),
    manager: {
      transaction: async (fn: any) =>
        fn({ query: managerQuery, getRepository: () => txRepo }),
    },
  };
  const quotes: any = {
    findOne: jest.fn(async () => quote),
    update: jest.fn(async () => undefined),
  };
  const attachments: any = {
    find: jest.fn(async () => [
      { id: 'a1', storageKey: 'k1', filename: 'box-v1.pdf', contentType: 'application/pdf' },
      { id: 'a2', storageKey: 'k2', filename: 'box-v2.png', contentType: 'image/png' },
    ]),
  };
  const organizations: any = {
    findOne: jest.fn(async () => ({ quoteProofRequiredDefault: options.orgDefault ?? false })),
  };
  const workOrders: any = {
    findOne: jest.fn(async () => ({ id: 'w1', salesOrderId: 's1' })),
  };
  const salesOrders: any = { findOne: jest.fn(async () => ({ id: 's1', quoteId: 'q1' })) };
  const users: any = { find: jest.fn(async () => []) };
  const attachmentsService: any = { upload: jest.fn(async () => ({ id: 'a9' })) };
  const storage: any = {
    linkFor: jest.fn(async (id: string) => ({
      url: `https://api.example.test/attachments/${id}/download?sig=x`,
      expiresAt: new Date('2026-11-01T10:05:00Z'),
    })),
  };
  const service = new QuoteProofsService(
    proofs,
    quotes,
    attachments,
    organizations,
    workOrders,
    salesOrders,
    users,
    attachmentsService,
    storage,
  );
  return { service, quote, saved, managerQuery, attachments, attachmentsService, storage };
}

describe('QuoteProofsService', () => {
  it('takes PDFs and images only', async () => {
    const { service, attachmentsService } = makeService();

    await expect(
      service.upload(user, 'q1', { mimetype: 'text/plain', originalname: 'a.txt' } as any, null),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(attachmentsService.upload).not.toHaveBeenCalled();
  });

  it('will not add a proof to a quote a revision replaced', async () => {
    const { service, attachmentsService } = makeService({ quote: { supersededAt: at } });

    await expect(
      service.upload(user, 'q1', { mimetype: 'application/pdf' } as any, null),
    ).rejects.toThrow('newer revision');
    expect(attachmentsService.upload).not.toHaveBeenCalled();
  });

  it('adds the next version and supersedes the live one', async () => {
    const { service, saved, managerQuery, attachmentsService } = makeService({
      rows: [proof({ id: 'p2', version: 2, status: 'CHANGES_REQUESTED' }), proof({ supersededAt: at })],
    });

    await service.upload(user, 'q1', { mimetype: 'image/png' } as any, 'Logo bigger');

    expect(attachmentsService.upload).toHaveBeenCalledWith(user, 'QUOTE', 'q1', expect.anything());
    expect(managerQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET "superseded_at"'),
      [tenantId, 'q1', expect.any(Date)],
    );
    expect(saved[0]).toEqual(
      expect.objectContaining({ version: 3, status: 'PENDING', attachmentId: 'a9', staffNote: 'Logo bigger' }),
    );
  });

  it('falls back to the organisation default until the quote has its own setting', async () => {
    expect(await makeService({ orgDefault: true }).service.isRequired({ tenantId, proofRequired: null } as any)).toBe(true);
    expect(await makeService({ orgDefault: true }).service.isRequired({ tenantId, proofRequired: false } as any)).toBe(false);
  });

  it('blocks acceptance until the latest live proof is approved', async () => {
    const required = { quote: { proofRequired: true } };
    const pending = makeService({ ...required, rows: [proof()] });
    expect(await pending.service.blocksAcceptance(pending.quote)).toBe(true);

    const none = makeService(required);
    expect(await none.service.blocksAcceptance(none.quote)).toBe(true);

    // An older approval does not count once a newer version is live.
    const newer = makeService({
      ...required,
      rows: [proof({ id: 'p2', version: 2 }), proof({ status: 'APPROVED', supersededAt: at })],
    });
    expect(await newer.service.blocksAcceptance(newer.quote)).toBe(true);

    const approved = makeService({ ...required, rows: [proof({ status: 'APPROVED' })] });
    expect(await approved.service.blocksAcceptance(approved.quote)).toBe(false);

    const off = makeService({ quote: { proofRequired: false }, rows: [proof()] });
    expect(await off.service.blocksAcceptance(off.quote)).toBe(false);
  });

  it('signs links only for the files proof rows name', async () => {
    const { service, quote, attachments, storage } = makeService({
      rows: [proof({ id: 'p2', version: 2, attachmentId: 'a2' }), proof({ supersededAt: at })],
    });

    const result = await service.forPublic(quote);

    const asked = attachments.find.mock.calls[0][0].where.id;
    expect(asked.value ?? asked._value).toEqual(['a2', 'a1']);
    expect(storage.linkFor).toHaveBeenCalledTimes(2);
    expect(result.map((p) => [p.version, p.superseded, p.contentType])).toEqual([
      [2, false, 'image/png'],
      [1, true, 'application/pdf'],
    ]);
    expect(result[0].url).toContain('/attachments/a2/');
  });

  it('gives the floor the approved version and warns about a newer one', async () => {
    const { service, storage } = makeService({
      rows: [
        proof({ id: 'p2', version: 2, attachmentId: 'a2' }),
        proof({ status: 'APPROVED', respondedByName: 'Jo Bloggs', respondedAt: at, supersededAt: at }),
      ],
    });

    const result = await service.forWorkOrder(tenantId, 'w1');

    expect(result?.proof).toEqual(
      expect.objectContaining({ version: 1, filename: 'box-v1.pdf', approvedByName: 'Jo Bloggs' }),
    );
    expect(result?.newerVersion).toEqual({ version: 2, status: 'PENDING' });
    expect(storage.linkFor).toHaveBeenCalledWith('a1', 'k1', 'box-v1.pdf');
  });
});
