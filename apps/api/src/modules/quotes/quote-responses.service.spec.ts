import { BadRequestException, GoneException } from '@nestjs/common';
import { QuoteResponsesService } from './quote-responses.service';
import { QuoteStatus } from './entities/quote.entity';

const tenantId = '11111111-1111-1111-1111-111111111111';
const token = 'a'.repeat(43);

function makeService(
  options: {
    refusal?: string | null;
    affected?: number;
    latest?: any;
    mailFails?: boolean;
  } = {},
) {
  const quote: any = {
    id: 'q1',
    tenantId,
    quoteNumber: 'QT-2026-0001',
    customerName: 'Acme',
    status: QuoteStatus.APPROVED,
    parentQuoteId: null,
    customerResponse: null,
    customerResponseNote: null,
  };
  const updateQb = () => {
    const qb: any = {
      update: () => qb,
      set: jest.fn(() => qb),
      where: () => qb,
      andWhere: () => qb,
      execute: jest.fn(async () => ({ affected: options.affected ?? 1 })),
    };
    return qb;
  };
  const quoteQb = updateQb();
  const proofQb = updateQb();
  const quotes: any = {
    createQueryBuilder: jest.fn(() => quoteQb),
    manager: {
      query: jest.fn(async () => [
        { id: 'u1', email: 'owner@northwind.test' },
        { id: 'u2', email: null },
      ]),
    },
  };
  const proofRows: any = { createQueryBuilder: jest.fn(() => proofQb) };
  const acceptance: any = {
    withQuoteFor: jest.fn((_token: string, fn: any) => fn(quote)),
    refusalFor: jest.fn(() => options.refusal ?? null),
    refuse: jest.fn((reason: string) => {
      throw new GoneException({ reason });
    }),
    toPublic: jest.fn(async (q: any) => ({ customerResponse: q.customerResponse })),
  };
  const proofs: any = {
    latestFor: jest.fn(async () =>
      options.latest === undefined
        ? { id: 'p2', version: 2, status: 'PENDING', supersededAt: null }
        : options.latest,
    ),
  };
  const notifications: any = { notifyUsers: jest.fn(async () => 2) };
  const mail: any = {
    sendMail: jest.fn(async () => {
      if (options.mailFails) throw new Error('SES down');
    }),
  };
  const audit: any = { record: jest.fn(async () => undefined) };
  const config: any = { get: () => 'https://app.example.test' };
  const service = new QuoteResponsesService(
    quotes,
    proofRows,
    acceptance,
    proofs,
    notifications,
    mail,
    audit,
    config,
  );
  return { service, quote, quoteQb, proofQb, acceptance, notifications, mail, audit };
}

describe('QuoteResponsesService', () => {
  it('records a decline with the customer name, audits it without a user and tells staff', async () => {
    const { service, quote, audit, notifications, mail } = makeService();

    const view = await service.decline(token, { name: 'Jo Bloggs', reason: 'Too dear' }, '203.0.113.9');

    expect(view.customerResponse).toBe('DECLINED');
    expect(quote.customerRespondedByName).toBe('Jo Bloggs');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        action: 'quote.customer_decline',
        subjectType: 'QUOTE',
        subjectId: 'q1',
        actorName: 'Jo Bloggs (customer)',
        ip: '203.0.113.9',
      }),
    );
    expect(audit.record.mock.calls[0][0].actorId).toBeUndefined();
    expect(notifications.notifyUsers).toHaveBeenCalledWith(
      tenantId,
      ['u1', 'u2'],
      expect.objectContaining({ type: 'QUOTE_CUSTOMER_RESPONSE', entityId: 'q1', link: '/quotes/q1' }),
    );
    // Only recipients with an address get mail.
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it('escapes what the customer typed before it goes into the email', async () => {
    const { service, mail } = makeService();

    await service.requestChanges(
      token,
      { name: '<b>Jo</b>', note: '<script>alert(1)</script>\nBlue, not red' },
      undefined,
    );

    const { html, text } = mail.sendMail.mock.calls[0][0];
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Jo</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;<br>Blue, not red');
    expect(text).toContain('Blue, not red');
  });

  it('refuses on the same grounds as acceptance and records nothing', async () => {
    const { service, audit, notifications, quoteQb } = makeService({ refusal: 'EXPIRED' });

    await expect(
      service.requestChanges(token, { name: 'Jo Bloggs', note: 'Bigger logo' }, undefined),
    ).rejects.toBeInstanceOf(GoneException);
    expect(quoteQb.execute).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.notifyUsers).not.toHaveBeenCalled();
  });

  it('records nothing when the quote changed underneath the response', async () => {
    const { service, audit, acceptance } = makeService({ affected: 0 });

    await expect(
      service.decline(token, { name: 'Jo Bloggs', reason: null }, undefined),
    ).rejects.toBeInstanceOf(GoneException);
    expect(acceptance.refuse).toHaveBeenCalledWith('NO_LONGER_AVAILABLE');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('still answers the customer when the email fails', async () => {
    const { service, audit } = makeService({ mailFails: true });

    await expect(
      service.decline(token, { name: 'Jo Bloggs', reason: null }, undefined),
    ).resolves.toBeDefined();
    expect(audit.record).toHaveBeenCalled();
  });

  it('approves the latest pending proof and audits it by version', async () => {
    const { service, audit, notifications, proofQb, acceptance } = makeService();

    await service.approveProof(token, 'p2', { name: 'Jo Bloggs' }, undefined);

    expect(acceptance.refusalFor).toHaveBeenCalledWith(expect.anything(), { allowAccepted: true });
    expect(proofQb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'APPROVED', respondedByName: 'Jo Bloggs' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quote.proof_approve',
        actorName: 'Jo Bloggs (customer)',
        summary: expect.stringContaining('v2 of'),
      }),
    );
    expect(notifications.notifyUsers).toHaveBeenCalledWith(
      tenantId,
      expect.any(Array),
      expect.objectContaining({ type: 'QUOTE_PROOF_RESPONSE', entityId: 'p2' }),
    );
  });

  it('will not let an old version be answered', async () => {
    const { service, audit } = makeService();

    await expect(
      service.requestProofChanges(token, 'p1', { name: 'Jo Bloggs', comment: 'Wrong colour' }, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('will not answer the same proof twice', async () => {
    const { service } = makeService({
      latest: { id: 'p2', version: 2, status: 'APPROVED', supersededAt: null },
    });

    await expect(
      service.approveProof(token, 'p2', { name: 'Jo Bloggs' }, undefined),
    ).rejects.toThrow('already been answered');
  });
});
