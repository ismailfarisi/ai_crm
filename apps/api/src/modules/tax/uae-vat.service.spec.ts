import { BadRequestException } from '@nestjs/common';
import { UaeVatService, todayInDubai } from './uae-vat.service';

const tenantId = 'org-1';
const TRN = '100123456700003';

const settingsRow = {
  id: 's1',
  tenantId,
  periodFrequency: 'QUARTERLY',
  firstPeriodStart: '2026-01-01',
  registrationDate: '2025-12-15',
  vatStartDate: '2026-01-01',
  taxAgentName: null,
  taxAgencyName: null,
  tan: null,
  taan: null,
};

function makeService(opts: {
  org?: Record<string, unknown>;
  branches?: Array<Record<string, unknown>>;
  settings?: Record<string, unknown> | null;
}) {
  const org = {
    id: tenantId,
    country: 'AE',
    taxId: TRN,
    baseCurrency: 'AED',
    ...opts.org,
  };
  const query = jest.fn(async () => []);
  const organizations = { findOne: jest.fn(async () => org) };
  const branches = {
    find: jest.fn(
      async () =>
        opts.branches ?? [
          { id: 'b1', name: 'Head office', emirate: 'DXB', isActive: true },
        ],
    ),
  };
  const settings = {
    findOne: jest.fn(async () => opts.settings ?? null),
    create: jest.fn((v: Record<string, unknown>) => ({ ...v })),
    save: jest.fn(async (v: Record<string, unknown>) => v),
    manager: { query },
  };
  const service = new UaeVatService(
    organizations as any,
    branches as any,
    settings as any,
  );
  return { service, query, settings };
}

describe('UaeVatService.status', () => {
  it('is off for a UAE tenant with a TRN whose base currency is USD, and says why first', async () => {
    const { service } = makeService({
      org: { baseCurrency: 'USD' },
      settings: settingsRow,
    });
    const status = await service.status(tenantId);
    expect(status.enabled).toBe(false);
    expect(status.problems[0].startsWith('Your base currency is USD.')).toBe(
      true,
    );
  });

  it('lists a head office with no emirate', async () => {
    const { service } = makeService({
      branches: [
        { id: 'b1', name: 'Head office', emirate: null, isActive: true },
      ],
      settings: settingsRow,
    });
    const status = await service.status(tenantId);
    expect(status.enabled).toBe(true);
    expect(status.problems).toContain('Head office has no emirate');
  });

  it('lists every problem in order, and suggests no start date without settings', async () => {
    const { service } = makeService({
      org: { country: 'GB', taxId: null, baseCurrency: 'GBP' },
      branches: [{ id: 'b1', name: 'London', emirate: null, isActive: true }],
    });
    const status = await service.status(tenantId);
    expect(status.problems).toEqual([
      'Set the country to United Arab Emirates',
      'Add your 15-digit TRN',
      'Your base currency is GBP. UAE VAT returns are in AED, and the base currency cannot change once anything is posted.',
      'London has no emirate',
      'Set your VAT periods and start date',
    ]);
    expect(status.settings).toBeNull();
    expect(status.suggestedVatStartDate).toBeNull();
  });

  it('suggests the start of the next period after today in Dubai', async () => {
    const { service } = makeService({ settings: settingsRow });
    const status = await service.status(tenantId);
    expect(status.problems).toEqual([]);
    expect(status.settings).toEqual({
      id: 's1',
      periodFrequency: 'QUARTERLY',
      firstPeriodStart: '2026-01-01',
      registrationDate: '2025-12-15',
      vatStartDate: '2026-01-01',
      taxAgentName: null,
      taxAgencyName: null,
      tan: null,
      taan: null,
    });
    expect(status.suggestedVatStartDate).toMatch(/^\d{4}-(01|04|07|10)-01$/);
    expect(status.suggestedVatStartDate! > todayInDubai()).toBe(true);
  });
});

describe('todayInDubai', () => {
  it('is already tomorrow in Dubai late in the UTC evening', () => {
    expect(todayInDubai(new Date('2026-03-31T21:30:00Z'))).toBe('2026-04-01');
    expect(todayInDubai(new Date('2026-03-31T19:30:00Z'))).toBe('2026-03-31');
  });
});

describe('UaeVatService settings', () => {
  const input = {
    periodFrequency: 'QUARTERLY' as const,
    firstPeriodStart: '2026-01-01',
    registrationDate: '2025-12-15',
    vatStartDate: '2026-01-01',
    taxAgentName: null,
    taxAgencyName: null,
    tan: null,
    taan: null,
  };

  it('returns null when none are saved', async () => {
    const { service } = makeService({});
    await expect(service.getSettings(tenantId)).resolves.toBeNull();
  });

  it('refuses to save for a tenant outside UAE VAT mode, with the first problem', async () => {
    const { service, settings } = makeService({
      org: { country: 'GB', taxId: null, baseCurrency: 'GBP' },
    });
    await expect(service.saveSettings(tenantId, input)).rejects.toThrow(
      new BadRequestException('Set the country to United Arab Emirates'),
    );
    expect(settings.save).not.toHaveBeenCalled();
  });

  it('saves for a UAE tenant and returns plain dates', async () => {
    const { service, settings } = makeService({});
    settings.save.mockImplementation(async (v: Record<string, unknown>) => ({
      ...v,
      // As a driver without TypeORM's date handling would hand it back.
      registrationDate: new Date(2025, 11, 15),
    }));
    const dto = await service.saveSettings(tenantId, input);
    expect(settings.save).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, vatStartDate: '2026-01-01' }),
    );
    expect(dto.registrationDate).toBe('2025-12-15');
  });

  it('updates the existing row rather than adding a second', async () => {
    const { service, settings } = makeService({ settings: { ...settingsRow } });
    const dto = await service.saveSettings(tenantId, {
      ...input,
      periodFrequency: 'MONTHLY',
    });
    // The audit trail files the change under this id.
    expect(dto.id).toBe('s1');
    expect(settings.create).not.toHaveBeenCalled();
    expect(settings.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', periodFrequency: 'MONTHLY' }),
    );
  });
});

describe('UaeVatService.seedStarterCodes', () => {
  it('inserts codes then rules, each ON CONFLICT DO NOTHING, and is repeatable', async () => {
    const { service, query } = makeService({});
    await service.seedStarterCodes(tenantId);
    // Second run: SR already exists; DO NOTHING means nothing throws.
    await expect(service.seedStarterCodes(tenantId)).resolves.toBeUndefined();

    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(calls).toHaveLength(6);
    expect(calls[3]).toEqual(calls[0]);
    expect(calls[4]).toEqual(calls[1]);
    expect(calls[5]).toEqual(calls[2]);

    const [codesSql, codesParams] = calls[0];
    expect(codesSql).toContain('INSERT INTO "tax_codes"');
    expect(codesSql).toContain(
      'ON CONFLICT ("tenant_id", "kind", "code") DO NOTHING',
    );
    // tenant, then 10 codes x (code, name, rate, kind, reverse charge, treatment)
    expect(codesParams).toHaveLength(1 + 10 * 6);
    expect(codesParams.slice(1, 7)).toEqual([
      'SR',
      'Standard rated 5%',
      5,
      'SALES',
      false,
      'STANDARD',
    ]);
    const rc = codesParams.indexOf('Reverse charge 5%');
    expect(codesParams.slice(rc - 1, rc + 5)).toEqual([
      'RC',
      'Reverse charge 5%',
      5,
      'PURCHASE',
      true,
      'REVERSE_CHARGE',
    ]);
    const im = codesParams.indexOf('Import of goods 5%');
    expect(codesParams[im + 3]).toBe(true);
    const bl = codesParams.indexOf('Blocked input VAT 5%');
    expect(codesParams[bl + 3]).toBe(false);

    const [rulesSql, rulesParams] = calls[1];
    expect(rulesSql).toContain('INSERT INTO "tax_rules"');
    expect(rulesSql).toContain(
      'ON CONFLICT ("tenant_id", "kind", "country", "requires_tax_id") DO NOTHING',
    );
    expect(rulesParams).toEqual([
      tenantId,
      'SALES',
      'AE',
      'SR',
      'SALES',
      '*',
      'ZR',
      'PURCHASE',
      'AE',
      'SR',
      'PURCHASE',
      '*',
      'RC',
    ]);

    // The signup ZERO codes, untreated, become zero-rated — and nothing else.
    const [treatSql, treatParams] = calls[2];
    expect(treatSql).toContain(`UPDATE "tax_codes" SET "treatment" = 'ZERO_RATED'`);
    expect(treatSql).toContain(`"code" = 'ZERO' AND "rate" = 0`);
    expect(treatSql).toContain('"treatment" IS NULL');
    expect(treatParams).toEqual([tenantId]);
  });

  it('uses the manager it is given', async () => {
    const { service, query } = makeService({});
    const other = { query: jest.fn(async () => []) };
    await service.seedStarterCodes(tenantId, other as any);
    expect(other.query).toHaveBeenCalledTimes(3);
    expect(query).not.toHaveBeenCalled();
  });
});
