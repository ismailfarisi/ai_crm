import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerSenderService } from './customer-sender.service';

interface CustomerRow {
  id: string;
  tenantId: string;
  companyName: string;
  phone: string | null;
  email: string | null;
  country: string | null;
}
interface LinkRow {
  id: string;
  organizationId: string;
  provider: string;
  identifier: string;
  customerId: string;
}

const ORG = 'org-1';

/**
 * Repositories that honour the tenant filter the service passes, so a query
 * that forgot it would see the other organization's rows and fail a test.
 */
function setup(
  customers: CustomerRow[],
  links: LinkRow[] = [],
  orgCountry: string | null = 'AE',
) {
  const matches = (row: object, where: object) =>
    Object.entries(where).every(
      ([key, value]) => (row as Record<string, unknown>)[key] === value,
    );
  const linkRepo = {
    findOne: jest.fn(
      async ({ where }: { where: object }) =>
        links.find((l) => matches(l, where)) ?? null,
    ),
    find: jest.fn(async ({ where }: { where: object }) =>
      links.filter((l) => matches(l, where)),
    ),
    create: jest.fn((row: LinkRow) => row),
    save: jest.fn(async (row: LinkRow) => {
      const saved = { ...row, id: row.id ?? `link-${links.length + 1}` };
      const at = links.findIndex((l) => l.id === saved.id);
      if (at >= 0) links[at] = saved;
      else links.push(saved);
      return saved;
    }),
    remove: jest.fn(async (row: LinkRow) => {
      links.splice(links.indexOf(row), 1);
    }),
  };
  const customerRepo = {
    findOne: jest.fn(
      async ({ where }: { where: object }) =>
        customers.find((c) => matches(c, where)) ?? null,
    ),
    createQueryBuilder: jest.fn(() => {
      let tenant: string | undefined;
      const qb = {
        where: (_sql: string, params: { organizationId: string }) => {
          tenant = params.organizationId;
          return qb;
        },
        // The SQL narrowing is an optimisation; the decision is in code.
        andWhere: () => qb,
        getMany: async () => customers.filter((c) => c.tenantId === tenant),
      };
      return qb;
    }),
  };
  const orgRepo = {
    findOne: jest.fn(async () => ({ id: ORG, country: orgCountry })),
  };
  const service = new CustomerSenderService(
    linkRepo as never,
    customerRepo as never,
    orgRepo as never,
  );
  return { service, links, linkRepo };
}

const customer = (over: Partial<CustomerRow>): CustomerRow => ({
  id: 'cust-a',
  tenantId: ORG,
  companyName: 'Al Noor Sweets',
  phone: null,
  email: null,
  country: null,
  ...over,
});

describe('CustomerSenderService', () => {
  describe('a WhatsApp number', () => {
    it('is the customer whose record carries it, however it was typed', async () => {
      const { service } = setup([customer({ phone: '050 123 4567' })]);
      await expect(
        service.resolve(ORG, 'WHATSAPP_META', '971501234567'),
      ).resolves.toEqual({
        customerId: 'cust-a',
        companyName: 'Al Noor Sweets',
        via: 'ON_RECORD',
      });
    });

    it('is nobody when no record carries it', async () => {
      const { service } = setup([customer({ phone: '050 123 4567' })]);
      await expect(
        service.resolve(ORG, 'WHATSAPP_META', '971509999999'),
      ).resolves.toBeNull();
    });

    it('is nobody when two customers share it', async () => {
      const { service } = setup([
        customer({ phone: '+971 50 123 4567' }),
        customer({ id: 'cust-b', companyName: 'Other', phone: '0501234567' }),
      ]);
      await expect(
        service.check(ORG, 'WHATSAPP_META', '971501234567'),
      ).resolves.toEqual({ status: 'AMBIGUOUS', customer: null, linkId: null });
      await expect(
        service.resolve(ORG, 'WHATSAPP_META', '971501234567'),
      ).resolves.toBeNull();
    });

    it('does not match the same national number in another country', async () => {
      // 050 123 4567 on a Saudi customer is +966…, not the UAE sender.
      const { service } = setup([
        customer({ phone: '050 123 4567', country: 'SA' }),
      ]);
      await expect(
        service.resolve(ORG, 'WHATSAPP_META', '971501234567'),
      ).resolves.toBeNull();
    });

    it('does not read a national number when no country is known', async () => {
      const { service } = setup(
        [customer({ phone: '050 123 4567' })],
        [],
        null,
      );
      await expect(
        service.resolve(ORG, 'WHATSAPP_META', '971501234567'),
      ).resolves.toBeNull();
    });

    it('does not match a number that only ends the same', async () => {
      const { service } = setup([customer({ phone: '+971 50 123 4567' })]);
      await expect(
        service.resolve(ORG, 'WHATSAPP_META', '966501234567'),
      ).resolves.toBeNull();
    });

    it("never matches another organization's customer", async () => {
      const { service } = setup([
        customer({ tenantId: 'org-2', phone: '+971501234567' }),
      ]);
      await expect(
        service.resolve(ORG, 'WHATSAPP_META', '971501234567'),
      ).resolves.toBeNull();
    });
  });

  describe('an email address', () => {
    it('is the customer whose record carries exactly it', async () => {
      const { service } = setup([customer({ email: 'Orders@AlNoor.ae' })]);
      const who = await service.resolve(ORG, 'EMAIL_SMTP', 'orders@alnoor.ae');
      expect(who?.customerId).toBe('cust-a');
    });

    // The reply is sent to the sender string. One that a mail server would
    // also deliver elsewhere must not count as the customer.
    it.each([
      'orders@alnoor.ae, thief@evil.test',
      'Al Noor <orders@alnoor.ae>',
      '"orders@alnoor.ae" <thief@evil.test>',
    ])('is nobody for %p', async (sender) => {
      const { service } = setup([customer({ email: 'orders@alnoor.ae' })]);
      await expect(service.check(ORG, 'EMAIL_SMTP', sender)).resolves.toEqual({
        status: 'UNSUPPORTED',
        customer: null,
        linkId: null,
      });
    });
  });

  describe('a chat without a number or address', () => {
    it('is nobody until staff link it, whatever the records say', async () => {
      const { service } = setup([customer({ phone: '55501234' })]);
      await expect(
        service.resolve(ORG, 'TELEGRAM', '55501234'),
      ).resolves.toBeNull();
    });

    it('is never a group chat', async () => {
      const { service } = setup([customer({})]);
      await expect(
        service.link(ORG, 'user-1', {
          customerId: 'cust-a',
          provider: 'TELEGRAM',
          identifier: '-100200300',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('a link made by staff', () => {
    it('makes the sender that customer, ahead of the records', async () => {
      const { service } = setup([
        customer({ phone: '+971501234567' }),
        customer({ id: 'cust-b', companyName: 'Gulf Print' }),
      ]);
      const link = await service.link(ORG, 'user-1', {
        customerId: 'cust-b',
        provider: 'WHATSAPP_META',
        identifier: '+971501234567',
      });
      expect(link.identifier).toBe('971501234567');
      await expect(
        service.resolve(ORG, 'WHATSAPP_META', '971501234567'),
      ).resolves.toEqual({
        customerId: 'cust-b',
        companyName: 'Gulf Print',
        via: 'LINKED',
      });
    });

    it('moves when the same sender is linked again', async () => {
      const { service, links } = setup([
        customer({}),
        customer({ id: 'cust-b', companyName: 'Gulf Print' }),
      ]);
      const payload = { provider: 'TELEGRAM' as const, identifier: '777' };
      await service.link(ORG, 'user-1', { ...payload, customerId: 'cust-a' });
      await service.link(ORG, 'user-1', { ...payload, customerId: 'cust-b' });
      expect(links).toHaveLength(1);
      expect(links[0].customerId).toBe('cust-b');
    });

    it('names nobody once its customer is gone, and does not fall back to the records', async () => {
      const { service } = setup(
        [customer({ id: 'cust-b', phone: '+971501234567' })],
        [
          {
            id: 'link-1',
            organizationId: ORG,
            provider: 'WHATSAPP_META',
            identifier: '971501234567',
            customerId: 'deleted-customer',
          },
        ],
      );
      await expect(
        service.check(ORG, 'WHATSAPP_META', '971501234567'),
      ).resolves.toEqual({
        status: 'UNKNOWN',
        customer: null,
        linkId: 'link-1',
      });
    });

    it("cannot point at another organization's customer", async () => {
      const { service } = setup([customer({ tenantId: 'org-2' })]);
      await expect(
        service.link(ORG, 'user-1', {
          customerId: 'cust-a',
          provider: 'WHATSAPP_META',
          identifier: '971501234567',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is not seen from another organization, and cannot be removed from one', async () => {
      const { service } = setup(
        [customer({ tenantId: 'org-2' })],
        [
          {
            id: 'link-1',
            organizationId: 'org-2',
            provider: 'WHATSAPP_META',
            identifier: '971501234567',
            customerId: 'cust-a',
          },
        ],
      );
      await expect(
        service.resolve(ORG, 'WHATSAPP_META', '971501234567'),
      ).resolves.toBeNull();
      await expect(service.unlink(ORG, 'link-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
