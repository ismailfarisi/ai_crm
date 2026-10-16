import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { QueryFailedError, type DataSource, type EntityManager } from 'typeorm';
import {
  PENSION_SCHEME_PRESETS,
  type CreatePensionSchemePayload,
  type PensionRates,
  type PensionSchemeDto,
  type UpdatePensionSchemePayload,
} from '@saas/shared';
import { Employee } from './entities/employee.entity';
import { PensionScheme } from './entities/pension-scheme.entity';

const toDto = (s: PensionScheme, assignedCount: number): PensionSchemeDto => ({
  id: s.id,
  name: s.name,
  presetKey: s.presetKey,
  employeePct: s.employeePct,
  employerPct: s.employerPct,
  base: s.base,
  minSalary: s.minSalary,
  maxSalary: s.maxSalary,
  isActive: s.isActive,
  assignedCount,
  createdAt: s.createdAt.toISOString(),
});

/** Pension funds a tenant uses for its national employees. */
@Injectable()
export class PensionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(tenantId: string): Promise<PensionSchemeDto[]> {
    const manager = this.dataSource.manager;
    // Presets arrive inactive: the rates change, so an admin confirms them first.
    for (const p of PENSION_SCHEME_PRESETS) {
      await manager.query(
        `INSERT INTO "pension_schemes"
           ("tenant_id", "name", "preset_key", "employee_pct", "employer_pct", "base", "min_salary", "max_salary", "is_active")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
         ON CONFLICT ("tenant_id", "preset_key") WHERE "preset_key" IS NOT NULL DO NOTHING`,
        [
          tenantId,
          p.name,
          p.key,
          p.rates.employeePct,
          p.rates.employerPct,
          p.rates.base,
          p.rates.minSalary,
          p.rates.maxSalary,
        ],
      );
    }
    const schemes = await manager
      .getRepository(PensionScheme)
      .find({ where: { tenantId } });
    // Soft-deleted employees are excluded by default.
    const employees = await manager
      .getRepository(Employee)
      .find({ where: { tenantId } });
    schemes.sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name),
    );
    return schemes.map((s) =>
      toDto(s, employees.filter((e) => e.pensionSchemeId === s.id).length),
    );
  }

  async create(
    tenantId: string,
    input: CreatePensionSchemePayload,
  ): Promise<PensionSchemeDto> {
    const repo = this.dataSource.manager.getRepository(PensionScheme);
    const saved = await repo.save(
      repo.create({
        tenantId,
        name: input.name,
        presetKey: null,
        employeePct: input.employeePct,
        employerPct: input.employerPct,
        base: input.base,
        minSalary: input.minSalary,
        maxSalary: input.maxSalary,
        isActive: true,
      }),
    );
    return toDto(saved, 0);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdatePensionSchemePayload,
  ): Promise<PensionSchemeDto> {
    const manager = this.dataSource.manager;
    const row = await this.load(manager, tenantId, id);
    Object.assign(row, input);
    // The schema only compares bounds that arrive together; check the merged result.
    if (
      row.minSalary != null &&
      row.maxSalary != null &&
      row.minSalary > row.maxSalary
    ) {
      throw new BadRequestException('Minimum salary cannot exceed the maximum');
    }
    const saved = await manager.getRepository(PensionScheme).save(row);
    return toDto(saved, await this.countAssigned(manager, tenantId, id, false));
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const manager = this.dataSource.manager;
    const row = await this.load(manager, tenantId, id);
    const assigned = await this.countAssigned(manager, tenantId, id, true);
    const inUse = (n: number) =>
      new ConflictException(
        `${row.name} is assigned to ${n} employees; deactivate it instead`,
      );
    if (assigned > 0) throw inUse(assigned);
    try {
      await manager.getRepository(PensionScheme).delete({ id, tenantId });
    } catch (e) {
      // An assignment landed between the count and the delete.
      if (
        e instanceof QueryFailedError &&
        (e.driverError as { code?: string })?.code === '23503'
      ) {
        throw inUse(1);
      }
      throw e;
    }
  }

  /** The employee's scheme when it is still active; null otherwise. */
  async activeSchemeFor(
    manager: EntityManager,
    tenantId: string,
    employee: Employee,
  ): Promise<PensionScheme | null> {
    if (!employee.pensionSchemeId) return null;
    const row = await manager
      .getRepository(PensionScheme)
      .findOne({ where: { id: employee.pensionSchemeId, tenantId } });
    return row?.isActive ? row : null;
  }

  ratesOf(s: PensionScheme): PensionRates {
    return {
      employeePct: s.employeePct,
      employerPct: s.employerPct,
      base: s.base,
      minSalary: s.minSalary,
      maxSalary: s.maxSalary,
    };
  }

  private async load(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<PensionScheme> {
    const row = await manager
      .getRepository(PensionScheme)
      .findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Pension scheme not found');
    return row;
  }

  private countAssigned(
    manager: EntityManager,
    tenantId: string,
    schemeId: string,
    withDeleted: boolean,
  ): Promise<number> {
    return manager
      .getRepository(Employee)
      .count({ where: { tenantId, pensionSchemeId: schemeId }, withDeleted });
  }
}
