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
