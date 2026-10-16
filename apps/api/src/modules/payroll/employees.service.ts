import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import {
  packageGross,
  type CreateEmployeePayload,
  type CreateSalaryPackagePayload,
  type EmployeeStatus,
  type SalaryPackageDto,
  type UpdateEmployeePayload,
} from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '@/database/tenant-sequence.util';
import { User } from '../users/entities/user.entity';
import { Employee } from './entities/employee.entity';
import { SalaryPackage } from './entities/salary-package.entity';
import { PayrollCryptoService } from './payroll-crypto.service';
import type { EmployeeView } from './employee-mask';

/** withIban: decrypt the full IBAN (employee:manage holders only). */
export interface ViewOptions {
  withIban?: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);
const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;

export function toPackageDto(p: SalaryPackage): SalaryPackageDto {
  return {
    id: p.id,
    employeeId: p.employeeId,
    effectiveFrom: p.effectiveFrom,
    basic: p.basic,
    housing: p.housing,
    transport: p.transport,
    otherAllowances: p.otherAllowances ?? [],
    gross: packageGross(p),
    createdAt: p.createdAt.toISOString(),
  };
}

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly crypto: PayrollCryptoService,
  ) {}

  async list(
    tenantId: string,
    q: { status?: EmployeeStatus; search?: string },
    opts: ViewOptions = {},
  ): Promise<EmployeeView[]> {
    const manager = this.dataSource.manager;
    const where: Record<string, unknown> = { tenantId };
    if (q.status) where.status = q.status;
    let rows = await manager.getRepository(Employee).find({ where });
    // A tenant's headcount is in the hundreds, so the search filters in memory.
    const needle = q.search?.trim().toLowerCase();
    if (needle) {
      rows = rows.filter((e) =>
        [`${e.firstName} ${e.lastName}`, e.employeeNumber, e.jobTitle ?? '']
          .join('\n')
          .toLowerCase()
          .includes(needle),
      );
    }
    rows.sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
    const all = await manager
      .getRepository(SalaryPackage)
      .find({ where: { tenantId } });
    const day = today();
    return rows.map((e) =>
      this.toView(
        e,
        this.pick(all.filter((p) => p.employeeId === e.id), day),
        opts,
      ),
    );
  }

  async get(
    tenantId: string,
    id: string,
    opts: ViewOptions = {},
  ): Promise<EmployeeView> {
    const manager = this.dataSource.manager;
    return this.view(manager, await this.load(manager, tenantId, id), opts);
  }

  async create(
    tenantId: string,
    actorId: string,
    input: CreateEmployeePayload,
    opts: ViewOptions = {},
  ): Promise<EmployeeView> {
    void actorId; // the audit trail records who; the row does not
    return this.dataSource.transaction(async (manager) => {
      if (input.userId) {
        await this.assertUserLinkable(manager, tenantId, input.userId);
      }
      const repo = manager.getRepository(Employee);
      const seq = await allocateNextSequenceValue(
        manager,
        tenantId,
        'employee_number',
      );
      const bank = input.paymentMethod === 'BANK';
      const iban = bank ? input.iban : null;
      const row = repo.create({
        tenantId,
        employeeNumber: formatSequenceNumber('EMP', seq),
        firstName: input.firstName,
        lastName: input.lastName,
        jobTitle: input.jobTitle ?? null,
        department: input.department ?? null,
        userId: input.userId ?? null,
        joiningDate: input.joiningDate,
        leavingDate: input.leavingDate ?? null,
        status: input.status,
        nationality: input.nationality ?? null,
        isNational: input.isNational,
        paymentMethod: input.paymentMethod,
        bankName: bank ? (input.bankName ?? null) : null,
        ibanEncrypted: iban ? this.crypto.encrypt(iban) : null,
        ibanLast4: iban ? iban.slice(-4) : null,
        email: input.email ?? null,
        phone: input.phone ?? null,
      });
      return this.view(manager, await repo.save(row), opts);
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateEmployeePayload,
    opts: ViewOptions = {},
  ): Promise<EmployeeView> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Employee);
      const row = await this.load(manager, tenantId, id);
      const { iban, ...fields } = input;

      if (fields.userId && fields.userId !== row.userId) {
        await this.assertUserLinkable(manager, tenantId, fields.userId, row.id);
      }
      Object.assign(row, fields);

      if (row.status === 'LEFT' && !row.leavingDate) {
        throw new BadRequestException(
          'A leaving date is required when status is Left',
        );
      }
      if (row.leavingDate && row.leavingDate < row.joiningDate) {
        throw new BadRequestException('Leaving date cannot be before joining');
      }

      if (row.paymentMethod === 'CASH') {
        row.ibanEncrypted = null;
        row.ibanLast4 = null;
        row.bankName = null;
      } else if (iban) {
        if (!IBAN_PATTERN.test(iban)) {
          throw new BadRequestException('Enter a valid IBAN');
        }
        row.ibanEncrypted = this.crypto.encrypt(iban);
        row.ibanLast4 = iban.slice(-4);
      } else if (input.paymentMethod === 'BANK' && !row.ibanEncrypted) {
        throw new BadRequestException('Bank payees need an IBAN');
      }
      return this.view(manager, await repo.save(row), opts);
    });
  }

  async listPackages(
    tenantId: string,
    employeeId: string,
  ): Promise<SalaryPackageDto[]> {
    const manager = this.dataSource.manager;
    await this.load(manager, tenantId, employeeId);
    const rows = await manager
      .getRepository(SalaryPackage)
      .find({ where: { tenantId, employeeId } });
    return rows
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
      .map(toPackageDto);
  }

  async addPackage(
    tenantId: string,
    employeeId: string,
    actorId: string,
    input: CreateSalaryPackagePayload,
  ): Promise<SalaryPackageDto> {
    return this.dataSource.transaction(async (manager) => {
      const employee = await this.load(manager, tenantId, employeeId);
      if (input.effectiveFrom < employee.joiningDate) {
        throw new BadRequestException(
          'A salary package cannot start before the joining date',
        );
      }
      const repo = manager.getRepository(SalaryPackage);
      const dup = await repo.findOne({
        where: { tenantId, employeeId, effectiveFrom: input.effectiveFrom },
      });
      if (dup) {
        throw new ConflictException(
          'A salary package already starts on that date',
        );
      }
      const saved = await repo.save(
        repo.create({
          tenantId,
          employeeId,
          effectiveFrom: input.effectiveFrom,
          basic: input.basic,
          housing: input.housing,
          transport: input.transport,
          otherAllowances: input.otherAllowances,
          createdById: actorId,
        }),
      );
      return toPackageDto(saved);
    });
  }

  /** The package in force on `date`: the greatest `effectiveFrom` at or before it. */
  async packageAt(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
    date: string,
  ): Promise<SalaryPackage | null> {
    const rows = await manager
      .getRepository(SalaryPackage)
      .find({ where: { tenantId, employeeId } });
    return this.pick(rows, date);
  }

  private pick(rows: SalaryPackage[], date: string): SalaryPackage | null {
    let best: SalaryPackage | null = null;
    for (const p of rows) {
      if (p.effectiveFrom <= date && (!best || p.effectiveFrom > best.effectiveFrom)) {
        best = p;
      }
    }
    return best;
  }

  private async load(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<Employee> {
    const row = await manager
      .getRepository(Employee)
      .findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Employee not found');
    return row;
  }

  private async assertUserLinkable(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    selfId?: string,
  ) {
    const user = await manager
      .getRepository(User)
      .findOne({ where: { id: userId, tenantId } });
    if (!user) {
      throw new BadRequestException('That user does not exist in this organisation');
    }
    const linked = await manager
      .getRepository(Employee)
      .findOne({ where: { tenantId, userId } });
    if (linked && linked.id !== selfId) {
      throw new ConflictException(
        'That user is already linked to another employee',
      );
    }
  }

  private async view(
    manager: EntityManager,
    e: Employee,
    opts: ViewOptions,
  ): Promise<EmployeeView> {
    const pkg = await this.packageAt(manager, e.tenantId, e.id, today());
    return this.toView(e, pkg, opts);
  }

  /**
   * The full IBAN only for callers who may see it, and a ciphertext that will
   * not decrypt (rotated key, corrupt row) costs that one IBAN, not the page.
   */
  private ibanOf(e: Employee, opts: ViewOptions): string | null {
    if (!opts.withIban || !e.ibanEncrypted) return null;
    try {
      return this.crypto.decrypt(e.ibanEncrypted);
    } catch {
      // The id only: never the ciphertext.
      this.logger.error(`IBAN for employee ${e.id} could not be decrypted`);
      return null;
    }
  }

  private toView(
    e: Employee,
    pkg: SalaryPackage | null,
    opts: ViewOptions,
  ): EmployeeView {
    return {
      id: e.id,
      employeeNumber: e.employeeNumber,
      firstName: e.firstName,
      lastName: e.lastName,
      fullName: `${e.firstName} ${e.lastName}`,
      jobTitle: e.jobTitle,
      department: e.department,
      userId: e.userId,
      joiningDate: e.joiningDate,
      leavingDate: e.leavingDate,
      status: e.status,
      nationality: e.nationality,
      isNational: e.isNational,
      paymentMethod: e.paymentMethod,
      bankName: e.bankName,
      iban: this.ibanOf(e, opts),
      ibanLast4: e.ibanLast4,
      email: e.email,
      phone: e.phone,
      currentPackage: pkg ? toPackageDto(pkg) : null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }
}
