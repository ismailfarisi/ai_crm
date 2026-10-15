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
  PERMISSIONS,
  updateEmployeeSchema,
  type CreateEmployeePayload,
  type CreateSalaryPackagePayload,
  type EmployeeDto,
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
import { maskEmployee } from './employee-mask';

@ApiTags('employees')
@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EMPLOYEE_READ)
  @ApiOperation({ summary: 'List employees' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: EmployeeStatus,
    @Query('search') search?: string,
  ): Promise<EmployeeDto[]> {
    const rows = await this.employees.list(user.organizationId, {
      status,
      search,
    });
    return rows.map((r) => maskEmployee(r, user.permissions));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_READ)
  @ApiOperation({ summary: 'Get an employee' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmployeeDto> {
    const view = await this.employees.get(user.organizationId, id);
    return maskEmployee(view, user.permissions);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EMPLOYEE_MANAGE)
  @ApiOperation({ summary: 'Create an employee' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createEmployeeSchema)) body: CreateEmployeePayload,
  ): Promise<EmployeeDto> {
    const view = await this.employees.create(user.organizationId, user.id, body);
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
    const view = await this.employees.update(user.organizationId, id, body);
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
}
