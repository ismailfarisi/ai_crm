import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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

  describe('VAT status', () => {
    it('stores REGISTERED on create for a UAE supplier with a TRN', async () => {
      const { service } = makeService({ suppliers: [] });
      const saved = await service.createSupplier(tenantId, {
        companyName: 'Gulf Paper',
        country: 'AE',
        taxId: '100123456789012',
      } as any);
      expect(saved.vatStatus).toBe('REGISTERED');
    });

    it('keeps the status on an unrelated update, even with a null status in the patch', async () => {
      const { service } = makeService({
        suppliers: [
          { ...acme, country: 'AE', taxId: '100123456789012', vatStatus: 'REGISTERED' },
        ],
      });
      const saved = await service.updateSupplier(tenantId, 'sup-1', {
        leadTimeDays: 3,
        vatStatus: null,
      } as any);
      expect(saved.vatStatus).toBe('REGISTERED');
    });

    it('validates the TRN against the stored UAE country and normalises it', async () => {
      const { service } = makeService({
        suppliers: [{ ...acme, country: 'AE', taxId: null, vatStatus: 'NOT_REGISTERED' }],
      });
      await expect(
        service.updateSupplier(tenantId, 'sup-1', { taxId: '12345' } as any),
      ).rejects.toThrow('A UAE TRN is 15 digits');
      const saved = await service.updateSupplier(tenantId, 'sup-1', {
        taxId: '100 1234 5678 9012',
      } as any);
      expect(saved.taxId).toBe('100123456789012');
      expect(saved.vatStatus).toBe('REGISTERED');
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

describe('PurchasingService — sendToSupplier', () => {
  const sentAt = new Date('2026-10-01T10:00:00Z');

  function makeSendService(
    opts: { claim?: 'won' | 'lost'; mail?: 'ok' | 'fail' } = {},
  ) {
    const calls: string[] = [];
    const order = {
      id: 'po-1',
      tenantId,
      poNumber: 'PO-2026-0001',
      supplierId: acme.id,
      status: 'APPROVED',
      totalAmount: 210,
      currency: 'GBP',
      deletedAt: null,
    };
    const supplierRepo = {
      findOne: jest.fn(async () => ({
        ...acme,
        email: 'orders@papertree.test',
        contactName: 'Pat',
      })),
    };
    const orderRepo = { findOne: jest.fn(async () => order) };
    const organizations = { findOne: jest.fn(async () => ({ name: 'Acme' })) };
    const mail = {
      sendMail: jest.fn(async () => {
        calls.push('mail');
        if (opts.mail === 'fail') throw new Error('SMTP down');
      }),
    };
    const pdf = { generate: jest.fn(async () => Buffer.from('%PDF')) };
    const lifecycle = {
      markSent: jest.fn(async () => {
        calls.push('claim');
        if (opts.claim === 'lost') {
          throw new BadRequestException(
            'PO-2026-0001 is sent and cannot be sent.',
          );
        }
        return { ...order, status: 'SENT', sentAt };
      }),
      revertSent: jest.fn(async () => {
        calls.push('revert');
      }),
    };

    const service = new PurchasingService(
      supplierRepo as any,
      {} as any,
      orderRepo as any,
      {} as any,
      organizations as any,
      mail as any,
      pdf as any,
      lifecycle as any,
    );
    return { service, calls, mail, lifecycle };
  }

  it('claims the order as sent before emailing it', async () => {
    const { service, calls } = makeSendService();

    const saved = await service.sendToSupplier(tenantId, 'po-1');

    expect(saved.status).toBe('SENT');
    expect(calls).toEqual(['claim', 'mail']);
  });

  it('does not email when another request already claimed the send', async () => {
    // Two clicks on "send" would otherwise both pass the APPROVED check and
    // both email the supplier.
    const { service, mail } = makeSendService({ claim: 'lost' });

    await expect(
      service.sendToSupplier(tenantId, 'po-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it('puts the order back to approved when the email fails', async () => {
    const { service, calls, lifecycle } = makeSendService({ mail: 'fail' });

    await expect(service.sendToSupplier(tenantId, 'po-1')).rejects.toThrow(
      'SMTP down',
    );
    expect(calls).toEqual(['claim', 'mail', 'revert']);
    expect(lifecycle.revertSent).toHaveBeenCalledWith(tenantId, 'po-1', sentAt);
  });
});
