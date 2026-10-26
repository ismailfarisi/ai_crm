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
 * UAE VAT on purchases, end to end: a reverse-charge bill self-assesses 5% on
 * both sides of tax payable, a blocked-VAT bill expenses its tax, and the
 * VAT201 puts each in its box.
 */
describe('UAE VAT (e2e)', () => {
  let app: INestApplication<App>;
  let cookie: string;

  const TIMEOUT = 60_000;
  const api = '/api/v1';
  const today = new Date().toISOString().slice(0, 10);

  const get = (path: string) =>
    request(app.getHttpServer()).get(`${api}${path}`).set('Cookie', [cookie]);
  const send = (method: 'post' | 'put' | 'patch', path: string, body?: object) =>
    request(app.getHttpServer())[method](`${api}${path}`).set('Cookie', [cookie]).send(body ?? {});

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
        organizationName: 'Dubai Trading E2E',
        firstName: 'Noor',
        lastName: 'Vat',
        email: `vat-${Date.now()}@example.com`,
        password: 'Password123!',
      })
      .expect(201);
    const set = register.headers['set-cookie'] as unknown as string[];
    cookie = set.find((c) => c.startsWith('crm_access_token='))!.split(';')[0];
  }, TIMEOUT);

  afterAll(async () => {
    await app.close();
  }, TIMEOUT);

  it(
    'self-assesses reverse charge, expenses blocked VAT, and files both in the VAT201',
    async () => {
      // Not in UAE mode yet: no VAT201.
      await get(`/finance/vat/return?from=${today}&to=${today}T23:59:59Z`).expect(409);

      await send('put', '/finance/currencies/base', { baseCurrency: 'AED' }).expect(200);
      await send('patch', '/organization', { country: 'AE', taxId: '100123456700003' }).expect(200);
      const branches = await get('/branches').expect(200);
      const head = branches.body.find((b: { isHeadOffice: boolean }) => b.isHeadOffice);
      if (head) {
        await send('put', `/branches/${head.id}`, { name: head.name, emirate: 'DXB', isHeadOffice: true }).expect(200);
      } else {
        await send('post', '/branches', { name: 'Head office', emirate: 'DXB', isHeadOffice: true }).expect(201);
      }

      const codes = await get('/finance/tax-codes').expect(200);
      const purchase = (code: string) =>
        codes.body.find((c: { code: string; kind: string }) => c.kind === 'PURCHASE' && c.code === code).id;

      const supplier = await send('post', '/suppliers', {
        companyName: 'Cloud Host Ltd',
        country: 'IE',
        currency: 'AED',
      }).expect(201);

      const bill = async (taxCode: string, unitCost: number, taxAmount: number, category?: string) => {
        const created = await send('post', '/bills', {
          supplierId: supplier.body.id,
          supplierInvoiceNumber: `INV-${taxCode}-${Date.now()}`,
          billDate: today,
          taxAmount,
          taxCodeId: purchase(taxCode),
          lines: [{ description: `${taxCode} line`, qty: 1, unitCost, category }],
        }).expect(201);
        return (await send('post', `/bills/${created.body.id}/approve`).expect(201)).body;
      };

      const rc = await bill('RC', 1000, 0);
      expect(Number(rc.reverseChargeTax)).toBe(50);
      await bill('BL', 400, 20, 'Travel');

      const journal = await get('/finance/journal-entries?referenceType=BILL').expect(200);
      const rcEntry = journal.body.find((e: { referenceId: string }) => e.referenceId === rc.id);
      const taxLines = rcEntry.lines.filter((l: { ledgerAccountCode: string }) => l.ledgerAccountCode === '2200');
      expect(taxLines.map((l: { debit: number; credit: number }) => [Number(l.debit), Number(l.credit)])).toEqual([
        [50, 0],
        [0, 50],
      ]);
      const blocked = journal.body.find((e: { referenceId: string }) => e.referenceId !== rc.id);
      expect(blocked.lines.some((l: { ledgerAccountCode: string }) => l.ledgerAccountCode === '2200')).toBe(false);

      const ret = await get(`/finance/vat/return?from=${today}&to=${today}T23:59:59Z`).expect(200);
      const box = (id: string) => ret.body.rows.find((r: { box: string }) => r.box === id);
      expect(box('3')).toMatchObject({ amount: 1000, vat: 50 });
      expect(box('10')).toMatchObject({ amount: 1000, vat: 50 });
      expect(box('9')).toMatchObject({ amount: 0, vat: 0 });
      expect(ret.body.payableTax).toBe(0);

      const report = await get(`/finance/tax-report?from=${today}&to=${today}T23:59:59Z`).expect(200);
      expect(report.body.outputTax).toBe(50);
      expect(report.body.inputTax).toBe(50);
      expect(report.body.netPayable).toBe(0);

      const tb = await get('/finance/trial-balance').expect(200);
      expect(tb.body.difference).toBe(0);
    },
    TIMEOUT,
  );
});
