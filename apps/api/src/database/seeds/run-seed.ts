import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  CONTACT_SOURCES,
  CONTACT_STATUSES,
  createEmployeeSchema,
  createPayrollRunSchema,
  createSalaryPackageSchema,
  isoDate,
  LEDGER_ROLES,
  monthsTouched,
  PERMISSIONS,
  periodBounds,
  postOpeningGratuitySchema,
  recordAdvanceSchema,
  SYSTEM_ROLES,
  updatePayrollLineSchema,
  utcToday,
  type PayrollRunDto,
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
import { SupplierBill } from '@/modules/payables/entities/supplier-bill.entity';
import { PrepaidSchedule } from '@/modules/payables/entities/prepaid-schedule.entity';
import { JournalEntry } from '@/modules/finance/entities/journal-entry.entity';
import { FinanceService } from '@/modules/finance/finance.service';
import { LedgerAccount } from '@/modules/finance/entities/ledger-account.entity';
import { Employee } from '@/modules/payroll/entities/employee.entity';
import { GratuityLedgerEntry } from '@/modules/payroll/entities/gratuity-ledger-entry.entity';
import { EmployeesService } from '@/modules/payroll/employees.service';
import { GratuityService } from '@/modules/payroll/gratuity.service';
import { AdvancesService } from '@/modules/payroll/advances.service';
import { PayrollRunsService } from '@/modules/payroll/payroll-runs.service';
import { PayrollPostingService } from '@/modules/payroll/payroll-posting.service';
import { DataSource, In } from 'typeorm';
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
    let leaseTenantId: string | null = null;

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
        leaseTenantId = organizationId;
      });

      // Employees, opening gratuity, an advance and one paid payroll run, so
      // CI's books check covers payroll postings. Same tenant scope as above.
      await tenantContext.runWithTenant(organizationId, () =>
        seedPayroll(app, dataSource, organizationId, ownerId, logger),
      );

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
      // run() logs and skips a failing row; fail the seed instead, so CI's
      // books check never passes without having exercised the lease.
      await tenantContext.runWithTenant(leaseTenantId!, () =>
        assertLeaseBilled(dataSource, leaseTenantId!, logger),
      );
      logger.log('Billed and released the seeded annual lease.');
    }
  } finally {
    await app.close();
  }
}

/**
 * The seeded lease must have produced one approved bill, its prepaid schedule,
 * and one release per month from the first month through this one.
 */
async function assertLeaseBilled(
  dataSource: DataSource,
  tenantId: string,
  logger: Logger,
): Promise<void> {
  const supplier = await dataSource.getRepository(Supplier).findOne({
    where: { tenantId, companyName: LEASE_SUPPLIER },
  });
  if (!supplier) throw new Error(`Seed lease check: supplier "${LEASE_SUPPLIER}" not found`);
  const bills = await dataSource.getRepository(SupplierBill).find({
    where: { tenantId, supplierId: supplier.id },
  });
  const approved = bills.filter((b) =>
    ['APPROVED', 'PARTIALLY_PAID', 'PAID'].includes(b.status),
  );
  const schedules = approved.length
    ? await dataSource.getRepository(PrepaidSchedule).find({
        where: { tenantId, billId: In(approved.map((b) => b.id)) },
      })
    : [];
  const schedule = schedules[0];
  const expected = schedule
    ? Math.min(schedule.months, monthsTouched(schedule.firstMonth, utcToday()))
    : 0;
  const releases = schedule
    ? await dataSource.getRepository(JournalEntry).count({
        where: { tenantId, referenceType: 'PREPAID', referenceId: schedule.id },
      })
    : 0;
  logger.log(
    `Seed lease: ${bills.length} bill(s), ${approved.length} approved, ${schedules.length} prepaid schedule(s), ${releases}/${expected} monthly release(s)`,
  );
  if (bills.length !== 1 || approved.length !== 1) {
    throw new Error(
      `Seed lease check: expected exactly one approved bill for "${LEASE_SUPPLIER}", found ${bills.length} bill(s) with statuses [${bills.map((b) => b.status).join(', ')}]. See the recurring billing log above.`,
    );
  }
  if (schedules.length !== 1) {
    throw new Error(
      `Seed lease check: expected one prepaid schedule for ${approved[0].billNumber}, found ${schedules.length}`,
    );
  }
  if (releases !== expected) {
    throw new Error(
      `Seed lease check: expected ${expected} PREPAID release entries for schedule ${schedule.id} (from ${schedule.firstMonth} through this month), found ${releases}`,
    );
  }
}

type SeedApp = Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;

const NATIONAL_FLAG = 'NATIONAL_PENSION_NOT_HANDLED';

/** `YYYY-MM` for the month `back` months before this one (UTC). */
function periodBack(back: number): string {
  const now = new Date();
  return isoDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)),
  ).slice(0, 7);
}

/** The first of this month, `years` years ago (UTC). */
function yearsAgo(years: number): string {
  const now = new Date();
  return isoDate(
    new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), 1)),
  );
}

/**
 * Six employees (four bank, two cash), opening gratuity at the end of two
 * months ago, one advance, and last month's run approved and paid.
 * Skipped when the org already has employees.
 */
async function seedPayroll(
  app: SeedApp,
  dataSource: DataSource,
  tenantId: string,
  ownerId: string,
  logger: Logger,
): Promise<void> {
  if (
    await dataSource.getRepository(Employee).exists({ where: { tenantId } })
  ) {
    logger.warn('Employees already exist — skipping payroll seed.');
    return;
  }
  const employees = app.get(EmployeesService);
  const gratuity = app.get(GratuityService);
  const advances = app.get(AdvancesService);
  const runs = app.get(PayrollRunsService);
  const posting = app.get(PayrollPostingService);
  const finance = app.get(FinanceService);
  const rbac = app.get(RbacService);

  const access = await rbac.resolveAccess(ownerId, tenantId);
  const actor = { userId: ownerId, permissions: access.permissions };
  for (const p of [PERMISSIONS.PAYROLL_APPROVE, PERMISSIONS.PAYROLL_PAY]) {
    if (!actor.permissions.includes(p)) {
      throw new Error(`Seed payroll: owner lacks ${p}`);
    }
  }

  const lastPeriod = periodBack(1);
  const cutover = periodBounds(periodBack(2)).last;

  // Finance accounts, in the org's base currency (USD for the demo org).
  let accounts = await finance.findAllAccounts(tenantId);
  let bank =
    accounts.find(
      (a) => a.accountType === 'BANK' && a.currency === 'USD' && a.isDefault,
    ) ?? accounts.find((a) => a.accountType === 'BANK' && a.currency === 'USD');
  if (!bank) {
    bank = await finance.createAccount(tenantId, {
      name: 'Operating account',
      accountType: 'BANK',
      currency: 'USD',
      balance: 500000,
    });
  }
  accounts = await finance.findAllAccounts(tenantId);
  let petty = accounts.find(
    (a) => a.accountType === 'CASH' && a.currency === 'USD',
  );
  if (!petty) {
    petty = await finance.createAccount(tenantId, {
      name: 'Petty cash',
      accountType: 'CASH',
      currency: 'USD',
      balance: 50000,
    });
  }

  // 1. Employees and packages (effective on the joining date).
  const people = [
    { first: 'Layla', last: 'Haddad', title: 'Operations Manager', joined: yearsAgo(6), method: 'BANK', iban: 'AE070331234567890123450', basic: 15000, housing: 6000, transport: 1000, national: false },
    { first: 'Omar', last: 'Khalid', title: 'Accountant', joined: yearsAgo(4), method: 'BANK', iban: 'AE070331234567890123451', basic: 9000, housing: 3150, transport: 800, national: false },
    { first: 'Priya', last: 'Nair', title: 'Sales Executive', joined: yearsAgo(2), method: 'BANK', iban: 'AE070331234567890123452', basic: 6000, housing: 1800, transport: 600, national: false },
    { first: 'Sami', last: 'Rahman', title: 'Coordinator', joined: `${lastPeriod}-15`, method: 'BANK', iban: 'AE070331234567890123453', basic: 4000, housing: 1000, transport: 500, national: false },
    { first: 'Yusuf', last: 'Ali', title: 'Driver', joined: yearsAgo(3), method: 'CASH', iban: null, basic: 5000, housing: 1750, transport: 500, national: false },
    { first: 'Mariam', last: 'Al Mansoori', title: 'Public Relations Officer', joined: yearsAgo(1), method: 'CASH', iban: null, basic: 7000, housing: 2100, transport: 700, national: true },
  ];
  const ids: string[] = [];
  for (const p of people) {
    const payload = createEmployeeSchema.parse({
      firstName: p.first,
      lastName: p.last,
      jobTitle: p.title,
      department: 'Operations',
      joiningDate: p.joined,
      status: 'ACTIVE',
      nationality: p.national ? 'AE' : 'IN',
      isNational: p.national,
      paymentMethod: p.method,
      bankName: p.method === 'BANK' ? 'Seed National Bank' : null,
      iban: p.iban,
    });
    const created = await employees.create(tenantId, ownerId, payload);
    await employees.addPackage(
      tenantId,
      created.id,
      ownerId,
      createSalaryPackageSchema.parse({
        effectiveFrom: p.joined,
        basic: p.basic,
        housing: p.housing,
        transport: p.transport,
      }),
    );
    ids.push(created.id);
  }
  const [layla, omar, priya, , yusuf, mariam] = ids;

  // 2. Opening gratuity as of the end of two months ago. The preview skips
  // anyone who joined after the cut-over (Sami).
  const preview = await gratuity.previewOpening(tenantId, cutover);
  await gratuity.postOpening(
    tenantId,
    ownerId,
    postOpeningGratuitySchema.parse({
      cutoverDate: cutover,
      lines: preview.lines.map((l) => ({
        employeeId: l.employeeId,
        amount: l.calculated,
      })),
    }),
  );

  // 3. One advance of 2,000 to Omar (bank), dated the 10th of two months ago.
  await advances.record(
    tenantId,
    omar,
    ownerId,
    recordAdvanceSchema.parse({
      amount: 2000,
      financeAccountId: bank.id,
      issuedAt: new Date(`${periodBack(2)}-10T00:00:00.000Z`),
      note: 'Seed advance',
    }),
  );

  // 4. Last month's run, extras, approval and payment.
  const created = await runs.create(
    tenantId,
    ownerId,
    createPayrollRunSchema.parse({
      period: lastPeriod,
      payDate: periodBounds(lastPeriod).last,
    }),
  );
  const lineOf = (employeeId: string): string => {
    const line = created.lines?.find((l) => l.employeeId === employeeId);
    if (!line) {
      throw new Error(`Seed payroll: no run line for employee ${employeeId}`);
    }
    return line.id;
  };
  const edits: [string, Record<string, unknown>][] = [
    [layla, { overtimeHours: 10 }],
    [priya, { bonusAmount: 1000, bonusLabel: 'Seed bonus' }],
    [omar, { advanceRecovery: 1000 }],
    [yusuf, { unpaidLeaveDays: 2 }],
  ];
  for (const [employeeId, patch] of edits) {
    await runs.updateLine(
      tenantId,
      created.id,
      lineOf(employeeId),
      updatePayrollLineSchema.parse(patch),
    );
  }
  await posting.approve(tenantId, created.id, actor);
  await posting.pay(tenantId, created.id, actor, {
    method: 'BANK',
    financeAccountId: bank.id,
  });
  const paid = await posting.pay(tenantId, created.id, actor, {
    method: 'CASH',
    financeAccountId: petty.id,
  });

  await assertPayrollSeeded(dataSource, tenantId, paid, mariam, logger);
  logger.log(
    `Seeded 6 employees and paid payroll run ${paid.runNumber} (${lastPeriod}).`,
  );
}

async function assertPayrollSeeded(
  dataSource: DataSource,
  tenantId: string,
  run: PayrollRunDto,
  nationalEmployeeId: string,
  logger: Logger,
): Promise<void> {
  const fail = (msg: string): never => {
    throw new Error(`Seed payroll check: ${msg}`);
  };
  if (run.status !== 'PAID') {
    fail(`run ${run.runNumber} is ${run.status}, expected PAID`);
  }
  if (!run.journalEntryId) {
    fail(`run ${run.runNumber} has no approval journal entry`);
  }

  const entries = await dataSource.getRepository(JournalEntry).find({
    where: { tenantId, referenceType: 'PAYROLL', referenceId: run.id },
  });
  const numbers = entries.map((e) => e.entryNumber);
  for (const expected of [
    `JE-${run.runNumber}`,
    `JE-${run.runNumber}-BANK`,
    `JE-${run.runNumber}-CASH`,
  ]) {
    if (!numbers.includes(expected)) {
      fail(
        `missing journal entry ${expected} (found ${numbers.join(', ') || 'none'})`,
      );
    }
  }

  const provision = await dataSource.getRepository(LedgerAccount).findOne({
    where: { tenantId, role: LEDGER_ROLES.GRATUITY_PROVISION },
  });
  if (!provision) return fail('no GRATUITY_PROVISION ledger account');
  const allEntries = await dataSource
    .getRepository(JournalEntry)
    .find({ where: { tenantId } });
  let ledgerBalance = 0;
  for (const e of allEntries) {
    for (const l of e.lines) {
      if (l.ledgerAccountId === provision.id) {
        ledgerBalance += (l.credit ?? 0) - (l.debit ?? 0);
      }
    }
  }
  ledgerBalance = Math.round(ledgerBalance * 100) / 100;
  const rows = await dataSource
    .getRepository(GratuityLedgerEntry)
    .find({ where: { tenantId } });
  const gratuityTotal =
    Math.round(
      rows
        .filter((r) => r.kind === 'OPENING' || r.kind === 'ACCRUAL')
        .reduce((s, r) => s + r.amount, 0) * 100,
    ) / 100;
  if (ledgerBalance !== gratuityTotal) {
    fail(
      `GRATUITY_PROVISION balance ${ledgerBalance} != opening + accrual rows ${gratuityTotal}`,
    );
  }

  const flagged = (run.lines ?? []).filter((l) => l.flags.length > 0);
  if (
    flagged.length !== 1 ||
    flagged[0].employeeId !== nationalEmployeeId ||
    flagged[0].flags.join() !== NATIONAL_FLAG
  ) {
    fail(
      `expected only the national employee flagged, got [${flagged.map((l) => `${l.employeeName}: ${l.flags.join('/')}`).join('; ')}]`,
    );
  }
  logger.log(
    `Seed payroll: ${entries.length} payroll journal entries, provision ${ledgerBalance}.`,
  );
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
