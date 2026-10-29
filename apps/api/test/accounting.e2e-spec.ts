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
 * The books against a real Postgres: manual journals and their reversal, the
 * period-lock trigger, the chart of accounts, bank reconciliation, and a
 * transfer between accounts in different currencies. Every step ends by
 * checking the trial balance still sums to zero.
 */
describe('Accounting (e2e)', () => {
  let app: INestApplication<App>;
  let cookie: string;

  const TIMEOUT = 60_000;
  const api = '/api/v1';
  const day = (offset = 0) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const get = (path: string) =>
    request(app.getHttpServer()).get(`${api}${path}`).set('Cookie', [cookie]);
  const send = (method: 'post' | 'put' | 'patch' | 'delete', path: string, body?: object) =>
    request(app.getHttpServer())[method](`${api}${path}`).set('Cookie', [cookie]).send(body ?? {});

  const balanced = async () => {
    const tb = await get('/finance/trial-balance').expect(200);
    expect(tb.body.difference).toBe(0);
  };

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
        organizationName: 'Books E2E',
        firstName: 'Ada',
        lastName: 'Ledger',
        email: `books-${Date.now()}@example.com`,
        password: 'Password123!',
      })
      .expect(201);
    const set = register.headers['set-cookie'] as unknown as string[];
    cookie = set.find((c) => c.startsWith('crm_access_token='))!.split(';')[0];
  }, TIMEOUT);

  afterAll(async () => {
    await app.close();
  }, TIMEOUT);

  let bankId: string;
  let bankLedgerId: string;
  let equipmentId: string;
  const byCode = new Map<string, string>();

  it(
    'posts, refuses and reverses manual journals, moving the bank balance with them',
    async () => {
      const bank = await send('post', '/finance/accounts', {
        name: 'Main bank',
        accountType: 'BANK',
        currency: 'USD',
        balance: 1000,
      }).expect(201);
      bankId = bank.body.id;

      const chart = await get('/finance/ledger-accounts').expect(200);
      for (const a of chart.body) byCode.set(a.code, a.id);
      const accounts = await get('/finance/accounts').expect(200);
      bankLedgerId = accounts.body.find((a: { id: string }) => a.id === bankId).ledgerAccountId;
      expect(bankLedgerId).toBeTruthy();

      const equipment = await send('post', '/finance/ledger-accounts', {
        code: '1500',
        name: 'Office equipment',
        type: 'ASSET',
      }).expect(201);
      equipmentId = equipment.body.id;
      await send('post', '/finance/ledger-accounts', { code: '1500', name: 'Dup', type: 'ASSET' }).expect(409);

      const journal = await send('post', '/finance/journal-entries', {
        entryDate: day(-1),
        memo: 'Laptop bought by bank transfer',
        lines: [
          { ledgerAccountId: equipmentId, debit: 500 },
          { ledgerAccountId: bankLedgerId, credit: 500 },
        ],
      }).expect(201);
      expect(journal.body.entryNumber).toMatch(/^JNL-/);
      let after = await get('/finance/accounts').expect(200);
      expect(Number(after.body.find((a: { id: string }) => a.id === bankId).balance)).toBe(500);
      await balanced();

      // Receivables belong to their documents.
      await send('post', '/finance/journal-entries', {
        entryDate: day(-1),
        memo: 'Nope',
        lines: [
          { ledgerAccountId: byCode.get('1100'), debit: 10 },
          { ledgerAccountId: equipmentId, credit: 10 },
        ],
      }).expect(400);
      // 1000 only groups the bank accounts.
      await send('post', '/finance/journal-entries', {
        entryDate: day(-1),
        memo: 'Nope',
        lines: [
          { ledgerAccountId: byCode.get('1000'), debit: 10 },
          { ledgerAccountId: equipmentId, credit: 10 },
        ],
      }).expect(400);
      // Unbalanced.
      await send('post', '/finance/journal-entries', {
        entryDate: day(-1),
        memo: 'Nope',
        lines: [
          { ledgerAccountId: equipmentId, debit: 10 },
          { ledgerAccountId: bankLedgerId, credit: 9 },
        ],
      }).expect(400);

      await send('post', `/finance/journal-entries/${journal.body.id}/reverse`, {}).expect(201);
      await send('post', `/finance/journal-entries/${journal.body.id}/reverse`, {}).expect(409);
      after = await get('/finance/accounts').expect(200);
      expect(Number(after.body.find((a: { id: string }) => a.id === bankId).balance)).toBe(1000);

      const filtered = await get(`/finance/journal-entries?ledgerAccountId=${equipmentId}`).expect(200);
      expect(filtered.body).toHaveLength(2);
      await balanced();
    },
    TIMEOUT,
  );

  it(
    'refuses any posting into a locked period, from any source',
    async () => {
      await send('put', '/finance/period-lock', { lockedThrough: day(0) }).expect(400);
      await send('put', '/finance/period-lock', { lockedThrough: day(-1) }).expect(200);

      const refused = await send('post', '/finance/journal-entries', {
        entryDate: day(-1),
        memo: 'Late accrual',
        lines: [
          { ledgerAccountId: byCode.get('6100'), debit: 100 },
          { ledgerAccountId: bankLedgerId, credit: 100 },
        ],
      }).expect(409);
      expect(refused.body.message).toMatch(/locked through/);
      expect(refused.body.error).toBe('PeriodLocked');

      await send('post', '/finance/journal-entries', {
        entryDate: day(0),
        memo: 'Rent',
        lines: [
          { ledgerAccountId: byCode.get('6100'), debit: 100 },
          { ledgerAccountId: bankLedgerId, credit: 100 },
        ],
      }).expect(201);

      const lock = await get('/finance/period-lock').expect(200);
      expect(lock.body.lockedThrough).toBe(day(-1));
      await send('put', '/finance/period-lock', { lockedThrough: null }).expect(200);
      await balanced();
    },
    TIMEOUT,
  );

  it(
    'keeps used accounts and system accounts out of reach',
    async () => {
      await send('delete', `/finance/ledger-accounts/${equipmentId}`).expect(409);
      await send('patch', `/finance/ledger-accounts/${byCode.get('1100')}`, { isActive: false }).expect(400);
      const spare = await send('post', '/finance/ledger-accounts', {
        code: '1510',
        name: 'Spare',
        type: 'ASSET',
        parentId: equipmentId,
      }).expect(201);
      await send('patch', `/finance/ledger-accounts/${equipmentId}`, { parentId: spare.body.id }).expect(400);
      await send('delete', `/finance/ledger-accounts/${spare.body.id}`).expect(200);
    },
    TIMEOUT,
  );

  it(
    'imports a statement once, matches it, and books what the ledger lacks',
    async () => {
      const lines = [
        { date: day(0), description: 'Opening deposit', amount: 1000 },
        { date: day(0), description: 'Monthly fee', amount: -25 },
        { date: day(0), description: 'Monthly fee', amount: -25 },
      ];
      const first = await send('post', '/finance/bank-statements', { financeAccountId: bankId, lines }).expect(201);
      expect(first.body).toEqual({ imported: 3, skipped: 0 });
      const again = await send('post', '/finance/bank-statements', { financeAccountId: bankId, lines }).expect(201);
      expect(again.body).toEqual({ imported: 0, skipped: 3 });

      let rec = await get(`/finance/accounts/${bankId}/reconciliation`).expect(200);
      expect(rec.body.amountsComparable).toBe(true);
      const opening = rec.body.unreconciledLedger.find((m: { amount: number }) => m.amount === 1000);
      expect(opening).toBeTruthy();
      const [deposit, feeA, feeB] = ['Opening deposit', 'Monthly fee', 'Monthly fee'].map(
        (d, i) => rec.body.lines.filter((l: { description: string }) => l.description === d)[i === 2 ? 1 : 0],
      );

      // Wrong amount is refused; the right one matches, once.
      await send('post', `/finance/bank-statement-lines/${feeA.id}/match`, { journalEntryId: opening.journalEntryId }).expect(400);
      await send('post', `/finance/bank-statement-lines/${deposit.id}/match`, { journalEntryId: opening.journalEntryId }).expect(201);

      await send('post', `/finance/bank-statement-lines/${feeA.id}/post`, { ledgerAccountId: bankLedgerId }).expect(400);
      await send('post', `/finance/bank-statement-lines/${feeA.id}/post`, { ledgerAccountId: byCode.get('6900') }).expect(201);
      await send('post', `/finance/bank-statement-lines/${feeB.id}/exclude`).expect(201);

      rec = await get(`/finance/accounts/${bankId}/reconciliation`).expect(200);
      expect(rec.body.counts).toEqual({ UNMATCHED: 0, MATCHED: 2, EXCLUDED: 1 });
      expect(rec.body.statementBalance).toBe(975);
      const accounts = await get('/finance/accounts').expect(200);
      // 1000 opening − 100 rent − 25 fee.
      expect(Number(accounts.body.find((a: { id: string }) => a.id === bankId).balance)).toBe(875);
      expect(rec.body.ledgerBalance).toBe(875);
      await balanced();
    },
    TIMEOUT,
  );

  it(
    'matches a deposit of several receipts and a payroll paid out per person, as groups',
    async () => {
      const journal = (memo: string, amount: number, date = day(-1)) =>
        send('post', '/finance/journal-entries', {
          entryDate: date,
          memo,
          lines:
            amount > 0
              ? [
                  { ledgerAccountId: bankLedgerId, debit: amount },
                  { ledgerAccountId: equipmentId, credit: amount },
                ]
              : [
                  { ledgerAccountId: byCode.get('6900'), debit: -amount },
                  { ledgerAccountId: bankLedgerId, credit: -amount },
                ],
        }).expect(201);
      const receipts = [
        await journal('Receipt Al Noor', 310),
        await journal('Receipt Gulf Board', 460),
        await journal('Receipt Emirates Inks', 230),
      ];
      // Nets to zero, so the bank balance later tests check is unchanged.
      const payroll = await journal('Payroll October', -939);
      await journal('Card fee', -61);

      await send('post', '/finance/bank-statements', {
        financeAccountId: bankId,
        lines: [
          { date: day(0), description: 'CHEQUE DEPOSIT 3 ITEMS', amount: 1000 },
          { date: day(0), description: 'SALARY TRANSFER A', amount: -539 },
          { date: day(0), description: 'SALARY TRANSFER B', amount: -400 },
          { date: day(0), description: 'CARD FEE', amount: -61 },
        ],
      }).expect(201);

      let rec = await get(`/finance/accounts/${bankId}/reconciliation`).expect(200);
      const lineBy = (d: string) => rec.body.lines.find((l: { description: string }) => l.description === d);
      const deposit = lineBy('CHEQUE DEPOSIT 3 ITEMS');
      const salaryA = lineBy('SALARY TRANSFER A');
      const salaryB = lineBy('SALARY TRANSFER B');
      const kinds = rec.body.suggestions.map((s: { kind: string; certain: boolean }) => `${s.kind}:${s.certain}`);
      expect(kinds).toEqual(
        expect.arrayContaining(['ONE_TO_ONE:true', 'ONE_LINE_MANY_ENTRIES:false', 'MANY_LINES_ONE_ENTRY:false']),
      );

      // Only the certain one is applied without a person.
      const auto = await send('post', `/finance/accounts/${bankId}/auto-match`).expect(201);
      expect(auto.body).toEqual({ matched: 1 });

      // Totals that do not agree are refused.
      await send('post', '/finance/bank-matches', {
        lineIds: [salaryA.id],
        journalEntryIds: [payroll.body.id],
      }).expect(400);

      const grouped = await send('post', '/finance/bank-matches', {
        lineIds: [deposit.id],
        journalEntryIds: receipts.map((r) => r.body.id),
      }).expect(201);
      expect(grouped.body[0].matchedEntries).toHaveLength(3);

      const paid = await send('post', '/finance/bank-matches', {
        lineIds: [salaryA.id, salaryB.id],
        journalEntryIds: [payroll.body.id],
      }).expect(201);
      expect(paid.body.map((l: { matchedLineCount: number }) => l.matchedLineCount)).toEqual([2, 2]);

      // An entry is reconciled once.
      await send('post', `/finance/bank-statement-lines/${salaryA.id}/unmatch`).expect(201);
      rec = await get(`/finance/accounts/${bankId}/reconciliation`).expect(200);
      // Unmatching one line of a group reopens the whole group.
      expect(lineBy('SALARY TRANSFER B').status).toBe('UNMATCHED');
      expect(rec.body.unreconciledLedger.map((m: { journalEntryId: string }) => m.journalEntryId)).toContain(
        payroll.body.id,
      );
      await send('post', '/finance/bank-matches', {
        lineIds: [salaryA.id, salaryB.id],
        journalEntryIds: [payroll.body.id],
      }).expect(201);
      await send('post', '/finance/bank-matches', {
        lineIds: [deposit.id],
        journalEntryIds: [payroll.body.id],
      }).expect(409);

      rec = await get(`/finance/accounts/${bankId}/reconciliation`).expect(200);
      expect(lineBy('CHEQUE DEPOSIT 3 ITEMS').status).toBe('MATCHED');
      expect(lineBy('CARD FEE').status).toBe('MATCHED');
      expect(rec.body.counts.UNMATCHED).toBe(0);
      await balanced();
    },
    TIMEOUT,
  );

  it(
    'converts a transfer between currencies at what the bank paid out',
    async () => {
      await send('post', '/finance/fx-rates', { currency: 'EUR', rateDate: day(-1), rate: 1.08 }).expect(201);
      const eur = await send('post', '/finance/accounts', {
        name: 'Euro account',
        accountType: 'BANK',
        currency: 'EUR',
      }).expect(201);

      await send('post', '/finance/accounts/transfer', {
        fromAccountId: bankId,
        toAccountId: eur.body.id,
        amount: 110,
      }).expect(400);
      const transfer = await send('post', '/finance/accounts/transfer', {
        fromAccountId: bankId,
        toAccountId: eur.body.id,
        amount: 110,
        toAmount: 100,
      }).expect(201);
      expect(Number(transfer.body.toAccount.balance)).toBe(100);
      expect(Number(transfer.body.fromAccount.balance)).toBe(765);
      const lines = transfer.body.journalEntry.lines as { debit: number; credit: number }[];
      expect(lines.map((l) => [Number(l.debit), Number(l.credit)])).toEqual([
        [0, 110],
        [110, 0],
      ]);
      await balanced();
    },
    TIMEOUT,
  );
});
