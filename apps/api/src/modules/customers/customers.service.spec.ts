import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { CustomersService } from './customers.service';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';

const actor: AuthenticatedUser = {
  id: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  email: 'admin@northwind.test',
  firstName: 'Ada',
  lastName: 'Admin',
  roles: ['admin'],
  level: 10,
  permissions: [],
  isOwner: false,
  teamId: null,
  managerId: null,
};

const customer = {
  id: '33333333-3333-3333-3333-333333333333',
  tenantId: actor.organizationId,
  companyName: 'Acme Corp',
  contactName: null,
  email: null,
  phone: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  postalCode: null,
  country: null,
  taxId: null,
  currency: 'USD',
  paymentTermsDays: 30,
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
};

function makeService(overrides: Partial<Record<'repo', unknown>> = {}) {
  const repo = (overrides.repo ?? {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[customer], 1]),
      getOne: jest.fn().mockResolvedValue(customer),
    })),
    create: jest.fn((c) => c),
    save: jest.fn(async (c) => c),
    softRemove: jest.fn().mockResolvedValue(undefined),
  }) as unknown as Repository<Customer>;

  return { service: new CustomersService(repo), repo };
}

describe('CustomersService', () => {
  describe('list', () => {
    it('scopes every query to the actor organization', async () => {
      const { service, repo } = makeService();
      await service.list(actor, {
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });

      const qb = (repo.createQueryBuilder as jest.Mock).mock.results[0].value;
      expect(qb.where).toHaveBeenCalledWith(
        'customer.tenantId = :tenantId',
        {
          tenantId: actor.organizationId,
        },
      );
    });

    it('returns paginated results', async () => {
      const { service } = makeService();
      const result = await service.list(actor, {
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].companyName).toBe('Acme Corp');
      expect(result.meta.total).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });
  });

  describe('findOne', () => {
    it('returns a customer in the same organization', async () => {
      const { service } = makeService();
      const result = await service.findOne(actor, customer.id);
      expect(result.id).toBe(customer.id);
    });

    it('throws 404 when the customer belongs to another organization', async () => {
      const repo = {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(null),
        })),
      } as unknown as Repository<Customer>;
      const { service } = makeService({ repo });

      await expect(service.findOne(actor, customer.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('stamps the organization and saves', async () => {
      const { service, repo } = makeService();
      const input = {
        companyName: 'Acme Corp',
        currency: 'USD',
        paymentTermsDays: 30,
      };
      await service.create(actor, input);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: actor.organizationId }),
      );
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('VAT status', () => {
    it('stores REGISTERED for a UAE customer with a TRN when none is given', async () => {
      const { service, repo } = makeService();
      await service.create(actor, {
        companyName: 'Souq LLC',
        country: 'AE',
        taxId: '100123456789012',
        currency: 'AED',
        paymentTermsDays: 30,
      } as never);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ vatStatus: 'REGISTERED' }),
      );
    });

    it('keeps the status when only the phone changes, and ignores a null status', async () => {
      const { service, repo } = makeService();
      Object.assign(customer, {
        country: 'AE',
        taxId: '100123456789012',
        vatStatus: 'REGISTERED',
      });
      try {
        await service.update(actor, customer.id, {
          phone: '04 555 0100',
          vatStatus: null,
        } as never);
        expect(repo.save).toHaveBeenCalledWith(
          expect.objectContaining({ vatStatus: 'REGISTERED' }),
        );
      } finally {
        Object.assign(customer, { country: null, taxId: null, vatStatus: undefined });
      }
    });

    it('rejects a malformed TRN against the stored UAE country, and normalises a valid one', async () => {
      const { service, repo } = makeService();
      Object.assign(customer, { country: 'United Arab Emirates', taxId: null });
      try {
        await expect(
          service.update(actor, customer.id, { taxId: '12345' } as never),
        ).rejects.toBeInstanceOf(BadRequestException);
        await service.update(actor, customer.id, {
          taxId: '100-1234-5678-9012',
        } as never);
        expect(repo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            taxId: '100123456789012',
            vatStatus: 'REGISTERED',
          }),
        );
      } finally {
        Object.assign(customer, { country: null, taxId: null, vatStatus: undefined });
      }
    });
  });

  describe('remove', () => {
    it('soft-deletes a customer', async () => {
      const { service, repo } = makeService();
      await service.remove(actor, customer.id);
      expect(repo.softRemove).toHaveBeenCalledWith(customer);
    });
  });
});
