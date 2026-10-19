import { BadRequestException } from '@nestjs/common';
import { TaxService } from './tax.service';

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
    const s = new TaxService(codes as any, none as any, none as any, none as any, none as any, none as any, none as any, none as any, none as any);
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
    const s = new TaxService(codes as any, none as any, none as any, none as any, none as any, none as any, none as any, none as any, organizations as any);
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
