import { ForbiddenException } from '@nestjs/common';
import { PERMISSIONS } from '@saas/shared';
import { ImportsService } from './imports.service';

const tenantId = '11111111-1111-1111-1111-111111111111';

const actor = (permissions: string[]) =>
  ({
    id: 'user-1',
    organizationId: tenantId,
    firstName: 'Olivia',
    lastName: 'Owner',
    permissions,
    teamId: null,
  }) as any;

const file = (text: string) => ({
  originalname: 'customers.csv',
  mimetype: 'text/csv',
  size: Buffer.byteLength(text),
  buffer: Buffer.from(text, 'utf8'),
});

function setup(existing: any[] = []) {
  const saved: any[] = [];
  const repo = {
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => {
      if (v.companyName === 'Explodes') throw new Error('boom');
      saved.push(v);
      return v;
    }),
    findOneOrFail: jest.fn(async ({ where }) => ({
      ...existing.find((e) => e.id === where.id),
    })),
  };
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(existing),
  };
  const manager: any = {
    getRepository: jest.fn(() => ({ ...repo, createQueryBuilder: () => qb })),
    query: jest.fn().mockResolvedValue([]),
  };
  const transactions: number[] = [];
  const dataSource: any = {
    manager,
    transaction: jest.fn(async (fn) => {
      transactions.push(1);
      return fn({ transaction: (inner: any) => inner(manager) });
    }),
  };
  const runs: any = {
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => ({
      ...v,
      id: 'run-1',
      createdAt: new Date('2026-11-17T00:00:00Z'),
    })),
  };
  const contacts: any = {
    scoped: jest.fn(),
    assignableOwner: jest.fn(async (a) => a.id),
  };
  const inventory: any = { adjust: jest.fn() };
  const service = new ImportsService(dataSource, runs, contacts, inventory);
  return { service, saved, runs, dataSource, inventory };
}

describe('ImportsService', () => {
  it('needs the create permission of what is imported', async () => {
    const { service } = setup();
    await expect(
      service.preview(
        actor([PERMISSIONS.CONTACT_CREATE]),
        'customers',
        file('Company\nA\n'),
        undefined,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      service.allowedEntities(actor([PERMISSIONS.CATALOG_MANAGE])),
    ).toEqual(['products', 'materials', 'work-centres']);
  });

  it('needs the update permission to update duplicates', async () => {
    const { service } = setup();
    await expect(
      service.commit(
        actor([PERMISSIONS.CUSTOMER_CREATE]),
        'customers',
        file('Company\nA\n'),
        {
          onDuplicate: 'update',
        },
      ),
    ).rejects.toThrow('You do not have permission to update customers');
  });

  it('previews every row: errors, repeats and existing records', async () => {
    const { service } = setup([
      { id: 'c-1', companyName: 'Al Noor', email: null },
    ]);
    const preview = await service.preview(
      actor([PERMISSIONS.CUSTOMER_CREATE]),
      'customers',
      file(
        'Customer name,Email,Country,TRN\nAl Noor,,AE,\nBeta,b@x.ae,AE,123\nGamma,g@x.ae,,\ngamma,,,\n',
      ),
      undefined,
    );
    expect(preview.mapping).toMatchObject({
      companyName: 0,
      email: 1,
      country: 2,
      taxId: 3,
    });
    expect(
      preview.rows.map((r) => [r.rowNumber, r.match, r.issues.length]),
    ).toEqual([
      [2, 'existing', 0],
      [3, 'new', 1],
      [4, 'new', 0],
      [5, 'repeat', 1],
    ]);
    expect(preview.rows[1].issues[0]).toEqual({
      field: 'taxId',
      message: 'A UAE TRN is 15 digits',
    });
    expect(preview.counts).toEqual({
      valid: 2,
      invalid: 2,
      existing: 1,
      repeats: 1,
    });
  });

  it('commits in batches, skips or updates duplicates, and reports each count', async () => {
    const existing = [
      {
        id: 'c-1',
        companyName: 'Al Noor',
        email: null,
        city: 'Dubai',
        country: 'AE',
        taxId: null,
        vatStatus: 'NOT_REGISTERED',
      },
    ];
    const { service, saved, runs, dataSource } = setup(existing);
    const csv = 'Company,City\nAl Noor,Sharjah\nNew Co,\nExplodes,\n,Nowhere\n';

    const skipped = await service.commit(
      actor([PERMISSIONS.CUSTOMER_CREATE]),
      'customers',
      file(csv),
      {
        onDuplicate: 'skip',
      },
    );
    expect(skipped).toMatchObject({
      created: 1,
      updated: 0,
      skipped: 1,
      failed: 2,
      totalRows: 4,
    });
    expect(skipped.failures.map((f) => f.rowNumber)).toEqual([4, 5]);
    expect(skipped.failures[0].issues[0].message).toBe(
      'This row could not be saved',
    );
    expect(saved.map((s) => s.companyName)).toEqual(['New Co']);
    expect(saved[0]).toMatchObject({ tenantId, vatStatus: 'NOT_REGISTERED' });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(runs.save).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'customers', createdById: 'user-1' }),
    );

    saved.length = 0;
    const updated = await service.commit(
      actor([PERMISSIONS.CUSTOMER_CREATE, PERMISSIONS.CUSTOMER_UPDATE]),
      'customers',
      file(csv),
      { onDuplicate: 'update' },
    );
    expect(updated).toMatchObject({
      created: 1,
      updated: 1,
      skipped: 0,
      failed: 2,
    });
    // Only the columns in the file change; the rest of the record stands.
    expect(saved[0]).toMatchObject({
      id: 'c-1',
      city: 'Sharjah',
      country: 'AE',
    });
  });

  it('books opening stock through the stock adjustment, never over stock already held', async () => {
    const { service, inventory, dataSource } = setup([
      { id: 'm-1', sku: 'GB-2MM', name: 'Greyboard' },
    ]);
    dataSource.manager.query.mockResolvedValueOnce([]);
    const run = await service.commit(
      actor([PERMISSIONS.INVENTORY_ADJUST]),
      'opening-stock',
      file('SKU,Qty,Unit cost\nGB-2MM,250,4.8\nNOPE,1,1\n'),
      { onDuplicate: 'skip' },
    );
    expect(run).toMatchObject({ created: 1, failed: 1 });
    expect(run.failures[0].issues[0].message).toMatch(
      /No material has this SKU/,
    );
    expect(inventory.adjust).toHaveBeenCalledWith(
      tenantId,
      'user-1',
      {
        materialId: 'm-1',
        kind: 'OPENING',
        qtyDelta: 250,
        unitCost: 4.8,
        note: 'Opening stock (import)',
      },
      expect.anything(),
    );
  });
});
