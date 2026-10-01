import 'reflect-metadata';
import 'tsconfig-paths/register';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { join } from 'path';
import { ClsServiceManager } from 'nestjs-cls';
import { TenantContextService } from '../src/common/context/tenant-context.service';
import { TenantRlsSubscriber } from '../src/database/tenant-rls.subscriber';
import { Organization } from '../src/modules/organizations/entities/organization.entity';
import { Contact } from '../src/modules/contacts/entities/contact.entity';
import { Customer } from '../src/modules/customers/entities/customer.entity';

describe('Multi-Tenancy PostgreSQL Row-Level Security (e2e)', () => {
  let dataSource: DataSource;
  let tenantContext: TenantContextService;
  let orgRepo: Repository<Organization>;
  let contactRepo: Repository<Contact>;
  let customerRepo: Repository<Customer>;

  const TENANT_A_ID = 'a0000000-0000-0000-0000-000000000001';
  const TENANT_B_ID = 'b0000000-0000-0000-0000-000000000002';

  const CONTACT_A_ID = 'ca000000-0000-0000-0000-000000000001';
  const CONTACT_B_ID = 'cb000000-0000-0000-0000-000000000002';

  const CUSTOMER_A_ID = 'da000000-0000-0000-0000-000000000001';
  const CUSTOMER_B_ID = 'db000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    tenantContext = new TenantContextService(ClsServiceManager.getClsService());

    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5433),
      username: process.env.DB_APP_USERNAME ?? 'crm_test_app',
      password: process.env.DB_APP_PASSWORD ?? 'crm_dev_password',
      database: process.env.DB_NAME ?? 'crm_test',
      entities: [join(__dirname, '../src/modules/**/entities/*.entity.ts')],
      subscribers: [TenantRlsSubscriber],
      synchronize: false,
      logging: false,
    });

    await dataSource.initialize();

    orgRepo = dataSource.getRepository(Organization);
    contactRepo = dataSource.getRepository(Contact);
    customerRepo = dataSource.getRepository(Customer);

    // Verify connecting role is not superuser and does not have BYPASSRLS
    const roleCheck = await dataSource.query(`
      SELECT current_user, rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user;
    `);
    expect(roleCheck[0].current_user).toBe('crm_test_app');
    expect(roleCheck[0].rolsuper).toBe(false);
    expect(roleCheck[0].rolbypassrls).toBe(false);

    // Seed test organizations (organizations table is not tenant-scoped, no RLS)
    await orgRepo.upsert(
      [
        {
          id: TENANT_A_ID,
          name: 'Tenant Alpha Corp',
          slug: 'tenant-alpha-rls-test',
        },
        {
          id: TENANT_B_ID,
          name: 'Tenant Beta Ltd',
          slug: 'tenant-beta-rls-test',
        },
      ],
      ['id'],
    );

    // Seed tenant-scoped contacts and customers using system bypass
    await tenantContext.runAsSystem(async () => {
      // Clean up any stale records from previous runs
      await contactRepo
        .createQueryBuilder()
        .delete()
        .where('tenant_id IN (:...ids)', { ids: [TENANT_A_ID, TENANT_B_ID] })
        .execute();

      await customerRepo
        .createQueryBuilder()
        .delete()
        .where('tenant_id IN (:...ids)', { ids: [TENANT_A_ID, TENANT_B_ID] })
        .execute();

      await contactRepo.insert([
        {
          id: CONTACT_A_ID,
          tenantId: TENANT_A_ID,
          firstName: 'Alice',
          lastName: 'Alpha',
          status: 'lead',
          source: 'website',
        },
        {
          id: CONTACT_B_ID,
          tenantId: TENANT_B_ID,
          firstName: 'Bob',
          lastName: 'Beta',
          status: 'customer',
          source: 'referral',
        },
      ]);

      await customerRepo.insert([
        {
          id: CUSTOMER_A_ID,
          tenantId: TENANT_A_ID,
          companyName: 'Acme Alpha Corp',
        },
        {
          id: CUSTOMER_B_ID,
          tenantId: TENANT_B_ID,
          companyName: 'Beta Enterprises LLC',
        },
      ]);
    });
  }, 30_000);

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await tenantContext.runAsSystem(async () => {
        await contactRepo
          .createQueryBuilder()
          .delete()
          .where('tenant_id IN (:...ids)', { ids: [TENANT_A_ID, TENANT_B_ID] })
          .execute();

        await customerRepo
          .createQueryBuilder()
          .delete()
          .where('tenant_id IN (:...ids)', { ids: [TENANT_A_ID, TENANT_B_ID] })
          .execute();

        await orgRepo
          .createQueryBuilder()
          .delete()
          .where('id IN (:...ids)', { ids: [TENANT_A_ID, TENANT_B_ID] })
          .execute();
      });

      await dataSource.destroy();
    }
  }, 30_000);

  describe('Fail-Closed Default (Unset Context)', () => {
    it('returns 0 rows for tenant tables when tenant context is unset', async () => {
      expect(tenantContext.getTenantId()).toBeNull();
      expect(tenantContext.isSystem()).toBe(false);

      const contacts = await contactRepo.find();
      expect(contacts).toHaveLength(0);

      const contactCount = await contactRepo.count();
      expect(contactCount).toBe(0);

      const customers = await customerRepo.find();
      expect(customers).toHaveLength(0);

      const customerCount = await customerRepo.count();
      expect(customerCount).toBe(0);
    });

    it('rejects inserting rows when context is unset', async () => {
      await expect(
        contactRepo.insert({
          tenantId: TENANT_A_ID,
          firstName: 'Unset',
          lastName: 'Fail',
          status: 'lead',
          source: 'other',
        }),
      ).rejects.toThrow(QueryFailedError);
    });
  });

  describe('Tenant Isolation', () => {
    it('isolates Tenant A queries from Tenant B records', async () => {
      await tenantContext.runWithTenant(TENANT_A_ID, async () => {
        const contacts = await contactRepo.find();
        expect(contacts).toHaveLength(1);
        expect(contacts[0].id).toBe(CONTACT_A_ID);
        expect(contacts[0].firstName).toBe('Alice');

        const customers = await customerRepo.find();
        expect(customers).toHaveLength(1);
        expect(customers[0].id).toBe(CUSTOMER_A_ID);
        expect(customers[0].companyName).toBe('Acme Alpha Corp');

        // Cannot find Tenant B's records by direct ID
        const contactB = await contactRepo.findOneBy({ id: CONTACT_B_ID });
        expect(contactB).toBeNull();

        const customerB = await customerRepo.findOneBy({ id: CUSTOMER_B_ID });
        expect(customerB).toBeNull();
      });
    });

    it('isolates Tenant B queries from Tenant A records', async () => {
      await tenantContext.runWithTenant(TENANT_B_ID, async () => {
        const contacts = await contactRepo.find();
        expect(contacts).toHaveLength(1);
        expect(contacts[0].id).toBe(CONTACT_B_ID);
        expect(contacts[0].firstName).toBe('Bob');

        const customers = await customerRepo.find();
        expect(customers).toHaveLength(1);
        expect(customers[0].id).toBe(CUSTOMER_B_ID);
        expect(customers[0].companyName).toBe('Beta Enterprises LLC');

        // Cannot find Tenant A's records by direct ID
        const contactA = await contactRepo.findOneBy({ id: CONTACT_A_ID });
        expect(contactA).toBeNull();

        const customerA = await customerRepo.findOneBy({ id: CUSTOMER_A_ID });
        expect(customerA).toBeNull();
      });
    });

    it('prevents Tenant A from inserting records belonging to Tenant B (WITH CHECK violation)', async () => {
      await tenantContext.runWithTenant(TENANT_A_ID, async () => {
        await expect(
          contactRepo.insert({
            tenantId: TENANT_B_ID,
            firstName: 'Malicious',
            lastName: 'CrossTenant',
            status: 'lead',
            source: 'other',
          }),
        ).rejects.toThrow(QueryFailedError);
      });
    });

    it('prevents Tenant A from updating Tenant B records', async () => {
      await tenantContext.runWithTenant(TENANT_A_ID, async () => {
        const updateResult = await contactRepo.update(CONTACT_B_ID, {
          firstName: 'Tampered',
        });
        expect(updateResult.affected).toBe(0);

        // Raw query update is also restricted by RLS
        const rawResult = await dataSource.query(
          `UPDATE contacts SET "firstName" = 'Hacked' WHERE id = '${CONTACT_B_ID}'`,
        );
        expect(rawResult[1]).toBe(0);
      });

      // Verify record was NOT updated
      await tenantContext.runWithTenant(TENANT_B_ID, async () => {
        const contactB = await contactRepo.findOneBy({ id: CONTACT_B_ID });
        expect(contactB?.firstName).toBe('Bob');
      });
    });

    it('prevents Tenant A from deleting Tenant B records', async () => {
      await tenantContext.runWithTenant(TENANT_A_ID, async () => {
        const deleteResult = await contactRepo.delete(CONTACT_B_ID);
        expect(deleteResult.affected).toBe(0);
      });

      // Verify record still exists
      await tenantContext.runWithTenant(TENANT_B_ID, async () => {
        const contactB = await contactRepo.findOneBy({ id: CONTACT_B_ID });
        expect(contactB).not.toBeNull();
      });
    });
  });

  describe('System Bypass (runAsSystem)', () => {
    it('bypasses RLS to query records across all tenants', async () => {
      await tenantContext.runAsSystem(async () => {
        const contacts = await contactRepo.find();
        expect(contacts).toHaveLength(2);
        const contactIds = contacts.map((c) => c.id).sort();
        expect(contactIds).toEqual([CONTACT_A_ID, CONTACT_B_ID].sort());

        const customers = await customerRepo.find();
        expect(customers).toHaveLength(2);
        const customerIds = customers.map((c) => c.id).sort();
        expect(customerIds).toEqual([CUSTOMER_A_ID, CUSTOMER_B_ID].sort());
      });
    });

    it('allows system context to insert records for any tenant', async () => {
      const systemCreatedContactId = 'ca000000-0000-0000-0000-000000000099';

      await tenantContext.runAsSystem(async () => {
        await contactRepo.insert({
          id: systemCreatedContactId,
          tenantId: TENANT_A_ID,
          firstName: 'SystemCreated',
          lastName: 'Contact',
          status: 'lead',
          source: 'other',
        });
      });

      // Tenant A can see it
      await tenantContext.runWithTenant(TENANT_A_ID, async () => {
        const contact = await contactRepo.findOneBy({
          id: systemCreatedContactId,
        });
        expect(contact).not.toBeNull();
        expect(contact?.firstName).toBe('SystemCreated');
      });

      // Tenant B cannot see it
      await tenantContext.runWithTenant(TENANT_B_ID, async () => {
        const contact = await contactRepo.findOneBy({
          id: systemCreatedContactId,
        });
        expect(contact).toBeNull();
      });

      // Clean up the created contact
      await tenantContext.runAsSystem(async () => {
        await contactRepo.delete(systemCreatedContactId);
      });
    });
  });

  describe('Transaction Isolation (SET LOCAL)', () => {
    it('enforces RLS within dataSource.transaction blocks with SET LOCAL', async () => {
      await tenantContext.runWithTenant(TENANT_A_ID, async () => {
        await dataSource.transaction(async (manager) => {
          const contacts = await manager.find(Contact);
          expect(contacts).toHaveLength(1);
          expect(contacts[0].id).toBe(CONTACT_A_ID);

          const customer = await manager.findOneBy(Customer, {
            id: CUSTOMER_B_ID,
          });
          expect(customer).toBeNull();

          // Inserting for Tenant B within Tenant A transaction fails RLS
          await expect(
            manager.insert(Contact, {
              tenantId: TENANT_B_ID,
              firstName: 'TxFail',
              lastName: 'CrossTenant',
              status: 'lead',
              source: 'other',
            }),
          ).rejects.toThrow(QueryFailedError);
        });
      });
    });

    it('rolls back cleanly on error and leaves subsequent queries isolated', async () => {
      await expect(
        tenantContext.runWithTenant(TENANT_A_ID, async () => {
          await dataSource.transaction(async (manager) => {
            await manager.insert(Contact, {
              id: 'ca000000-0000-0000-0000-000000000088',
              tenantId: TENANT_A_ID,
              firstName: 'RollbackMe',
              lastName: 'Temp',
              status: 'lead',
              source: 'other',
            });
            throw new Error('Intentional transaction abort');
          });
        }),
      ).rejects.toThrow('Intentional transaction abort');

      // The uncommitted contact was rolled back
      await tenantContext.runWithTenant(TENANT_A_ID, async () => {
        const contact = await contactRepo.findOneBy({
          id: 'ca000000-0000-0000-0000-000000000088',
        });
        expect(contact).toBeNull();
      });
    });
  });

  describe('Connection Pool Safety & Session Variable Cleanup', () => {
    it('resets session variables upon query runner release so pooled connections never leak context', async () => {
      // Rapid sequential switching between tenants, system, and unset context
      const sequences = [
        { tenant: TENANT_A_ID, expectedId: CONTACT_A_ID, count: 1 },
        { tenant: TENANT_B_ID, expectedId: CONTACT_B_ID, count: 1 },
        { tenant: null, count: 0 },
        { tenant: TENANT_A_ID, expectedId: CONTACT_A_ID, count: 1 },
        { isSystem: true, count: 2 },
        { tenant: null, count: 0 },
        { tenant: TENANT_B_ID, expectedId: CONTACT_B_ID, count: 1 },
      ];

      for (const step of sequences) {
        if (step.isSystem) {
          await tenantContext.runAsSystem(async () => {
            const rows = await contactRepo.find();
            expect(rows).toHaveLength(step.count);
          });
        } else if (step.tenant) {
          await tenantContext.runWithTenant(step.tenant, async () => {
            const rows = await contactRepo.find();
            expect(rows).toHaveLength(step.count);
            expect(rows[0].id).toBe(step.expectedId);
          });
        } else {
          // Unset context
          const rows = await contactRepo.find();
          expect(rows).toHaveLength(0);
        }
      }
    });

    it('handles concurrent queries without race conditions or cross-tenant leakage', async () => {
      const results = await Promise.all([
        tenantContext.runWithTenant(TENANT_A_ID, async () => {
          return contactRepo.find();
        }),
        tenantContext.runWithTenant(TENANT_B_ID, async () => {
          return contactRepo.find();
        }),
        tenantContext.runAsSystem(async () => {
          return contactRepo.find();
        }),
        tenantContext.runWithTenant(TENANT_A_ID, async () => {
          return customerRepo.find();
        }),
        tenantContext.runWithTenant(TENANT_B_ID, async () => {
          return customerRepo.find();
        }),
      ]);

      const [
        tenantAContacts,
        tenantBContacts,
        systemContacts,
        tenantACustomers,
        tenantBCustomers,
      ] = results;

      expect(tenantAContacts).toHaveLength(1);
      expect(tenantAContacts[0].id).toBe(CONTACT_A_ID);

      expect(tenantBContacts).toHaveLength(1);
      expect(tenantBContacts[0].id).toBe(CONTACT_B_ID);

      expect(systemContacts).toHaveLength(2);

      expect(tenantACustomers).toHaveLength(1);
      expect(tenantACustomers[0].id).toBe(CUSTOMER_A_ID);

      expect(tenantBCustomers).toHaveLength(1);
      expect(tenantBCustomers[0].id).toBe(CUSTOMER_B_ID);
    });
  });
});
