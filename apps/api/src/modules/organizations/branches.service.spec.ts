import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { BranchPayload } from '@saas/shared';
import { BranchesService } from './branches.service';
import { Branch } from './entities/branch.entity';
import { Organization } from './entities/organization.entity';

const tenantId = 'org-1';

const payload = (over: Partial<BranchPayload> = {}): BranchPayload => ({
  name: 'Branch',
  addressLine1: null,
  addressLine2: null,
  city: null,
  emirate: 'DXB',
  isHeadOffice: false,
  invoicePrefix: null,
  isActive: true,
  ...over,
});

const branch = (over: Partial<Branch> = {}): Branch =>
  ({
    id: 'a',
    tenantId,
    name: 'HQ',
    addressLine1: null,
    addressLine2: null,
    city: null,
    emirate: 'DXB',
    isHeadOffice: false,
    invoicePrefix: null,
    isActive: true,
    ...over,
  }) as Branch;

function makeService(opts: {
  rows?: Branch[];
  org?: Partial<Organization>;
  saveError?: unknown;
}) {
  const rows = opts.rows ?? [];
  const org = {
    id: tenantId,
    name: 'Acme',
    country: 'AE',
    taxId: '100123456789012',
    baseCurrency: 'AED',
    addressLine1: 'Street 1',
    addressLine2: null,
    city: 'Dubai',
    ...opts.org,
  } as Organization;

  const branchRepo = {
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((r) =>
          Object.entries(where).every(
            ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
          ),
        ) ?? null,
    ),
    create: jest.fn((x: Partial<Branch>) => x),
    save: jest.fn(async (x: Branch) => {
      if (opts.saveError) throw opts.saveError;
      return { ...x, id: x.id ?? 'new' } as Branch;
    }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const orgRepo = { findOne: jest.fn().mockResolvedValue(org) };
  const manager = {
    getRepository: (e: unknown) => (e === Branch ? branchRepo : orgRepo),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
  };
  const service = new BranchesService(
    branchRepo as never,
    orgRepo as never,
    dataSource as never,
  );
  return { service, branchRepo, manager };
}

describe('BranchesService', () => {
  it('making branch B the head office unsets A first', async () => {
    const a = branch({ id: 'a', isHeadOffice: true });
    const b = branch({ id: 'b', name: 'B' });
    const { service, branchRepo } = makeService({ rows: [a, b] });
    const order: string[] = [];
    branchRepo.update.mockImplementation(async () => order.push('unset'));
    branchRepo.save.mockImplementation(async (x: Branch) => {
      order.push('save');
      return x;
    });
    const dto = await service.update(
      tenantId,
      'b',
      payload({ name: 'B', isHeadOffice: true }),
    );
    expect(order).toEqual(['unset', 'save']);
    expect(dto.isHeadOffice).toBe(true);
  });

  it('refuses to deactivate the head office', async () => {
    const { service } = makeService({
      rows: [branch({ isHeadOffice: true })],
    });
    await expect(
      service.update(
        tenantId,
        'a',
        payload({ isHeadOffice: true, isActive: false }),
      ),
    ).rejects.toThrow('The head office cannot be deactivated');
  });

  it('refuses to unset the only head office', async () => {
    const { service } = makeService({
      rows: [branch({ isHeadOffice: true })],
    });
    await expect(
      service.update(tenantId, 'a', payload({ isHeadOffice: false })),
    ).rejects.toThrow('There must be a head office');
  });

  it('requires an emirate in UAE VAT mode', async () => {
    const { service } = makeService({});
    await expect(
      service.create(tenantId, payload({ emirate: null })),
    ).rejects.toThrow('Pick the emirate this branch is in');
  });

  it('allows a missing emirate outside UAE VAT mode', async () => {
    const { service } = makeService({
      org: { country: 'GB', taxId: null, baseCurrency: 'GBP' },
    });
    await expect(
      service.create(tenantId, payload({ emirate: null })),
    ).resolves.toMatchObject({ emirate: null });
  });

  it('maps a duplicate prefix to a conflict', async () => {
    const err = new QueryFailedError('insert', [], new Error('duplicate'));
    Object.assign(err, {
      code: '23505',
      constraint: 'uq_branches_tenant_invoice_prefix',
    });
    const { service } = makeService({ saveError: err });
    await expect(
      service.create(tenantId, payload({ invoicePrefix: 'DXB' })),
    ).rejects.toEqual(
      new ConflictException('Another branch already uses the prefix DXB'),
    );
  });

  it('ensureHeadOffice saves once when called twice', async () => {
    const rows: Branch[] = [];
    const { service, branchRepo, manager } = makeService({ rows });
    branchRepo.save.mockImplementation(async (x: Branch) => {
      const saved = { ...x, id: 'h' } as Branch;
      rows.push(saved);
      return saved;
    });
    const first = await service.ensureHeadOffice(tenantId, manager as never);
    const second = await service.ensureHeadOffice(tenantId, manager as never);
    expect(branchRepo.save).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first).toMatchObject({
      name: 'Acme',
      addressLine1: 'Street 1',
      city: 'Dubai',
    });
  });

  it('missingEmirates returns active branches without one', async () => {
    const { service } = makeService({
      rows: [branch({ id: 'x', emirate: null }), branch({ id: 'y' })],
    });
    expect((await service.missingEmirates(tenantId)).map((b) => b.id)).toEqual([
      'x',
    ]);
  });
});
