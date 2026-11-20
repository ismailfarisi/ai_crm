import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { AppConfig } from '../src/config/configuration';
import { AppModule } from './../src/app.module';
import { TenantContextService } from '../src/common/context/tenant-context.service';
import { ChannelAgentRunner } from '../src/modules/channels/agents/channel-agent-runner';
import type { ChannelAgent } from '../src/modules/channels/entities/channel-agent.entity';
import { CustomerLookupService } from '../src/modules/channels/services/customer-lookup.service';
import { CustomerSenderService } from '../src/modules/channels/services/customer-sender.service';

/**
 * A customer agent's order and quote lookups against a real database, as the
 * NOBYPASSRLS app role: two customers in one organization and a second
 * organization, each with a quote and an order. The model is scripted; the
 * sender matching, the queries and row-level security are the real ones.
 *
 * The thing being proved: a sender only ever hears about the one customer
 * the channel ties them to, and a number that belongs to someone else reads
 * exactly like a number that does not exist.
 */
describe('Customer agent order and quote lookups (e2e)', () => {
  let app: INestApplication<App>;
  let tenant: TenantContextService;
  let senders: CustomerSenderService;
  let lookup: CustomerLookupService;

  const TIMEOUT = 90_000;
  const api = '/api/v1';
  const stamp = Date.now();

  interface Org {
    cookie: string;
    organizationId: string;
    customers: Record<string, string>;
    orders: Record<string, string>;
    quotes: Record<string, string>;
  }
  const orgs: Record<'one' | 'two', Org> = {
    one: {
      cookie: '',
      organizationId: '',
      customers: {},
      orders: {},
      quotes: {},
    },
    two: {
      cookie: '',
      organizationId: '',
      customers: {},
      orders: {},
      quotes: {},
    },
  };

  const as = (org: Org) => ({
    get: (path: string) =>
      request(app.getHttpServer())
        .get(`${api}${path}`)
        .set('Cookie', [org.cookie]),
    post: (path: string, body?: object) =>
      request(app.getHttpServer())
        .post(`${api}${path}`)
        .set('Cookie', [org.cookie])
        .send(body ?? {}),
    patch: (path: string, body: object) =>
      request(app.getHttpServer())
        .patch(`${api}${path}`)
        .set('Cookie', [org.cookie])
        .send(body),
    delete: (path: string) =>
      request(app.getHttpServer())
        .delete(`${api}${path}`)
        .set('Cookie', [org.cookie]),
  });

  async function register(org: Org, name: string) {
    const res = await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({
        organizationName: `${name} ${stamp}`,
        firstName: 'Omar',
        lastName: 'Owner',
        email: `${name.toLowerCase()}-${stamp}@example.com`,
        password: 'Password123!',
      })
      .expect(201);
    const set = res.headers['set-cookie'] as unknown as string[];
    org.cookie = set
      .find((c) => c.startsWith('crm_access_token='))!
      .split(';')[0];
    const me = await as(org).get('/auth/me').expect(200);
    org.organizationId = me.body.organization.id;
    await as(org).patch('/organization', { country: 'AE' }).expect(200);
  }

  /** A customer with an accepted quote, and so an order. */
  async function customerWithOrder(
    org: Org,
    key: string,
    customer: {
      companyName: string;
      phone?: string;
      email?: string;
      country?: string;
    },
    title: string,
    listPrice: number,
  ) {
    const http = as(org);
    const created = await http.post('/customers', customer).expect(201);
    org.customers[key] = created.body.id;
    const item = await http
      .post('/catalog/items', {
        sku: `${key}-${stamp}`,
        name: title,
        listPrice,
        standardCost: listPrice / 2,
      })
      .expect(201);
    const resolved = await http
      .post('/catalog/resolve-lines', {
        lines: [
          { kind: 'CATALOG_ITEM', catalogItemId: item.body.id, quantity: 10 },
        ],
      })
      .expect(201);
    const quote = await http
      .post('/quotes', {
        title,
        customerId: created.body.id,
        customerName: customer.companyName,
        items: resolved.body.lines,
      })
      .expect(201);
    await http
      .post(`/quotes/${quote.body.id}/signal`, { action: 'APPROVE' })
      .expect(201);
    const accepted = await http
      .post(`/quotes/${quote.body.id}/mark-accepted`, { name: 'Buyer' })
      .expect(201);
    org.quotes[key] = accepted.body.quoteNumber;
    const order = await http
      .get(`/quotes/${quote.body.id}/sales-order`)
      .expect(200);
    org.orders[key] = order.body.order.orderNumber;
  }

  const inOrg = <T>(org: Org, fn: () => Promise<T>) =>
    tenant.runWithTenant(org.organizationId, fn);

  const AL_NOOR_WHATSAPP = '971501112222';
  const GULF_PRINT_WHATSAPP = '971503334444';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    const config = app.get(ConfigService<AppConfig, true>);
    app.setGlobalPrefix(config.get('apiPrefix', { infer: true }));
    app.use(cookieParser());
    app.set('trust proxy', 1);
    await app.init();
    tenant = app.get(TenantContextService);
    senders = app.get(CustomerSenderService);
    lookup = app.get(CustomerLookupService);

    await register(orgs.one, 'Lookup');
    await customerWithOrder(
      orgs.one,
      'alNoor',
      // As an office would type it: local format, no country on the record.
      {
        companyName: 'Al Noor Sweets',
        phone: '050 111 2222',
        email: 'Orders@AlNoor.example',
      },
      'Al Noor gift boxes',
      120,
    );
    await customerWithOrder(
      orgs.one,
      'gulfPrint',
      { companyName: 'Gulf Print', phone: '+971 50 333 4444' },
      'Gulf Print launch sleeves',
      987,
    );
    await register(orgs.two, 'Rival');
    // The other organization knows the same number under another name.
    await customerWithOrder(
      orgs.two,
      'sameNumber',
      { companyName: 'Rival Trading', phone: '+971501112222' },
      'Rival pallets',
      555,
    );
  }, TIMEOUT);

  afterAll(async () => {
    await app.close();
  }, TIMEOUT);

  it(
    'ties a WhatsApp number to the one customer whose record carries it, per organization',
    async () => {
      const one = await inOrg(orgs.one, () =>
        senders.resolve(
          orgs.one.organizationId,
          'WHATSAPP_META',
          AL_NOOR_WHATSAPP,
        ),
      );
      expect(one).toEqual({
        customerId: orgs.one.customers.alNoor,
        companyName: 'Al Noor Sweets',
        via: 'ON_RECORD',
      });
      const two = await inOrg(orgs.two, () =>
        senders.resolve(
          orgs.two.organizationId,
          'WHATSAPP_META',
          AL_NOOR_WHATSAPP,
        ),
      );
      expect(two?.companyName).toBe('Rival Trading');

      const stranger = await inOrg(orgs.one, () =>
        senders.resolve(
          orgs.one.organizationId,
          'WHATSAPP_META',
          '971509990000',
        ),
      );
      expect(stranger).toBeNull();
      const byEmail = await inOrg(orgs.one, () =>
        senders.resolve(
          orgs.one.organizationId,
          'EMAIL_SMTP',
          'orders@alnoor.example',
        ),
      );
      expect(byEmail?.customerId).toBe(orgs.one.customers.alNoor);
    },
    TIMEOUT,
  );

  it(
    "gives a customer their own order and answers someone else's number as one that does not exist",
    async () => {
      const { organizationId, customers, orders, quotes } = orgs.one;
      const ask = (number?: string) =>
        inOrg(orgs.one, () =>
          lookup.orders(organizationId, customers.alNoor, number),
        );

      const own = await ask(orders.alNoor);
      expect(own.found).toBe(true);
      expect(own.records).toHaveLength(1);
      expect(own.records[0]).toMatchObject({
        orderNumber: orders.alNoor,
        total: expect.any(Number),
        items: [
          expect.objectContaining({
            description: expect.any(String),
            ordered: 10,
          }),
        ],
      });

      const invented = await ask('SO-999999');
      expect(invented.found).toBe(false);
      for (const theirs of [
        orders.gulfPrint,
        quotes.gulfPrint,
        orgs.two.orders.sameNumber,
      ]) {
        const result = await ask(theirs);
        // Order numbers are per organization, so the other organization's
        // may coincide with one of Al Noor's own; then it is simply theirs.
        if (theirs === orders.alNoor || theirs === quotes.alNoor) continue;
        expect({ ...result, askedFor: null }).toEqual({
          ...invented,
          askedFor: null,
        });
      }

      const everything = JSON.stringify([own, invented, await ask()]);
      expect(everything).not.toContain('Gulf Print');
      expect(everything).not.toContain('Rival');
      expect(everything).not.toContain('987');
    },
    TIMEOUT,
  );

  it(
    "gives a customer their own quotes and nobody else's",
    async () => {
      const { organizationId, customers, quotes } = orgs.one;
      const ask = (number?: string) =>
        inOrg(orgs.one, () =>
          lookup.quotes(organizationId, customers.alNoor, number),
        );

      const own = await ask(quotes.alNoor);
      expect(own.records).toEqual([
        expect.objectContaining({
          quoteNumber: quotes.alNoor,
          title: 'Al Noor gift boxes',
          status: expect.stringMatching(/^Accepted on /),
          orderNumber: orgs.one.orders.alNoor,
        }),
      ]);
      const invented = await ask('Q-999999');
      const theirs = await ask(quotes.gulfPrint);
      expect({ ...theirs, askedFor: null }).toEqual({
        ...invented,
        askedFor: null,
      });
      expect(JSON.stringify([own, theirs, await ask()])).not.toContain(
        'Gulf Print',
      );
    },
    TIMEOUT,
  );

  it(
    'row-level security hides one organization from a lookup run as another',
    async () => {
      // The right customer id, the wrong organization: the app role sees no rows.
      const crossed = await inOrg(orgs.two, () =>
        lookup.orders(orgs.two.organizationId, orgs.one.customers.alNoor),
      );
      expect(crossed.records).toEqual([]);
      const forged = await inOrg(orgs.two, () =>
        lookup.orders(orgs.one.organizationId, orgs.one.customers.alNoor),
      );
      expect(forged.records).toEqual([]);
    },
    TIMEOUT,
  );

  describe('through an agent', () => {
    const agent = {
      id: 'support',
      name: 'Support',
      description: 'Order questions',
      instructions: 'Be brief.',
      kind: 'CUSTOMER',
      skills: ['check_order_status', 'check_quote_status'],
      channels: ['WHATSAPP_META'],
      isEnabled: true,
      model: null,
      provider: null,
    } as unknown as ChannelAgent;

    /** Runs one message; the model asks for `orderNumber`, then says "ok". */
    async function tell(senderIdentifier: string, orderNumber: string) {
      const generateWithTools = jest
        .fn()
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [
            {
              id: 't1',
              name: 'check_order_status',
              input: { order_number: orderNumber },
            },
          ],
          raw: null,
          stopReason: null,
        })
        .mockResolvedValueOnce({
          text: 'ok',
          toolCalls: [],
          raw: null,
          stopReason: null,
        });
      const runner = new ChannelAgentRunner({
        aiService: {
          generateStructured: jest.fn(),
          generateWithTools,
        } as never,
        agents: { findEnabled: async () => [agent] },
        senders,
        lookup,
      });
      await inOrg(orgs.one, () =>
        runner.runCustomerTurn({
          organizationId: orgs.one.organizationId,
          provider: 'WHATSAPP_META',
          contactId: 'contact',
          senderIdentifier,
          transcript: [{ role: 'customer', body: `Where is ${orderNumber}?` }],
        }),
      );
      return generateWithTools.mock.calls[1][1].messages.at(-1).content[0]
        .content as string;
    }

    it(
      "tells Al Noor about Al Noor's order",
      async () => {
        const said = await tell(AL_NOOR_WHATSAPP, orgs.one.orders.alNoor);
        expect(JSON.parse(said)).toMatchObject({
          customer: 'Al Noor Sweets',
          found: true,
          records: [{ orderNumber: orgs.one.orders.alNoor }],
        });
      },
      TIMEOUT,
    );

    it(
      "does not tell Al Noor whether Gulf Print's order exists",
      async () => {
        const theirs = await tell(AL_NOOR_WHATSAPP, orgs.one.orders.gulfPrint);
        const invented = await tell(AL_NOOR_WHATSAPP, 'SO-999999');
        const blank = (said: string) => ({
          ...JSON.parse(said),
          askedFor: null,
        });
        expect(blank(theirs)).toEqual(blank(invented));
        expect(theirs).not.toContain('Gulf Print');
        expect(JSON.parse(theirs).found).toBe(false);

        // And Gulf Print, asking for the same order, does get it.
        const owner = await tell(
          GULF_PRINT_WHATSAPP,
          orgs.one.orders.gulfPrint,
        );
        expect(JSON.parse(owner)).toMatchObject({
          customer: 'Gulf Print',
          found: true,
        });
      },
      TIMEOUT,
    );

    it(
      'tells a stranger the same thing whatever number they try',
      async () => {
        const real = await tell('971509990000', orgs.one.orders.alNoor);
        const invented = await tell('971509990000', 'SO-999999');
        expect(real).toBe(invented);
        expect(real).toContain('Nothing was looked up');
        expect(real).not.toContain(orgs.one.orders.alNoor);
      },
      TIMEOUT,
    );
  });

  describe('links made by staff', () => {
    const TELEGRAM_CHAT = '660011223';

    it(
      'make a sender the customer until the link is removed',
      async () => {
        const http = as(orgs.one);
        const check = () =>
          http
            .get('/channels/customer-senders/check')
            .query({ provider: 'TELEGRAM', identifier: TELEGRAM_CHAT })
            .expect(200);

        expect((await check()).body.status).toBe('UNKNOWN');

        const link = await http
          .post('/channels/customer-senders', {
            customerId: orgs.one.customers.gulfPrint,
            provider: 'TELEGRAM',
            identifier: TELEGRAM_CHAT,
          })
          .expect(201);
        expect((await check()).body).toEqual({
          status: 'LINKED',
          customer: {
            id: orgs.one.customers.gulfPrint,
            companyName: 'Gulf Print',
          },
          linkId: link.body.id,
        });
        const listed = await http
          .get('/channels/customer-senders')
          .query({ customerId: orgs.one.customers.gulfPrint })
          .expect(200);
        expect(listed.body).toHaveLength(1);

        // The other organization cannot see, use or remove it.
        const rival = as(orgs.two);
        const fromOutside = await rival
          .get('/channels/customer-senders/check')
          .query({ provider: 'TELEGRAM', identifier: TELEGRAM_CHAT })
          .expect(200);
        expect(fromOutside.body.status).toBe('UNKNOWN');
        await rival
          .delete(`/channels/customer-senders/${link.body.id}`)
          .expect(404);
        await rival
          .post('/channels/customer-senders', {
            customerId: orgs.one.customers.gulfPrint,
            provider: 'TELEGRAM',
            identifier: '660099887',
          })
          .expect(404);

        await http
          .delete(`/channels/customer-senders/${link.body.id}`)
          .expect(200);
        expect((await check()).body.status).toBe('UNKNOWN');
      },
      TIMEOUT,
    );

    it(
      'refuse a group chat and an address list',
      async () => {
        const http = as(orgs.one);
        const customerId = orgs.one.customers.alNoor;
        await http
          .post('/channels/customer-senders', {
            customerId,
            provider: 'TELEGRAM',
            identifier: '-100123456',
          })
          .expect(400);
        await http
          .post('/channels/customer-senders', {
            customerId,
            provider: 'EMAIL_SMTP',
            identifier: 'orders@alnoor.example, thief@evil.test',
          })
          .expect(400);
      },
      TIMEOUT,
    );
  });
});
