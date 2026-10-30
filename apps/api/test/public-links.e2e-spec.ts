import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { AppConfig } from '../src/config/configuration';
import { AppModule } from './../src/app.module';

/**
 * Links that work without a session — a customer's quote link, a signed file
 * download — against a database that enforces row-level security.
 *
 * A request with no session has no tenant, and the database then shows no
 * rows at all. These routes find their row by an unguessable token instead,
 * so they must look it up outside any tenant and then act as the tenant the
 * row belongs to. Run as the NOBYPASSRLS app role, as in CI and production.
 */
describe('Public links (e2e)', () => {
  let app: INestApplication<App>;
  let cookie: string;

  const TIMEOUT = 60_000;
  const api = '/api/v1';
  const get = (path: string) =>
    request(app.getHttpServer()).get(`${api}${path}`).set('Cookie', [cookie]);
  const post = (path: string, body?: object) =>
    request(app.getHttpServer()).post(`${api}${path}`).set('Cookie', [cookie]).send(body ?? {});

  let quoteId: string;
  let token: string;

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

    const register = await request(app.getHttpServer())
      .post(`${api}/auth/register`)
      .send({
        organizationName: 'Links E2E',
        firstName: 'Lin',
        lastName: 'Kerr',
        email: `links-${Date.now()}@example.com`,
        password: 'Password123!',
      })
      .expect(201);
    const set = register.headers['set-cookie'] as unknown as string[];
    cookie = set.find((c) => c.startsWith('crm_access_token='))!.split(';')[0];

    const item = await post('/catalog/items', { sku: 'LNK-1', name: 'Rigid box', listPrice: 120, standardCost: 50 }).expect(201);
    const resolved = await post('/catalog/resolve-lines', {
      lines: [{ kind: 'CATALOG_ITEM', catalogItemId: item.body.id, quantity: 2 }],
    }).expect(201);
    const quote = await post('/quotes', {
      title: 'Boxes for Al Noor',
      customerName: 'Al Noor Sweets',
      customerEmail: 'buyer@alnoor.example',
      items: resolved.body.lines,
    }).expect(201);
    quoteId = quote.body.id;
    // Only an approved quote can go to a customer, and approving one no
    // longer creates its order: that waits for the customer to accept.
    await post(`/quotes/${quoteId}/acceptance-link`).expect(400);
    await post(`/quotes/${quoteId}/signal`, { action: 'APPROVE' }).expect(201);
    const before = await get(`/quotes/${quoteId}/sales-order`).expect(200);
    expect(before.body.order).toBeNull();
    const link = await post(`/quotes/${quoteId}/acceptance-link`).expect(201);
    token = String(link.body.url).split('/q/')[1];
  }, TIMEOUT);

  afterAll(async () => {
    await app.close();
  }, TIMEOUT);

  it(
    'opens a quote from its link with no session',
    async () => {
      const view = await request(app.getHttpServer()).get(`${api}/public/quotes/${token}`).expect(200);
      expect(view.body.organizationName).toBe('Links E2E');
      expect(view.body).not.toHaveProperty('tenantId');
    },
    TIMEOUT,
  );

  it(
    'accepts a quote from its link, once',
    async () => {
      const accepted = await request(app.getHttpServer())
        .post(`${api}/public/quotes/${token}/accept`)
        .send({ name: 'Fatima Al Noor' })
        .expect(200);
      expect(accepted.body.acceptedByName).toBe('Fatima Al Noor');
      await request(app.getHttpServer())
        .post(`${api}/public/quotes/${token}/accept`)
        .send({ name: 'Someone Else' })
        .expect(400);
      const inside = await get(`/quotes/${quoteId}`).expect(200);
      expect(inside.body.acceptedByName).toBe('Fatima Al Noor');
      // Accepting is what turns the approved quote into an order.
      const order = await get(`/quotes/${quoteId}/sales-order`).expect(200);
      expect(order.body.order?.quoteId).toBe(quoteId);
    },
    TIMEOUT,
  );

  it(
    'still refuses a link that is not one',
    async () => {
      await request(app.getHttpServer())
        .get(`${api}/public/quotes/${'x'.repeat(43)}`)
        .expect(404);
    },
    TIMEOUT,
  );

  it(
    'downloads a file through its signed link with no session, and not with a bad signature',
    async () => {
      // Large enough that a response written twice is cut off part-way.
      const body = Buffer.concat([
        Buffer.from('%PDF-1.4\n% artwork proof\n'),
        Buffer.alloc(300_000, 0x41),
        Buffer.from('\n%%EOF'),
      ]);
      const uploaded = await request(app.getHttpServer())
        .post(`${api}/attachments`)
        .query({ ownerType: 'QUOTE', ownerId: quoteId })
        .set('Cookie', [cookie])
        .attach('file', body, { filename: 'proof.pdf', contentType: 'application/pdf' })
        .expect(201);
      const link = await get(`/attachments/${uploaded.body.id}/link`).expect(200);
      const signed = new URL(link.body.url);

      const file = await request(app.getHttpServer()).get(`${signed.pathname}${signed.search}`).expect(200);
      expect(Buffer.from(file.body as Buffer).equals(body)).toBe(true);
      expect(file.headers['content-type']).toMatch(/^application\/pdf/);
      expect(file.headers['content-disposition']).toMatch(/^attachment/);

      signed.searchParams.set('token', 'forged');
      await request(app.getHttpServer()).get(`${signed.pathname}${signed.search}`).expect(401);
    },
    TIMEOUT,
  );
});
