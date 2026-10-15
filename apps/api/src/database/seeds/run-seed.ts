import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  CONTACT_SOURCES,
  CONTACT_STATUSES,
  isoDate,
  SYSTEM_ROLES,
} from '@saas/shared';
import { AppModule } from '@/app.module';
import { AuthService } from '@/modules/auth/auth.service';
import { ContactsService } from '@/modules/contacts/contacts.service';
import { RbacService } from '@/modules/rbac/rbac.service';
import { TeamsService } from '@/modules/teams/teams.service';
import { UsersService } from '@/modules/users/users.service';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import { Supplier } from '@/modules/purchasing/entities/supplier.entity';
import { RecurringExpense } from '@/modules/finance/entities/recurring-expense.entity';
import { RecurringBillingService } from '@/modules/overheads/recurring-billing.service';
import { PrepaidService } from '@/modules/overheads/prepaid.service';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { TenantContextService } from '@/common/context/tenant-context.service';

const DEMO_ORG = 'Northwind Trading';
const DEMO_PASSWORD = 'Password123!';
const LEASE_SUPPLIER = 'Seed Properties LLC';

const FIRST_NAMES = [
  'Ada',
  'Grace',
  'Linus',
  'Rin',
  'Kofi',
  'Mira',
  'Sana',
  'Theo',
  'Jun',
  'Noor',
];
const LAST_NAMES = [
  'Okafor',
  'Lindqvist',
  'Haddad',
  'Tanaka',
  'Mensah',
  'Rossi',
  'Novak',
  'Ferreira',
];
const COMPANIES = [
  'Cobalt Labs',
  'Brightline',
  'Terrafirm',
  'Nimbus Health',
  'Orchard Retail',
  'Vantage Freight',
];
const TITLES = [
  'Head of Ops',
  'CTO',
  'Procurement Lead',
  'Founder',
  'VP Sales',
  'Finance Director',
];

async function seed(): Promise<void> {
  const logger = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });

  try {
    const tenantContext = app.get(TenantContextService);
    const dataSource = app.get(DataSource);
    const auth = app.get(AuthService);
    const users = app.get(UsersService);
    const rbac = app.get(RbacService);
    const contacts = app.get(ContactsService);
    const teams = app.get(TeamsService);

    let leaseSeeded = false;

    await tenantContext.runAsSystem(async () => {
      const orgRepo = dataSource.getRepository(Organization);
      if (await orgRepo.exists({ where: { name: DEMO_ORG } })) {
        logger.warn(
          `"${DEMO_ORG}" already exists — nothing to seed. Run \`pnpm db:reset\` first.`,
        );
        return;
      }

      // Owner signs up, which provisions the org and all five system roles.
      const { userId: ownerId } = await auth.register(
        {
          organizationName: DEMO_ORG,
          firstName: 'Ada',
          lastName: 'Okonkwo',
          email: 'owner@northwind.test',
          password: DEMO_PASSWORD,
          baseCurrency: 'USD',
          country: 'US',
        },
        {},
      );

      const owner = await users.findByIdForAuth(ownerId);
      if (!owner) throw new Error('Owner vanished after registration');
      const organizationId = owner.tenantId;

      const teammates: {
        email: string;
        first: string;
        last: string;
        role: string;
      }[] = [
        {
          email: 'admin@northwind.test',
          first: 'Grace',
          last: 'Bello',
          role: SYSTEM_ROLES.ADMIN,
        },
        {
          email: 'manager@northwind.test',
          first: 'Ravi',
          last: 'Kapoor',
          role: SYSTEM_ROLES.MANAGER,
        },
        {
          email: 'rep@northwind.test',
          first: 'Lena',
          last: 'Fischer',
          role: SYSTEM_ROLES.MEMBER,
        },
        {
          email: 'viewer@northwind.test',
          first: 'Tom',
          last: 'Adeyemi',
          role: SYSTEM_ROLES.VIEWER,
        },
      ];

      const created: Record<string, string> = {};
      for (const mate of teammates) {
        const role = await rbac.findRoleBySlug(organizationId, mate.role);
        const user = await users.createUser({
          organizationId,
          email: mate.email,
          password: DEMO_PASSWORD,
          firstName: mate.first,
          lastName: mate.last,
          roles: [role],
        });
        created[mate.role] = user.id;
        logger.log(`Created ${mate.role}: ${mate.email}`);
      }

      // Give the manager a team so team-scoped access is actually demonstrable:
      // the manager leads the team, the rep and viewer are members. The manager
      // sees their own + the team's contacts, not the whole org.
      const team = await teams.createTeam(
        organizationId,
        { id: ownerId, level: 0, permissions: [], isOwner: true },
        {
          name: 'Enterprise Sales',
          leadId: created[SYSTEM_ROLES.MANAGER],
        },
      );
      await users.assignTeam(
        organizationId,
        ownerId,
        0,
        created[SYSTEM_ROLES.MEMBER],
        team.id,
      );
      await users.assignTeam(
        organizationId,
        ownerId,
        0,
        created[SYSTEM_ROLES.VIEWER],
        team.id,
      );
      logger.log(`Created team "${team.name}" led by manager@northwind.test`);

      // Seed contacts as the owner so they can be assigned to anyone.
      const ownerAccess = await rbac.resolveAccess(ownerId, organizationId);
      const actor: AuthenticatedUser = {
        id: ownerId,
        organizationId,
        email: owner.email,
        firstName: owner.firstName,
        lastName: owner.lastName,
        roles: ownerAccess.roles,
        level: ownerAccess.level,
        permissions: ownerAccess.permissions,
        isOwner: true,
        teamId: null,
        managerId: null,
      };

      const owners = [
        ownerId,
        created[SYSTEM_ROLES.MANAGER],
        created[SYSTEM_ROLES.MEMBER],
      ];

      for (let i = 0; i < 48; i += 1) {
        const first = FIRST_NAMES[i % FIRST_NAMES.length];
        const last = LAST_NAMES[i % LAST_NAMES.length];
        const company = COMPANIES[i % COMPANIES.length];

        await contacts.create(actor, {
          firstName: first,
          lastName: last,
          email: `${first}.${last}${i}@${company.toLowerCase().replace(/\s+/g, '')}.test`,
          phone: `+1 555 01${String(i).padStart(2, '0')}`,
          company,
          jobTitle: TITLES[i % TITLES.length],
          status: CONTACT_STATUSES[i % CONTACT_STATUSES.length],
          source: CONTACT_SOURCES[i % CONTACT_SOURCES.length],
          notes:
            i % 4 === 0
              ? 'Warm intro from the Q3 conference. Follow up next week.'
              : '',
          ownerId: owners[i % owners.length],
        });
      }

      // One annual lease, started three months ago and set to auto-approve, so
      // CI's books check covers bill generation, prepaid and the release
      // catch-up. FORCE RLS applies to this connection, hence the tenant scope.
      await tenantContext.runWithTenant(organizationId, async () => {
        const suppliers = dataSource.getRepository(Supplier);
        if (
          await suppliers.exists({
            where: { tenantId: organizationId, companyName: LEASE_SUPPLIER },
          })
        ) {
          return;
        }
        const supplier = await suppliers.save(
          suppliers.create({
            tenantId: organizationId,
            companyName: LEASE_SUPPLIER,
            currency: 'USD',
          }),
        );
        const start = new Date();
        start.setUTCDate(1);
        start.setUTCMonth(start.getUTCMonth() - 3);
        start.setUTCHours(0, 0, 0, 0);
        const recurring = dataSource.getRepository(RecurringExpense);
        await recurring.save(
          recurring.create({
            tenantId: organizationId,
            supplierId: supplier.id,
            vendorName: LEASE_SUPPLIER,
            category: 'Rent & premises',
            amount: 120000,
            billingInterval: 'ANNUAL',
            startDate: isoDate(start),
            endDate: null,
            nextBillingDate: start,
            autoApprove: true,
            autoApproveById: ownerId,
            spreadOverPeriod: true,
            createdById: ownerId,
            status: 'ACTIVE',
          }),
        );
        leaseSeeded = true;
      });

      logger.log('');
      logger.log('─────────────────────────────────────────────');
      logger.log(`Seeded "${DEMO_ORG}" with 5 users and 48 contacts.`);
      logger.log(`Every account uses the password: ${DEMO_PASSWORD}`);
      logger.log('  owner@northwind.test    — everything, incl. billing');
      logger.log('  admin@northwind.test    — team + roles + all contacts');
      logger.log(
        '  manager@northwind.test  — leads "Enterprise Sales", sees its contacts',
      );
      logger.log('  rep@northwind.test      — only their own contacts');
      logger.log('  viewer@northwind.test   — read-only, own contacts');
      logger.log('─────────────────────────────────────────────');
    });

    // Both set their own tenant context, so they run outside any of ours.
    if (leaseSeeded) {
      await app.get(RecurringBillingService).run();
      await app.get(PrepaidService).releaseDue();
      logger.log('Billed and released the seeded annual lease.');
    }
  } finally {
    await app.close();
  }
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
