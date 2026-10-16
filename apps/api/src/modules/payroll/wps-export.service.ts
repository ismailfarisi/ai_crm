import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { In } from 'typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import {
  buildSif,
  PERMISSIONS,
  round2,
  sifIncomeSplit,
  type SifRow,
  type WpsSifDto,
} from '@saas/shared';
import { baseCurrencyFor } from '../finance/fx';
import { Employee } from './entities/employee.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { Settlement } from './entities/settlement.entity';
import { PayrollCryptoService } from './payroll-crypto.service';
import { PayrollSettingsService } from './payroll-settings.service';
import type { PayrollActor } from './payroll-posting.service';

const RUN_STATUSES = ['APPROVED', 'PARTIALLY_PAID', 'PAID'];
const SETTLEMENT_STATUSES = ['APPROVED', 'PAID'];

/** A row waiting to go in the file: who it is for and what it carries. */
interface Pending {
  name: string;
  employeeId: string;
  payStart: string;
  payEnd: string;
  days: number;
  netPay: number;
  variable: number;
  leaveDays: number;
}

const lastDayOf = (period: string): string => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/**
 * The WPS salary information file for an approved run or settlement. The
 * body holds bank account numbers, so it is returned to the caller and goes
 * nowhere else: the audit interceptor records snapshots and request bodies,
 * never responses.
 */
@Injectable()
export class WpsExportService {
  private readonly logger = new Logger(WpsExportService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: PayrollSettingsService,
    private readonly crypto: PayrollCryptoService,
  ) {}

  async forRun(
    tenantId: string,
    runId: string,
    actor: PayrollActor,
  ): Promise<WpsSifDto> {
    this.assertMayPay(actor);
    const manager = this.dataSource.manager;
    const employer = await this.employer(manager, tenantId);

    const run = await manager
      .getRepository(PayrollRun)
      .findOne({ where: { id: runId, tenantId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (!RUN_STATUSES.includes(run.status)) {
      throw new ConflictException(
        `${run.runNumber} is ${run.status}; only approved runs can be exported`,
      );
    }

    const lines = (
      await manager
        .getRepository(PayrollRunLine)
        .find({ where: { runId, tenantId } })
    ).sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
    const warnings: string[] = [];
    const first = `${run.period}-01`;
    const last = lastDayOf(run.period);
    const employees = await this.employeesById(
      manager,
      tenantId,
      lines.map((l) => l.employeeId),
    );

    const pending: Pending[] = [];
    for (const l of lines) {
      if (l.paymentMethod !== 'BANK') {
        warnings.push(`${l.employeeName} is paid in cash and is not in the file`);
        continue;
      }
      const e = employees.get(l.employeeId);
      const joined = e?.joiningDate ?? first;
      const left = e?.leavingDate ?? last;
      pending.push({
        name: l.employeeName,
        employeeId: l.employeeId,
        payStart: joined > first ? joined : first,
        payEnd: left < last ? left : last,
        days: l.daysEmployed,
        netPay: l.netPay,
        variable: l.overtimeAmount + l.bonusAmount,
        leaveDays: l.leaveDaysInPeriod,
      });
    }

    return this.build(employer, pending, employees, run.period, run.runNumber, warnings);
  }

  async forSettlement(
    tenantId: string,
    settlementId: string,
    actor: PayrollActor,
  ): Promise<WpsSifDto> {
    this.assertMayPay(actor);
    const manager = this.dataSource.manager;
    const employer = await this.employer(manager, tenantId);

    const s = await manager
      .getRepository(Settlement)
      .findOne({ where: { id: settlementId, tenantId } });
    if (!s) throw new NotFoundException('Settlement not found');
    if (!SETTLEMENT_STATUSES.includes(s.status)) {
      throw new ConflictException(
        `${s.settlementNumber} is ${s.status}; only approved settlements can be exported`,
      );
    }
    if (s.paymentMethod !== 'BANK') {
      throw new ConflictException(`${s.settlementNumber} is paid in cash`);
    }

    const employees = await this.employeesById(manager, tenantId, [s.employeeId]);
    return this.build(
      employer,
      [
        {
          name: s.employeeName,
          employeeId: s.employeeId,
          payStart: s.leavingDate,
          payEnd: s.leavingDate,
          days: 0,
          netPay: s.netPay,
          variable: s.netPay,
          leaveDays: 0,
        },
      ],
      employees,
      s.leavingDate.slice(0, 7),
      s.settlementNumber,
      [],
      true,
    );
  }

  private assertMayPay(actor: PayrollActor): void {
    if (!actor.permissions.includes(PERMISSIONS.PAYROLL_PAY)) {
      throw new ForbiddenException(
        'You do not have permission to export payroll payment files.',
      );
    }
  }

  private async employer(manager: EntityManager, tenantId: string) {
    const cfg = await this.settings.get(tenantId, manager);
    if (!cfg.wpsEnabled) {
      throw new ConflictException('WPS is switched off in payroll settings');
    }
    const base = await baseCurrencyFor(manager, tenantId);
    if (base !== 'AED') {
      throw new ConflictException(
        `WPS salary files are in AED; this organisation's base currency is ${base}`,
      );
    }
    if (!cfg.employerId || !cfg.employerIdType || !cfg.payerRoutingCode) {
      throw new ConflictException(
        'Employer ID, ID type and payer routing code are required in payroll settings',
      );
    }
    return {
      employerId: cfg.employerId,
      employerIdType: cfg.employerIdType,
      payerRoutingCode: cfg.payerRoutingCode,
    };
  }

  private async employeesById(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, Employee>> {
    if (!ids.length) return new Map();
    const rows = await manager.getRepository(Employee).find({
      where: { tenantId, id: In(ids) },
      withDeleted: true,
    });
    return new Map(rows.map((e) => [e.id, e]));
  }

  /** `wholeVariable`: a settlement is a one-off, so none of it is fixed salary. */
  private build(
    employer: Parameters<typeof buildSif>[0]['employer'],
    pending: Pending[],
    employees: Map<string, Employee>,
    salaryMonth: string,
    reference: string,
    warnings: string[],
    wholeVariable = false,
  ): WpsSifDto {
    const problems: string[] = [];
    const rows: SifRow[] = [];
    for (const p of pending) {
      const e = employees.get(p.employeeId);
      const before = problems.length;
      if (!e) problems.push(`${p.name}: employee record not found`);
      if (p.netPay < 0) problems.push(`${p.name}: net pay is negative`);
      if (e && !e.wpsPersonId) problems.push(`${p.name}: WPS person ID missing`);
      if (e && !e.bankRoutingCode) problems.push(`${p.name}: bank routing code missing`);
      let iban: string | null = null;
      if (e) {
        if (!e.ibanEncrypted) {
          problems.push(`${p.name}: IBAN missing`);
        } else {
          try {
            iban = this.crypto.decrypt(e.ibanEncrypted);
          } catch {
            // The id only: never the ciphertext.
            this.logger.error(`IBAN for employee ${e.id} could not be decrypted`);
            problems.push(`${p.name}: IBAN could not be read`);
          }
        }
      }
      if (problems.length > before || !e || iban == null) continue;

      const split = wholeVariable
        ? { fixed: 0, variable: round2(p.netPay) }
        : sifIncomeSplit(p.netPay, p.variable);
      rows.push({
        personId: e.wpsPersonId as string,
        routingCode: e.bankRoutingCode as string,
        iban,
        payStart: p.payStart,
        payEnd: p.payEnd,
        days: p.days,
        fixed: split.fixed,
        variable: split.variable,
        leaveDays: p.leaveDays,
      });
    }
    if (problems.length) {
      throw new UnprocessableEntityException(
        `Fix before exporting: ${problems.join('; ')}`,
      );
    }
    if (!rows.length) {
      throw new UnprocessableEntityException('There are no bank-paid lines to export');
    }
    const { fileName, content } = buildSif({
      employer,
      rows,
      salaryMonth,
      createdAt: new Date(),
      reference,
    });
    return { fileName, content, warnings };
  }
}
