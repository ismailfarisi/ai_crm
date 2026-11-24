import { BadRequestException } from '@nestjs/common';
import { TaxService } from './tax.service';
import { UAE_STARTER_CODES, UAE_STARTER_RULES, treatmentIsReverseCharge } from '@saas/shared';

const tenantId = 'org-1';

function makeService(
  customer: { country: string | null; taxId: string | null } | null,
) {
  const codes = [
    {
      id: 'std',
      tenantId,
      code: 'STD',
      name: 'Standard',
      rate: 20,
      kind: 'SALES',
      isReverseCharge: false,
      ledgerAccountId: null,
      isActive: true,
    },
    {
      id: 'rc',
      tenantId,
      code: 'RC',
      name: 'Reverse charge',
      rate: 0,
      kind: 'SALES',
      isReverseCharge: true,
      ledgerAccountId: null,
      isActive: true,
    },
    {
      id: 'zero',
      tenantId,
      code: 'ZERO',
      name: 'Zero rated',
      rate: 0,
      kind: 'SALES',
      isReverseCharge: false,
      ledgerAccountId: null,
      isActive: true,
    },
  ];
  const rules = [
    {
      id: 'r1',
      tenantId,
      kind: 'SALES',
      country: 'GB',
      requiresTaxId: false,
      taxCodeId: 'std',
      priority: 0,
    },
    {
      id: 'r2',
      tenantId,
      kind: 'SALES',
      country: 'EU',
      requiresTaxId: true,
      taxCodeId: 'rc',
      priority: 0,
    },
  ];
  const repo = (rows: any[]) => ({
    find: jest.fn(async () => rows),
    findOne: jest.fn(async () => (customer ? { id: 'c1', ...customer } : null)),
  });
  const service = new TaxService(
    repo(codes) as any,
    repo(rules) as any,
    repo([]) as any,
    repo([]) as any,
    // A zero-rated catalog item.
    repo([{ id: 'book', taxCodeId: 'zero' }]) as any,
    repo([]) as any,
    repo([]) as any,
    repo([]) as any,
    repo([]) as any,
    repo([]) as any,
  );
  return service;
}

const line = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  type: 'product' as const,
  description: 'Rigid box',
  quantity: 10,
  unitPrice: 10,
  taxRate: 20,
  subtotal: 100,
  ...over,
});

describe('TaxService.applyToLines', () => {
  it('applies reverse charge to an EU business customer and zeroes the rate', async () => {
    const service = makeService({ country: 'Germany', taxId: 'DE123456789' });
    const [out] = await service.applyToLines(tenantId, [line()], 'c1');
    expect(out).toEqual(
      expect.objectContaining({
        taxCodeId: 'rc',
        taxCode: 'RC',
        taxRate: 0,
        taxReverseCharge: true,
      }),
    );
  });

  it('keeps a zero-rated item zero-rated at home, but reverse charge still overrides it abroad', async () => {
    const home = await makeService({ country: 'UK', taxId: null }).applyToLines(
      tenantId,
      [line({ catalogItemId: 'book' })],
      'c1',
    );
    expect(home[0]).toEqual(
      expect.objectContaining({ taxCodeId: 'zero', taxRate: 0 }),
    );

    const eu = await makeService({ country: 'FR', taxId: 'FR1' }).applyToLines(
      tenantId,
      [line({ catalogItemId: 'book' })],
      'c1',
    );
    expect(eu[0]).toEqual(
      expect.objectContaining({ taxCodeId: 'rc', taxReverseCharge: true }),
    );
  });

  it('never trusts a code id the client sent', async () => {
    const service = makeService(null);
    const [out] = await service.applyToLines(
      tenantId,
      [line({ taxCodeId: 'rc', taxReverseCharge: true, taxRate: 20 })],
      null,
    );
    expect(out.taxCodeId).toBeUndefined();
    expect(out.taxReverseCharge).toBeUndefined();
    // With nothing to resolve from, the typed rate stands.
    expect(out.taxRate).toBe(20);
  });

  it('leaves section lines alone', async () => {
    const section = { id: 's', type: 'section' as const, description: 'Print' };
    const [out] = await makeService({
      country: 'GB',
      taxId: null,
    }).applyToLines(tenantId, [section], 'c1');
    expect(out).toBe(section);
  });
});

describe('TaxService.purchaseTaxFor', () => {
  function service(code: Record<string, unknown> | null, supplierCode: unknown = null) {
    const codes = { findOne: jest.fn(async () => code), find: jest.fn(async () => []) };
    const none = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };
    const s = new TaxService(codes as any, none as any, none as any, none as any, none as any, none as any, none as any, none as any, none as any, none as any);
    jest.spyOn(s, 'purchaseCodeForSupplier').mockResolvedValue(supplierCode as any);
    return s;
  }
  const code = (over: Record<string, unknown>) => ({ id: 'tc', kind: 'PURCHASE', rate: 5, isReverseCharge: false, ...over });

  it('uses the chosen code and its rate', async () => {
    await expect(service(code({})).purchaseTaxFor(tenantId, 'tc', 'sup')).resolves.toMatchObject({ code: { id: 'tc' }, rate: 5 });
  });

  it('falls back to the supplier code', async () => {
    await expect(service(null, code({ id: 'sup-code' })).purchaseTaxFor(tenantId, null, 'sup')).resolves.toMatchObject({ code: { id: 'sup-code' }, rate: 5 });
  });

  it('adds nothing for reverse charge, zero-rated or no code', async () => {
    await expect(service(code({ isReverseCharge: true })).purchaseTaxFor(tenantId, 'tc', null)).resolves.toMatchObject({ rate: 0 });
    await expect(service(code({ rate: 0 })).purchaseTaxFor(tenantId, 'tc', null)).resolves.toMatchObject({ rate: 0 });
    await expect(service(null).purchaseTaxFor(tenantId, null, 'sup')).resolves.toEqual({ code: null, rate: 0 });
  });
});

describe('TaxService codes in UAE VAT mode', () => {
  function service(org: Record<string, unknown>) {
    const codes = {
      create: jest.fn((v: Record<string, unknown>) => ({ id: 'new', ...v })),
      save: jest.fn(async (v: Record<string, unknown>) => v),
      findOne: jest.fn(async () => null),
    };
    const none = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };
    const organizations = { findOne: jest.fn(async () => ({ id: tenantId, ...org })) };
    const s = new TaxService(codes as any, none as any, none as any, none as any, none as any, none as any, none as any, none as any, organizations as any, none as any);
    return { s, codes };
  }
  const uae = { country: 'AE', taxId: '100123456700003', baseCurrency: 'AED' };
  const input = (over: Record<string, unknown>) => ({
    code: 'X',
    name: 'X',
    rate: 5,
    kind: 'PURCHASE' as const,
    isReverseCharge: false,
    ledgerAccountId: null,
    isActive: true,
    treatment: null,
    ...over,
  });

  it('accepts a 5% purchase reverse charge and marks it reverse charge', async () => {
    const { s, codes } = service(uae);
    const dto = await s.createCode(tenantId, input({ code: 'RC', treatment: 'REVERSE_CHARGE' }) as any);
    expect(dto.isReverseCharge).toBe(true);
    expect(codes.save).toHaveBeenCalledWith(expect.objectContaining({ isReverseCharge: true, rate: 5 }));
  });

  it('refuses a standard sales code at anything but 5%', async () => {
    const { s, codes } = service(uae);
    await expect(
      s.createCode(tenantId, input({ kind: 'SALES', rate: 20, treatment: 'STANDARD' }) as any),
    ).rejects.toThrow('STANDARD codes are charged at 5%');
    expect(codes.save).not.toHaveBeenCalled();
  });

  it('requires a treatment', async () => {
    const { s } = service(uae);
    await expect(s.createCode(tenantId, input({}) as any)).rejects.toThrow(
      'Choose a VAT treatment for this code',
    );
  });

  it('refuses a purchase-only treatment on a sales code', async () => {
    const { s } = service(uae);
    await expect(
      s.createCode(tenantId, input({ kind: 'SALES', treatment: 'BLOCKED' }) as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('marks a sales reverse charge (0%) as reverse charge, and nothing else', async () => {
    const { s } = service(uae);
    await expect(
      s.createCode(tenantId, input({ kind: 'SALES', rate: 0, treatment: 'REVERSE_CHARGE' }) as any),
    ).resolves.toMatchObject({ isReverseCharge: true });
    await expect(
      s.createCode(tenantId, input({ kind: 'SALES', rate: 0, treatment: 'ZERO_RATED', isReverseCharge: true }) as any),
    ).resolves.toMatchObject({ isReverseCharge: false });
  });

  it('lets a legacy code that matches no treatment be deactivated, but not kept active', async () => {
    const { s, codes } = service(uae);
    codes.findOne.mockResolvedValue({ id: 'old', tenantId, ...input({ kind: 'SALES', rate: 20 }) } as any);
    await expect(
      s.updateCode(tenantId, 'old', input({ kind: 'SALES', rate: 20, isActive: false }) as any),
    ).resolves.toMatchObject({ isActive: false, rate: 20 });
    await expect(
      s.updateCode(tenantId, 'old', input({ kind: 'SALES', rate: 20, isActive: true }) as any),
    ).rejects.toThrow('Choose a VAT treatment for this code');
  });

  it('keeps the EU rule outside UAE VAT mode', async () => {
    const { s } = service({ ...uae, baseCurrency: 'USD' });
    await expect(
      s.createCode(tenantId, input({ isReverseCharge: true, rate: 5 }) as any),
    ).rejects.toThrow(/charged at 0%/);
    await expect(
      s.createCode(tenantId, input({ kind: 'SALES', rate: 20 }) as any),
    ).resolves.toMatchObject({ rate: 20, isReverseCharge: false });
  });
});

describe('TaxService parties in UAE VAT mode', () => {
  const uae = { country: 'AE', taxId: '100123456700003', baseCurrency: 'AED' };
  const starterCodes = UAE_STARTER_CODES.map((c) => ({
    id: `${c.kind}-${c.code}`,
    tenantId,
    code: c.code,
    name: c.name,
    rate: c.rate,
    kind: c.kind,
    isReverseCharge: treatmentIsReverseCharge(c.treatment),
    treatment: c.treatment,
    ledgerAccountId: null,
    isActive: true,
  }));
  const starterRules = UAE_STARTER_RULES.map((r, i) => ({
    id: `rule-${i}`,
    tenantId,
    kind: r.kind,
    country: r.country,
    requiresTaxId: false,
    taxCodeId: `${r.kind}-${r.code}`,
    priority: 0,
  }));

  function service(
    party: { country: string | null; taxId: string | null; vatStatus: string },
    org: Record<string, unknown> = uae,
  ) {
    const rows = (list: any[]) => ({
      find: jest.fn(async () => list),
      findOne: jest.fn(async () => null),
    });
    const parties = { find: jest.fn(async () => []), findOne: jest.fn(async () => ({ id: 'p1', ...party })) };
    const organizations = { findOne: jest.fn(async () => ({ id: tenantId, ...org })) };
    return new TaxService(
      rows(starterCodes) as any,
      rows(starterRules) as any,
      parties as any,
      parties as any,
      rows([]) as any,
      rows([]) as any,
      rows([]) as any,
      rows([]) as any,
      organizations as any,
      rows([]) as any,
    );
  }

  it('charges 5% to a domestic customer whose country was never filled in', async () => {
    const [out] = await service({ country: null, taxId: null, vatStatus: 'NOT_REGISTERED' }).applyToLines(tenantId, [line()], 'c1');
    expect(out).toEqual(expect.objectContaining({ taxCode: 'SR', taxRate: 5, taxReverseCharge: false }));
  });

  it('charges standard VAT, not reverse charge, on a supplier with no country', async () => {
    const code = await service({ country: null, taxId: null, vatStatus: 'REGISTERED' }).purchaseCodeForSupplier(tenantId, 's1');
    expect(code).toEqual(expect.objectContaining({ code: 'SR', rate: 5 }));
  });

  it('zero-rates a customer marked outside the UAE', async () => {
    const [out] = await service({ country: 'GB', taxId: null, vatStatus: 'OUTSIDE_UAE' }).applyToLines(tenantId, [line()], 'c1');
    expect(out).toEqual(expect.objectContaining({ taxCode: 'ZR', taxRate: 0 }));
  });

  it('leaves the country alone outside UAE VAT mode', async () => {
    const [out] = await service(
      { country: null, taxId: null, vatStatus: 'NOT_REGISTERED' },
      { ...uae, baseCurrency: 'USD' },
    ).applyToLines(tenantId, [line()], 'c1');
    expect(out).toEqual(expect.objectContaining({ taxCode: 'ZR' }));
  });
});

describe('TaxService: expense claims in the tax report and the VAT201', () => {
  const october = [new Date('2026-10-01T00:00:00Z'), new Date('2026-10-31T23:59:59Z')] as const;
  const november = [new Date('2026-11-01T00:00:00Z'), new Date('2026-11-30T23:59:59Z')] as const;
  const purchaseCodes = [
    { id: 'sr', tenantId, kind: 'PURCHASE', code: 'SR', rate: 5, isReverseCharge: false, treatment: 'STANDARD' },
    { id: 'bl', tenantId, kind: 'PURCHASE', code: 'BL', rate: 5, isReverseCharge: false, treatment: 'BLOCKED' },
    { id: 'rc', tenantId, kind: 'PURCHASE', code: 'RC', rate: 5, isReverseCharge: true, treatment: 'REVERSE_CHARGE' },
  ];
  const claim = (over: Record<string, unknown>) => ({
    id: 'c',
    tenantId,
    amount: 210,
    taxCodeId: 'sr',
    taxAmount: 10,
    recoverableTax: 10,
    reverseChargeTax: 0,
    fxRate: 1,
    taxPostedAt: new Date('2026-10-16T09:00:00Z'),
    taxReversedAt: null,
    ...over,
  });

  /** A claims repository that answers the two period queries the way Postgres would. */
  function service(claims: Array<ReturnType<typeof claim>>, bills: unknown[] = []) {
    const within = (d: Date | null, op: any) =>
      !!d && d >= op._value[0] && d <= op._value[1];
    const claimRepo = {
      find: jest.fn(async ({ where }: any) =>
        claims.filter((c) =>
          where.taxReversedAt
            ? !!c.taxPostedAt && within(c.taxReversedAt as Date | null, where.taxReversedAt)
            : within(c.taxPostedAt as Date | null, where.taxPostedAt),
        ),
      ),
    };
    const rows = (list: unknown[]) => ({ find: jest.fn(async () => list), findOne: jest.fn(async () => null) });
    const organizations = {
      findOne: jest.fn(async () => ({ id: tenantId, country: 'AE', taxId: '100123456700003', baseCurrency: 'AED' })),
      manager: { getRepository: () => ({ findOne: jest.fn(async () => ({ emirate: 'DUBAI' })) }) },
    };
    const s = new TaxService(
      rows(purchaseCodes) as any,
      rows([]) as any,
      rows([]) as any,
      rows([]) as any,
      rows([]) as any,
      rows([]) as any,
      rows([]) as any,
      rows(bills) as any,
      organizations as any,
      claimRepo as any,
    );
    return { s, claimRepo };
  }
  const box = (vat201: { rows: Array<{ box: string; amount: number; vat: number }> }, n: string) =>
    vat201.rows.find((r) => r.box === n)!;

  it('asks only for claims that carry a tax code', async () => {
    const { s, claimRepo } = service([]);
    await s.report(tenantId, ...october);
    for (const [{ where }] of claimRepo.find.mock.calls as any[]) {
      expect(where.tenantId).toBe(tenantId);
      expect(where.taxCodeId).toBeDefined();
    }
  });

  it('reports a claim’s recoverable VAT as input tax, beside a bill’s', async () => {
    const bill = { id: 'b', taxCodeId: 'sr', subtotalAmount: 1000, taxAmount: 50, reverseChargeTax: 0, fxRate: 1 };
    const { s } = service([claim({})], [bill]);
    const report = await s.report(tenantId, ...october);
    expect(report.input).toEqual([
      expect.objectContaining({ code: 'SR', net: 1200, tax: 60 }),
    ]);
    expect(report.inputTax).toBe(60);
    expect(report.netPayable).toBe(-60);

    const vat201 = await s.vat201(tenantId, ...october);
    expect(box(vat201, '9')).toMatchObject({ amount: 1200, vat: 60 });
    expect(box(vat201, '10')).toMatchObject({ amount: 0, vat: 0 });
  });

  it('shows blocked VAT as paid but not recoverable, and keeps it out of box 9', async () => {
    const { s } = service([claim({ taxCodeId: 'bl', recoverableTax: 0 })]);
    const report = await s.report(tenantId, ...october);
    expect(report.input).toEqual([
      expect.objectContaining({ code: 'BL', net: 200, tax: 0 }),
    ]);
    expect(report.inputTax).toBe(0);
    const vat201 = await s.vat201(tenantId, ...october);
    expect(box(vat201, '9')).toMatchObject({ amount: 0, vat: 0 });
  });

  it('puts a reverse-charge claim on both sides, and in box 10', async () => {
    const { s } = service([
      claim({ amount: 200, taxCodeId: 'rc', taxAmount: 0, recoverableTax: 0, reverseChargeTax: 10 }),
    ]);
    const report = await s.report(tenantId, ...october);
    expect(report.inputTax).toBe(10);
    expect(report.outputTax).toBe(10);
    expect(report.netPayable).toBe(0);
    const vat201 = await s.vat201(tenantId, ...october);
    expect(box(vat201, '10')).toMatchObject({ amount: 200, vat: 10 });
    expect(box(vat201, '3')).toMatchObject({ amount: 200, vat: 10 });
  });

  it('counts the claim in the period it was approved in, not the one after', async () => {
    const { s } = service([claim({})]);
    expect((await s.report(tenantId, ...november)).inputTax).toBe(0);
    expect(box(await s.vat201(tenantId, ...november), '9').vat).toBe(0);
  });

  it('takes a claim rejected after approval back out in the period it was rejected in', async () => {
    const { s } = service([
      claim({ taxReversedAt: new Date('2026-11-03T09:00:00Z') }),
    ]);
    // October's return, already filed, is not changed…
    expect((await s.report(tenantId, ...october)).inputTax).toBe(10);
    // …November gives the VAT back.
    const report = await s.report(tenantId, ...november);
    expect(report.input).toEqual([
      expect.objectContaining({ code: 'SR', net: -200, tax: -10 }),
    ]);
    expect(report.inputTax).toBe(-10);
    expect(box(await s.vat201(tenantId, ...november), '9')).toMatchObject({ amount: -200, vat: -10 });
  });

  it('nets to nothing when approval and rejection fall in the same period', async () => {
    const { s } = service([
      claim({ taxReversedAt: new Date('2026-10-20T09:00:00Z') }),
    ]);
    const report = await s.report(tenantId, ...october);
    expect(report.inputTax).toBe(0);
    expect(box(await s.vat201(tenantId, ...october), '9')).toMatchObject({ amount: 0, vat: 0 });
  });

  it('reports a foreign-currency claim at the rate it was posted at', async () => {
    const { s } = service([claim({ fxRate: 3.6725 })]);
    const report = await s.report(tenantId, ...october);
    expect(report.inputTax).toBe(36.73);
    expect(box(await s.vat201(tenantId, ...october), '9').vat).toBe(36.73);
  });

  it('uses what was posted at approval, even if the code was changed since', async () => {
    const { s } = service([claim({ taxCodeId: 'bl', recoverableTax: 10 })]);
    expect((await s.report(tenantId, ...october)).inputTax).toBe(10);
  });
});
