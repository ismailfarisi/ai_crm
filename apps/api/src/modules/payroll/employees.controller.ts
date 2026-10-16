import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createEmployeeSchema,
  createSalaryPackageSchema,
  gratuityAdjustmentSchema,
  PERMISSIONS,
  recordAdvanceSchema,
  updateEmployeeSchema,
  type CreateEmployeePayload,
  type CreateSalaryPackagePayload,
  type EmployeeAdvanceDto,
  type EmployeeAdvancesDto,
  type EmployeeDto,
  type EmployeeGratuityDto,
  type GratuityAdjustmentPayload,
  type GratuityLedgerEntryDto,
  type RecordAdvancePayload,
  type EmployeeStatus,
  type SalaryPackageDto,
  type UpdateEmployeePayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { EmployeesService } from './employees.service';
import { AdvancesService } from './advances.service';
import { GratuityService } from './gratuity.service';
import { maskEmployee } from './employee-mask';

/** Only employee managers ever see a full IBAN, so only they pay to decrypt one. */
const ibanOpts = (user: AuthenticatedUser) => ({
  withIban: user.permissions.includes(PERMISSIONS.EMPLOYEE_MANAGE),
});

@ApiTags('employees')
@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly advances: AdvancesService,
    private readonly gratuity: GratuityService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EMPLOYEE_READ)
  @ApiOperation({ summary: 'List employees' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: EmployeeStatus,
    @Query('search') search?: string,
  ): Promise<EmployeeDto[]> {
    const rows = await this.employees.list(
      user.organizationId,
      { status, search },
      ibanOpts(user),
    );
    return rows.map((r) => maskEmployee(r, user.permissions));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_READ)
  @ApiOperation({ summary: 'Get an employee' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmployeeDto> {
    const view = await this.employees.get(user.organizationId, id, ibanOpts(user));
    return maskEmployee(view, user.permissions);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EMPLOYEE_MANAGE)
  @ApiOperation({ summary: 'Create an employee' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createEmployeeSchema)) body: CreateEmployeePayload,
  ): Promise<EmployeeDto> {
    const view = await this.employees.create(
      user.organizationId,
      user.id,
      body,
      ibanOpts(user),
    );
    return maskEmployee(view, user.permissions);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_MANAGE)
  @ApiOperation({ summary: 'Update an employee' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateEmployeeSchema)) body: UpdateEmployeePayload,
  ): Promise<EmployeeDto> {
    const view = await this.employees.update(
      user.organizationId,
      id,
      body,
      ibanOpts(user),
    );
    return maskEmployee(view, user.permissions);
  }

  @Get(':id/salary-packages')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'Salary package history, newest first' })
  listPackages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SalaryPackageDto[]> {
    return this.employees.listPackages(user.organizationId, id);
  }

  @Post(':id/salary-packages')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Add a salary package (a raise is a new row)' })
  addPackage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createSalaryPackageSchema)) body: CreateSalaryPackagePayload,
  ): Promise<SalaryPackageDto> {
    return this.employees.addPackage(user.organizationId, id, user.id, body);
  }

  @Get(':id/advances')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'Salary advances with recovered and outstanding totals' })
  listAdvances(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmployeeAdvancesDto> {
    return this.advances.list(user.organizationId, id);
  }

  @Post(':id/advances')
  @RequirePermissions(PERMISSIONS.PAYROLL_PAY)
  @ApiOperation({ summary: 'Pay a salary advance from a finance account' })
  recordAdvance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(recordAdvanceSchema)) body: RecordAdvancePayload,
  ): Promise<EmployeeAdvanceDto> {
    return this.advances.record(user.organizationId, id, user.id, body);
  }

  @Get(':id/gratuity')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'End-of-service provision balance, entitlement today and ledger' })
  gratuitySummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmployeeGratuityDto> {
    return this.gratuity.summary(user.organizationId, id);
  }

  @Post(':id/gratuity-adjustments')
  @RequirePermissions(PERMISSIONS.PAYROLL_APPROVE)
  @ApiOperation({ summary: 'Correct the end-of-service provision' })
  adjustGratuity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(gratuityAdjustmentSchema)) body: GratuityAdjustmentPayload,
  ): Promise<GratuityLedgerEntryDto> {
    return this.gratuity.adjust(user.organizationId, id, user.id, body);
  }
}
