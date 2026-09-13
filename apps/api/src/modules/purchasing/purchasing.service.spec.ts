import { ConflictException, NotFoundException } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';

const tenantId = '11111111-1111-1111-1111-111111111111';
const otherTenant = '22222222-2222-2222-2222-222222222222';

function makeService(seed: { suppliers?: any[]; orders?: any[] } = {}) {
  const suppliers: any[] = seed.suppliers ?? [];
  const orders: any[] = seed.orders ?? [];

  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) => {
      // IsNull() and friends arrive as objects; the only one used here is the
      // deletedAt null check.
      if (v && typeof v === 'object') return row[k] == null;
      return row[k] === v;
    });

  const supplierRepo = {
    findOne: jest.fn(
      async ({ where }: any) =>
        suppliers.find((s) => matches(s, where)) ?? null,
    ),
    create: jest.fn((dto: any) => ({
      id: `sup-${suppliers.length + 1}`,
      ...dto,
    })),
    save: jest.fn(async (s: any) => {
      const idx = suppliers.findIndex((x) => x.id === s.id);
      if (idx >= 0) suppliers[idx] = s;
      else suppliers.push(s);
      return s;
    }),
    softDelete: jest.fn(async (criteria: any) => {
      const row = suppliers.find(
        (s) => s.id === criteria.id && s.tenantId === criteria.tenantId,
      );
      if (row) row.deletedAt = new Date();
      return { affected: row ? 1 : 0 };
    }),
    createQueryBuilder: jest.fn(),
  };

  const orderRepo = {
    count: jest.fn(async ({ where }: any) => {
      const clauses = Array.isArray(where) ? where : [where];
      return orders.filter((o) => clauses.some((w) => matches(o, w))).length;
    }),
  };

  const service = new PurchasingService(
    supplierRepo as any,
    { find: jest.fn(), findOne: jest.fn(), manager: {} } as any,
    orderRepo as any,
    { findOne: jest.fn() } as any,
  );

  return { service, suppliers, supplierRepo };
}

const acme = {
  id: 'sup-1',
  tenantId,
  companyName: 'Papertree Ltd',
  deletedAt: null,
  isActive: true,
};

describe('PurchasingService — suppliers', () => {
  describe('findSupplierById', () => {
    it('will not return another tenant’s supplier', async () => {
      const { service } = makeService({
        suppliers: [{ ...acme, tenantId: otherTenant }],
      });

      await expect(
        service.findSupplierById(tenantId, 'sup-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('will not return a soft-deleted supplier', async () => {
      const { service } = makeService({
        suppliers: [{ ...acme, deletedAt: new Date() }],
      });

      await expect(
        service.findSupplierById(tenantId, 'sup-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createSupplier', () => {
    it('refuses a duplicate company name within the tenant', async () => {
      const { service } = makeService({ suppliers: [acme] });

      await expect(
        service.createSupplier(tenantId, {
          companyName: 'Papertree Ltd',
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows the same name in a different tenant', async () => {
      const { service, suppliers } = makeService({
        suppliers: [{ ...acme, tenantId: otherTenant }],
      });

      await service.createSupplier(tenantId, {
        companyName: 'Papertree Ltd',
      } as any);
      expect(suppliers).toHaveLength(2);
    });
  });

  describe('updateSupplier', () => {
    it('refuses a rename onto an existing name', async () => {
      const { service } = makeService({
        suppliers: [
          acme,
          { ...acme, id: 'sup-2', companyName: 'Fixings Direct' },
        ],
      });

      await expect(
        service.updateSupplier(tenantId, 'sup-2', {
          companyName: 'Papertree Ltd',
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows saving a supplier without changing its own name', async () => {
      const { service } = makeService({ suppliers: [acme] });

      const saved = await service.updateSupplier(tenantId, 'sup-1', {
        companyName: 'Papertree Ltd',
        leadTimeDays: 5,
      });

      expect(saved.leadTimeDays).toBe(5);
    });
  });

  describe('deleteSupplier', () => {
    it('refuses while the supplier has an open order', async () => {
      const { service } = makeService({
        suppliers: [acme],
        orders: [
          { tenantId, supplierId: 'sup-1', status: 'SENT', deletedAt: null },
        ],
      });

      // A purchase order whose supplier has vanished is worse than a supplier
      // row nobody uses.
      await expect(
        service.deleteSupplier(tenantId, 'sup-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('soft-deletes when only closed orders remain', async () => {
      const { service, suppliers } = makeService({
        suppliers: [acme],
        orders: [
          {
            tenantId,
            supplierId: 'sup-1',
            status: 'RECEIVED',
            deletedAt: null,
          },
        ],
      });

      await service.deleteSupplier(tenantId, 'sup-1');
      expect(suppliers[0].deletedAt).toBeInstanceOf(Date);
    });
  });
});
