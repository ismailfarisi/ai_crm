import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import type { PayrollSettingsDto, PayrollSettingsPayload } from '@saas/shared';
import { Employee } from './entities/employee.entity';
import { PayrollSettings } from './entities/payroll-settings.entity';

const DEFAULTS: PayrollSettingsDto = {
  wpsEnabled: false,
  employerIdType: null,
  employerId: null,
  payerRoutingCode: null,
  annualLeaveDays: 30,
};

const toDto = (s: PayrollSettings): PayrollSettingsDto => ({
  wpsEnabled: s.wpsEnabled,
  employerIdType: s.employerIdType,
  employerId: s.employerId,
  payerRoutingCode: s.payerRoutingCode,
  annualLeaveDays: s.annualLeaveDays,
});

/** A tenant's WPS employer details and annual leave entitlement (one row per tenant). */
@Injectable()
export class PayrollSettingsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async get(
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<PayrollSettingsDto> {
    const row = await manager
      .getRepository(PayrollSettings)
      .findOne({ where: { tenantId } });
    return row ? toDto(row) : { ...DEFAULTS };
  }

  async put(
    tenantId: string,
    input: PayrollSettingsPayload,
  ): Promise<PayrollSettingsDto> {
    await this.dataSource.manager.query(
      `INSERT INTO "payroll_settings"
         ("tenant_id", "wps_enabled", "employer_id_type", "employer_id", "payer_routing_code", "annual_leave_days", "updated_at")
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT ("tenant_id") DO UPDATE SET
         "wps_enabled" = EXCLUDED."wps_enabled",
         "employer_id_type" = EXCLUDED."employer_id_type",
         "employer_id" = EXCLUDED."employer_id",
         "payer_routing_code" = EXCLUDED."payer_routing_code",
         "annual_leave_days" = EXCLUDED."annual_leave_days",
         "updated_at" = now()`,
      [
        tenantId,
        input.wpsEnabled,
        input.employerIdType,
        input.employerId,
        input.payerRoutingCode,
        input.annualLeaveDays,
      ],
    );
    return this.get(tenantId);
  }

  /** Calendar leave days per year for an employee: their override, else the tenant's. */
  async annualDaysFor(
    manager: EntityManager,
    tenantId: string,
    employee: Employee,
  ): Promise<number> {
    if (employee.annualLeaveDaysOverride != null) {
      return employee.annualLeaveDaysOverride;
    }
    return (await this.get(tenantId, manager)).annualLeaveDays;
  }
}
