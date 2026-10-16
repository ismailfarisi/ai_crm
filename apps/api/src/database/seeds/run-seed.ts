import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  bulkTimesheetSchema,
  CONTACT_SOURCES,
  CONTACT_STATUSES,
  createEmployeeSchema,
  createPayrollRunSchema,
  createSalaryPackageSchema,
  createSettlementSchema,
  isoDate,
  labourCost,
  leaveRecordSchema,
  LEDGER_ROLES,
  monthsTouched,
  paySettlementSchema,
  payrollSettingsSchema,
  PERMISSIONS,
  periodBounds,
  postOpeningGratuitySchema,
  postOpeningLeaveSchema,
  recordAdvanceSchema,
  remitPensionSchema,
  round2,
  SYSTEM_ROLES,
  updateEmployeeSchema,
  updatePayrollLineSchema,
  updatePensionSchemeSchema,
  utcToday,
  type LedgerRole,
  type PayrollRunDto,
  type SettlementDto,
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
import { LeaveLedgerEntry } from '@/modules/payroll/entities/leave-ledger-entry.entity';
import { EmployeesService } from '@/modules/payroll/employees.service';
import { GratuityService } from '@/modules/payroll/gratuity.service';
import { AdvancesService } from '@/modules/payroll/advances.service';
import { PayrollRunsService } from '@/modules/payroll/payroll-runs.service';
import { PayrollPostingService } from '@/modules/payroll/payroll-posting.service';
import { PayrollSettingsService } from '@/modules/payroll/payroll-settings.service';
import { PensionService } from '@/modules/payroll/pension.service';
import { PensionRemittanceService } from '@/modules/payroll/pension-remittance.service';
import { LeaveService } from '@/modules/payroll/leave.service';
import { LeaveRecordsService } from '@/modules/payroll/leave-records.service';
import { SettlementsService } from '@/modules/payroll/settlements.service';
import { ProductionService } from '@/modules/production/production.service';
import {
  WorkOrder,
  WorkOrderOperation,
} from '@/modules/production/entities/work-order.entity';
import { TimesheetsService } from '@/modules/job-costing/timesheets.service';
import { TimesheetEntry } from '@/modules/job-costing/entities/timesheet-entry.entity';
import { WorkOrderLabour } from '@/modules/job-costing/entities/work-order-labour.entity';
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
 * Seven employees (five bank, two cash), the WPS profile, the GPSSA scheme on
 * the national, opening gratuity and leave at the end of two months ago, one
 * advance, leave in last month, last month's run approved and paid, its
 * pension remitted, and one leaver (last month) settled and paid. Job
 * costing rides along: timesheets on two seeded jobs (one completed before
 * the approval, one after) and a clock entry this month.
 * Skipped when the org already has employees.
 *
 * The order follows the services' guards: openings before anyone is marked
 * LEFT (a leaver gets no opening); both cut-overs before last month (runs on
 * or before a cut-over are refused); the scheme assigned before approval (a
 * national without one blocks it); the run posted before the remittance and
 * the settlement (both need last month's posted run); timesheets entered
 * before approval (a posted month refuses them) on jobs already released.
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
  const settings = app.get(PayrollSettingsService);
  const pension = app.get(PensionService);
  const remittances = app.get(PensionRemittanceService);
  const leave = app.get(LeaveService);
  const leaveRecords = app.get(LeaveRecordsService);
  const settlements = app.get(SettlementsService);

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

  // 1. The WPS employer profile and the annual leave entitlement. The demo
  // org is USD, so no SIF is exported (WPS files are AED only).
  await settings.put(
    tenantId,
    payrollSettingsSchema.parse({
      wpsEnabled: true,
      employerIdType: 'MOHRE',
      employerId: '0000001234567',
      payerRoutingCode: '803320101',
      annualLeaveDays: 30,
    }),
  );

  // 2. Employees and packages (effective on the joining date).
  const people = [
    { first: 'Layla', last: 'Haddad', title: 'Operations Manager', joined: yearsAgo(6), method: 'BANK', iban: 'AE070331234567890123450', basic: 15000, housing: 6000, transport: 1000, national: false },
    { first: 'Omar', last: 'Khalid', title: 'Accountant', joined: yearsAgo(4), method: 'BANK', iban: 'AE070331234567890123451', basic: 9000, housing: 3150, transport: 800, national: false },
    { first: 'Priya', last: 'Nair', title: 'Sales Executive', joined: yearsAgo(2), method: 'BANK', iban: 'AE070331234567890123452', basic: 6000, housing: 1800, transport: 600, national: false },
    { first: 'Sami', last: 'Rahman', title: 'Coordinator', joined: `${lastPeriod}-15`, method: 'BANK', iban: 'AE070331234567890123453', basic: 4000, housing: 1000, transport: 500, national: false },
    { first: 'Yusuf', last: 'Ali', title: 'Driver', joined: yearsAgo(3), method: 'CASH', iban: null, basic: 5000, housing: 1750, transport: 500, national: false },
    { first: 'Mariam', last: 'Al Mansoori', title: 'Public Relations Officer', joined: yearsAgo(1), method: 'CASH', iban: null, basic: 7000, housing: 2100, transport: 700, national: true },
    { first: 'Hassan', last: 'Qureshi', title: 'Technician', joined: yearsAgo(3), method: 'BANK', iban: 'AE070331234567890123454', basic: 5500, housing: 1650, transport: 500, national: false },
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
  const [layla, omar, priya, , yusuf, mariam, hassan] = ids;

  // 3. WPS details for every bank payee: a 14-digit person ID and the
  // agent's routing code.
  let wpsSeq = 0;
  for (const [i, p] of people.entries()) {
    if (p.method !== 'BANK') continue;
    wpsSeq += 1;
    await employees.update(
      tenantId,
      ids[i],
      updateEmployeeSchema.parse({
        wpsPersonId: `1000000000000${wpsSeq}`,
        bankRoutingCode: '803320101',
      }),
    );
  }

  // 4. The GPSSA preset (seeded inactive by list()) switched on and assigned
  // to the national, so her line carries pension and approval is allowed.
  const gpssa = (await pension.list(tenantId)).find(
    (s) => s.presetKey === 'GPSSA_2023',
  );
  if (!gpssa) throw new Error('Seed payroll: GPSSA_2023 preset not found');
  await pension.update(
    tenantId,
    gpssa.id,
    updatePensionSchemeSchema.parse({ isActive: true }),
  );
  await employees.update(
    tenantId,
    mariam,
    updateEmployeeSchema.parse({ pensionSchemeId: gpssa.id }),
  );

  // 5. Opening gratuity as of the end of two months ago. The preview skips
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

  // 6. Opening leave at the same cut-over: each balance is the statutory
  // figure less five days taken before go-live. Same eligibility as the
  // gratuity preview: Sami joined after the cut-over.
  const leavePreview = await leave.previewOpening(tenantId, cutover);
  await leave.postOpening(
    tenantId,
    ownerId,
    postOpeningLeaveSchema.parse({
      cutoverDate: cutover,
      lines: leavePreview.lines.map((l) => ({
        employeeId: l.employeeId,
        balanceDays: Math.max(0, l.calculatedDays - 5),
      })),
    }),
    actor.permissions,
  );

  // 7. Hassan left on the 20th of last month — after both openings (a leaver
  // gets none) and before the run, which pays his final 20 days.
  await employees.update(
    tenantId,
    hassan,
    updateEmployeeSchema.parse({
      status: 'LEFT',
      leavingDate: `${lastPeriod}-20`,
    }),
  );

  // 8. One advance of 2,000 to Omar (bank), dated the 10th of two months ago.
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

  // 9. Leave in last month, recorded before the run so its lines carry it:
  // Priya's annual leave becomes a TAKEN row on approval; Layla's sick days
  // are within the full-pay band.
  const leaveInMonth: [string, 'ANNUAL' | 'SICK', string, string][] = [
    [priya, 'ANNUAL', '06', '08'],
    [layla, 'SICK', '12', '13'],
  ];
  for (const [employeeId, type, from, to] of leaveInMonth) {
    await leaveRecords.create(
      tenantId,
      employeeId,
      ownerId,
      leaveRecordSchema.parse({
        type,
        startDate: `${lastPeriod}-${from}`,
        endDate: `${lastPeriod}-${to}`,
      }),
    );
  }

  // 10. Last month's run, extras, approval and payment.
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
  // 10a. Job costing, before approval: hours in a posted month are refused,
  // and approval only absorbs hours already entered. Two released jobs take
  // timesheets from three employees on the payroll for the whole month (not
  // Sami, who joined mid-month, nor Hassan, who left); WO-SEED-1 is
  // completed now, after the period end, so approval charges its labour to
  // WIP and JE-<run>-LAB-DONE-WO-SEED-1 moves it to COGS on the completion
  // day (J19), while WO-SEED-2 is still open and takes its labour into WIP.
  const jobs = await seedJobs(dataSource, tenantId, ownerId, lastPeriod);
  await app.get(TimesheetsService).bulk(
    tenantId,
    ownerId,
    bulkTimesheetSchema.parse({
      upserts: [layla, omar, yusuf].flatMap((employeeId) =>
        ['03', '04', '05', '06', '07'].flatMap((day) => {
          const workDate = `${lastPeriod}-${day}`;
          return [
            { employeeId, workDate, hours: 6, operationId: jobs.cutting1 },
            { employeeId, workDate, hours: 1.5, operationId: jobs.assembly2 },
            { employeeId, workDate, hours: 0.5, indirectCategory: 'IDLE' },
          ];
        }),
      ),
      deletes: [],
    }),
  );
  const production = app.get(ProductionService);
  await production.complete(
    tenantId,
    jobs.wo1,
    ownerId,
    { qtyCompleted: 10 },
    true,
  );

  await posting.approve(tenantId, created.id, actor);
  await posting.pay(tenantId, created.id, actor, {
    method: 'BANK',
    financeAccountId: bank.id,
  });
  const paid = await posting.pay(tenantId, created.id, actor, {
    method: 'CASH',
    financeAccountId: petty.id,
  });

  // 10b. Job costing, after approval: completing WO-SEED-2 moves its WIP
  // labour to COGS. Then the owner is linked to Layla (employed today) and
  // logs 45 minutes on WO-SEED-3: a CLOCK entry in this month, provisional.
  await production.complete(
    tenantId,
    jobs.wo2,
    ownerId,
    { qtyCompleted: 10 },
    true,
  );
  await employees.update(
    tenantId,
    layla,
    updateEmployeeSchema.parse({ userId: ownerId }),
  );
  await production.logTime(tenantId, jobs.wo3, jobs.cutting3, ownerId, 45);

  // 11. Last month's pension to the fund, from the run just posted.
  await remittances.remit(
    tenantId,
    lastPeriod,
    actor,
    remitPensionSchema.parse({ financeAccountId: bank.id }),
  );

  // 12. Hassan's final settlement: his final month is posted, so it can be
  // drafted, approved (paying out his provisions) and paid.
  const draft = await settlements.create(
    tenantId,
    ownerId,
    createSettlementSchema.parse({ employeeId: hassan, reason: 'RESIGNATION' }),
  );
  await settlements.approve(tenantId, draft.id, actor);
  const settled = await settlements.pay(
    tenantId,
    draft.id,
    actor,
    paySettlementSchema.parse({ financeAccountId: bank.id }),
  );

  await assertPayrollSeeded(dataSource, tenantId, {
    run: paid,
    lastPeriod,
    nationalId: mariam,
    settlement: settled,
    logger,
  });
  await assertJobCostingSeeded(dataSource, tenantId, paid, jobs, logger);
  logger.log(
    `Seeded ${people.length} employees, paid payroll run ${paid.runNumber} (${lastPeriod}), remitted its pension and paid settlement ${settled.settlementNumber}.`,
  );
}

async function assertPayrollSeeded(
  dataSource: DataSource,
  tenantId: string,
  seeded: {
    run: PayrollRunDto;
    lastPeriod: string;
    nationalId: string;
    settlement: SettlementDto;
    logger: Logger;
  },
): Promise<void> {
  const { run, lastPeriod, nationalId, settlement, logger } = seeded;
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

  const allEntries = await dataSource
    .getRepository(JournalEntry)
    .find({ where: { tenantId } });
  const allNumbers = new Set(allEntries.map((e) => e.entryNumber));
  for (const expected of [
    `JE-PENSION-${lastPeriod}`,
    `JE-${settlement.settlementNumber}`,
  ]) {
    if (!allNumbers.has(expected)) fail(`missing journal entry ${expected}`);
  }

  /** Credit-normal balance of the ledger account(s) holding `role`. */
  const ledgerBalance = async (role: LedgerRole): Promise<number> => {
    const accounts = await dataSource
      .getRepository(LedgerAccount)
      .find({ where: { tenantId, role } });
    if (!accounts.length) return fail(`no ${role} ledger account`);
    const ids = new Set(accounts.map((a) => a.id));
    let balance = 0;
    for (const e of allEntries) {
      for (const l of e.lines) {
        if (ids.has(l.ledgerAccountId)) {
          balance += (l.credit ?? 0) - (l.debit ?? 0);
        }
      }
    }
    return round2(balance);
  };

  // Each provision equals Σ amount of its ledger rows — openings, accruals,
  // and the settlement's payout included.
  const gratuityRows = await dataSource
    .getRepository(GratuityLedgerEntry)
    .find({ where: { tenantId } });
  const gratuityTotal = round2(gratuityRows.reduce((s, r) => s + r.amount, 0));
  const gratuityLedger = await ledgerBalance(LEDGER_ROLES.GRATUITY_PROVISION);
  if (gratuityLedger !== gratuityTotal) {
    fail(
      `GRATUITY_PROVISION balance ${gratuityLedger} != gratuity ledger rows ${gratuityTotal}`,
    );
  }
  const leaveRows = await dataSource
    .getRepository(LeaveLedgerEntry)
    .find({ where: { tenantId } });
  const leaveTotal = round2(
    leaveRows.reduce((s, r) => s + (r.amount ?? 0), 0),
  );
  const leaveLedger = await ledgerBalance(LEDGER_ROLES.LEAVE_PROVISION);
  if (leaveLedger !== leaveTotal) {
    fail(
      `LEAVE_PROVISION balance ${leaveLedger} != leave ledger rows ${leaveTotal}`,
    );
  }
  const pensionLedger = await ledgerBalance(LEDGER_ROLES.PENSION_PAYABLE);
  if (pensionLedger !== 0) {
    fail(`PENSION_PAYABLE balance ${pensionLedger}, expected 0 once remitted`);
  }

  // The national has a scheme, so nothing is flagged and her line carries pension.
  const lines = run.lines ?? [];
  const flagged = lines.filter((l) => l.flags.length > 0);
  if (flagged.length) {
    fail(
      `expected no flagged lines, got [${flagged.map((l) => `${l.employeeName}: ${l.flags.join('/')}`).join('; ')}]`,
    );
  }
  const national = lines.find((l) => l.employeeId === nationalId);
  if (!national || !(national.pensionEmployee > 0)) {
    fail(
      `expected the national's line to withhold pension, got ${national?.pensionEmployee ?? 'no line'}`,
    );
  }

  // Every bank payee is ready for a SIF.
  const bankIds = lines
    .filter((l) => l.paymentMethod === 'BANK')
    .map((l) => l.employeeId);
  const bankPayees = bankIds.length
    ? await dataSource
        .getRepository(Employee)
        .find({ where: { tenantId, id: In(bankIds) } })
    : [];
  const missingWps = bankIds.filter(
    (id) => !bankPayees.find((e) => e.id === id)?.wpsPersonId,
  );
  if (missingWps.length) {
    fail(`bank payees without a WPS person ID: ${missingWps.join(', ')}`);
  }

  // The leaver is settled and carries nothing.
  if (settlement.status !== 'PAID') {
    fail(`${settlement.settlementNumber} is ${settlement.status}, expected PAID`);
  }
  const leaverId = settlement.employeeId;
  const leaverGratuity = round2(
    gratuityRows
      .filter((r) => r.employeeId === leaverId)
      .reduce((s, r) => s + r.amount, 0),
  );
  const leaverLeave = leaveRows.filter((r) => r.employeeId === leaverId);
  const leaverDays = round2(leaverLeave.reduce((s, r) => s + r.days, 0));
  const leaverProvision = round2(
    leaverLeave.reduce((s, r) => s + (r.amount ?? 0), 0),
  );
  if (leaverGratuity !== 0 || leaverDays !== 0 || leaverProvision !== 0) {
    fail(
      `${settlement.employeeName} still carries gratuity ${leaverGratuity}, leave ${leaverDays} days / ${leaverProvision} after ${settlement.settlementNumber}`,
    );
  }

  logger.log(
    `Seed payroll: ${entries.length} payroll journal entries, gratuity provision ${gratuityLedger}, leave provision ${leaveLedger}, ${settlement.settlementNumber} paid.`,
  );
}

/** Operations reference a work centre by id only (no foreign key). */
const SEED_WORK_CENTER_ID = '00000000-0000-4000-8000-00000000c0de';

interface SeededJobs {
  wo1: string;
  wo2: string;
  wo3: string;
  /** WO-SEED-1 "Cutting". */
  cutting1: string;
  /** WO-SEED-2 "Assembly". */
  assembly2: string;
  /** WO-SEED-3's only operation. */
  cutting3: string;
}

/**
 * Three in-progress jobs with no sales order: WO-SEED-1 and -2 released on
 * the first of `period`, WO-SEED-3 on the first of this month. Inserted
 * directly — releasing a job through the service needs a sales order.
 */
async function seedJobs(
  dataSource: DataSource,
  tenantId: string,
  ownerId: string,
  period: string,
): Promise<SeededJobs> {
  const woRepo = dataSource.getRepository(WorkOrder);
  const opRepo = dataSource.getRepository(WorkOrderOperation);
  const insert = async (
    n: number,
    releasedOn: string,
    labels: string[],
  ): Promise<{ id: string; ops: string[] }> => {
    const wo = await woRepo.save(
      woRepo.create({
        tenantId,
        woNumber: `WO-SEED-${n}`,
        status: 'IN_PROGRESS',
        salesOrderId: null,
        salesOrderLineId: null,
        description: `Seed job ${n}`,
        qty: 10,
        overheadPct: 0.1,
        releasedAt: new Date(`${releasedOn}T00:00:00.000Z`),
        createdById: ownerId,
      }),
    );
    const ops = await opRepo.save(
      labels.map((label, i) => {
        const minutes = (i + 1) * 120;
        return opRepo.create({
          tenantId,
          workOrderId: wo.id,
          sequence: i + 1,
          label,
          workCenterId: SEED_WORK_CENTER_ID,
          workCenterName: 'Seed bench',
          status: 'PAUSED',
          estimatedSetupMinutes: 0,
          estimatedRunMinutes: minutes,
          estimatedChargedMinutes: minutes,
          actualMinutes: 0,
          machineCostPerHour: 40,
          laborCostPerHour: 25,
        });
      }),
    );
    return { id: wo.id, ops: ops.map((o) => o.id) };
  };
  const first = periodBounds(period).first;
  const one = await insert(1, first, ['Cutting', 'Assembly']);
  const two = await insert(2, first, ['Cutting', 'Assembly']);
  const three = await insert(3, periodBounds(periodBack(0)).first, ['Cutting']);
  return {
    wo1: one.id,
    wo2: two.id,
    wo3: three.id,
    cutting1: one.ops[0],
    assembly2: two.ops[1],
    cutting3: three.ops[0],
  };
}

/**
 * The run's labour reached the jobs and the books agree: what payroll
 * absorbed equals the 6390 credit and the job rows; what it did not is
 * worked out from the ledger on its own and matches the lines; both
 * completed jobs carry their labour in COGS, at ACTUAL, with nothing left in
 * WIP (WO-SEED-1's moved by the run's LAB-DONE, dated its completion day);
 * and the owner's clock time became exactly one CLOCK entry.
 */
async function assertJobCostingSeeded(
  dataSource: DataSource,
  tenantId: string,
  run: PayrollRunDto,
  jobs: SeededJobs,
  logger: Logger,
): Promise<void> {
  const fail = (msg: string): never => {
    throw new Error(`Seed job costing check: ${msg}`);
  };
  const cents = (a: number, b: number) => Math.abs(a - b) < 0.005;

  const roleIds = new Map<string, LedgerRole>();
  for (const a of await dataSource
    .getRepository(LedgerAccount)
    .find({ where: { tenantId } })) {
    if (a.role) roleIds.set(a.id, a.role);
  }
  const entries = await dataSource
    .getRepository(JournalEntry)
    .find({ where: { tenantId } });
  const entry = (n: string) => entries.find((e) => e.entryNumber === n);
  /** Σ (debit − credit) of an entry's lines on `role`, optionally filtered. */
  const net = (
    e: JournalEntry | undefined,
    role: LedgerRole,
    side: 'debit' | 'credit' | 'net',
    keep: (description: string) => boolean = () => true,
  ) =>
    round2(
      (e?.lines ?? [])
        .filter(
          (l) => roleIds.get(l.ledgerAccountId) === role && keep(l.description),
        )
        .reduce(
          (s, l) =>
            s +
            (side === 'credit' ? 0 : Number(l.debit ?? 0)) -
            (side === 'debit' ? 0 : Number(l.credit ?? 0)),
          0,
        ),
    );

  // 1. Absorbed: the run total, its lines, the job rows and the 6390 credit.
  const absorbed = run.totals.labourAbsorbed;
  if (!(absorbed > 0)) fail(`run ${run.runNumber} absorbed ${absorbed}`);
  const rows = await dataSource
    .getRepository(WorkOrderLabour)
    .find({ where: { tenantId, runId: run.id } });
  const rowTotal = round2(rows.reduce((s, r) => s + r.amount, 0));
  const lines = run.lines ?? [];
  const lineTotal = round2(lines.reduce((s, l) => s + l.labourAbsorbed, 0));
  const lab = entry(`JE-${run.runNumber}-LAB`);
  if (!lab) return fail(`missing journal entry JE-${run.runNumber}-LAB`);
  const labDebits = round2(
    lab.lines.reduce((s, l) => s + Number(l.debit ?? 0), 0),
  );
  const labCredits = round2(
    lab.lines.reduce((s, l) => s + Number(l.credit ?? 0), 0),
  );
  if (!cents(labDebits, labCredits)) {
    fail(
      `JE-${run.runNumber}-LAB debits ${labDebits} != credits ${labCredits}`,
    );
  }
  const absorbedCredit = -net(lab, LEDGER_ROLES.LABOUR_ABSORBED, 'net');
  for (const [what, v] of [
    ['work_order_labour rows', rowTotal],
    ['line labourAbsorbed', lineTotal],
    ['6390 credit', absorbedCredit],
  ] as const) {
    if (!cents(v, absorbed)) {
      fail(`${what} ${v} != run labourAbsorbed ${absorbed}`);
    }
  }

  // 2. Never more than a line cost; unabsorbed from the ledger matches the
  // lines: the approval's payroll expense (gross salary cost, employer
  // pension, gratuity and leave movements) less what 6390 took to jobs.
  let lineUnabsorbed = 0;
  for (const l of lines) {
    const cost = labourCost({
      salaryCost: l.salaryCost,
      pensionEmployer: l.pensionEmployer,
      gratuityAccrual: l.gratuityAccrual ?? 0,
      leaveProvisionChange: l.leaveProvisionChange ?? 0,
    });
    if (l.labourAbsorbed < 0 || l.labourAbsorbed > Math.max(cost, 0)) {
      fail(`${l.employeeName} absorbed ${l.labourAbsorbed} of cost ${cost}`);
    }
    lineUnabsorbed += cost - l.labourAbsorbed;
  }
  lineUnabsorbed = round2(lineUnabsorbed);
  const payrollEntry = entry(`JE-${run.runNumber}`);
  const ledgerCost = round2(
    net(payrollEntry, LEDGER_ROLES.SALARIES, 'debit') +
      net(payrollEntry, LEDGER_ROLES.PENSION_EXPENSE, 'net') +
      net(payrollEntry, LEDGER_ROLES.GRATUITY_EXPENSE, 'net') +
      net(payrollEntry, LEDGER_ROLES.LEAVE_EXPENSE, 'net'),
  );
  const ledgerUnabsorbed = round2(ledgerCost - absorbedCredit);
  if (!cents(ledgerUnabsorbed, lineUnabsorbed)) {
    fail(
      `unabsorbed per the ledger ${ledgerUnabsorbed} (cost ${ledgerCost} − absorbed ${absorbedCredit}) != Σ(cost − absorbed) over lines ${lineUnabsorbed}`,
    );
  }

  // 3. Both completed jobs: labour in COGS, both via WIP — WO-SEED-1 was
  // completed after the period end, so the run's own LAB-DONE moved it on
  // the completion day (J19); WO-SEED-2 was open at approval and its
  // completion moved it — at ACTUAL, and their WIP back to zero.
  const workOrders = await dataSource
    .getRepository(WorkOrder)
    .find({ where: { tenantId, id: In([jobs.wo1, jobs.wo2]) } });
  const labDone = (woNumber: string) =>
    entry(`JE-${run.runNumber}-LAB-DONE-${woNumber}`);
  for (const [id, expect] of [
    [jobs.wo1, { account: 'WIP', clearedTo: 'COGS', labDone: true }],
    [jobs.wo2, { account: 'WIP', clearedTo: 'COGS', labDone: false }],
  ] as const) {
    const wo = workOrders.find((w) => w.id === id);
    if (!wo) return fail(`work order ${id} not found`);
    if (wo.status !== 'COMPLETE' || wo.labourStatus !== 'ACTUAL') {
      fail(
        `${wo.woNumber} is ${wo.status} with labour ${wo.labourStatus}, expected COMPLETE at ACTUAL`,
      );
    }
    const mine = rows.filter((r) => r.workOrderId === id);
    if (!mine.length) fail(`${wo.woNumber} absorbed no labour`);
    const wrong = mine.filter(
      (r) => r.account !== expect.account || r.clearedTo !== expect.clearedTo,
    );
    if (wrong.length) {
      fail(
        `${wo.woNumber} labour sits at [${wrong.map((r) => `${r.account}/${r.clearedTo}`).join(', ')}], expected ${expect.account}/${expect.clearedTo}`,
      );
    }
    const done = labDone(wo.woNumber);
    if (!!done !== expect.labDone) {
      fail(
        `${wo.woNumber}: JE-${run.runNumber}-LAB-DONE-${wo.woNumber} ${done ? 'posted' : 'missing'}, expected ${expect.labDone ? 'posted' : 'none'}`,
      );
    }
    if (done) {
      // Dated max(period end, completion day): never in the payroll's month.
      const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
      const want = [
        periodBounds(run.period).last,
        day(wo.completedAt!),
      ].sort()[1];
      if (day(done.entryDate) !== want) {
        fail(
          `${done.entryNumber} dated ${day(done.entryDate)}, expected ${want}`,
        );
      }
      if (
        !cents(net(done, LEDGER_ROLES.COGS, 'net'), Number(done.totalAmount))
      ) {
        fail(`${done.entryNumber} does not debit COGS by its total`);
      }
    }
    const wipIn = net(lab, LEDGER_ROLES.WIP, 'debit', (d) =>
      d.startsWith(`${wo.woNumber} `),
    );
    const wipOut = round2(
      -net(entry(`JE-${wo.woNumber}-DONE`), LEDGER_ROLES.WIP, 'credit') -
        net(done, LEDGER_ROLES.WIP, 'credit'),
    );
    if (!cents(wipIn, wipOut)) {
      fail(`${wo.woNumber} WIP balance ${round2(wipIn - wipOut)}, expected 0`);
    }
  }
  // No material is issued in the seed, so the tenant's WIP is empty too.
  const wip = round2(
    entries.reduce((s, e) => s + net(e, LEDGER_ROLES.WIP, 'net'), 0),
  );
  if (wip !== 0) fail(`WIP ledger balance ${wip}, expected 0`);

  // 4. The owner's 45 clock minutes, as Layla, this month.
  const clock = await dataSource
    .getRepository(TimesheetEntry)
    .find({ where: { tenantId, workOrderId: jobs.wo3 } });
  const thisMonth = periodBack(0);
  if (
    clock.length !== 1 ||
    clock[0].source !== 'CLOCK' ||
    clock[0].hours !== 0.75 ||
    clock[0].workDate.slice(0, 7) !== thisMonth
  ) {
    fail(
      `expected one CLOCK entry of 0.75 h in ${thisMonth} on WO-SEED-3, got [${clock.map((e) => `${e.source} ${e.hours} h ${e.workDate}`).join('; ')}]`,
    );
  }

  logger.log(
    `Seed job costing: ${run.runNumber} absorbed ${absorbed} (${rows.length} job rows), unabsorbed ${ledgerUnabsorbed}, WO-SEED-1/2 complete at ACTUAL with WIP 0, one clock entry on WO-SEED-3.`,
  );
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
