import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createPayrollRunSchema,
  PERMISSIONS,
  updatePayrollLineSchema,
  type CreatePayrollRunPayload,
  type PayrollRunDto,
  type PayslipDto,
  type UpdatePayrollLinePayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { PayrollRunsService } from './payroll-runs.service';

@ApiTags('payroll')
@Controller('payroll-runs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollRunsController {
  constructor(private readonly runs: PayrollRunsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'List payroll runs' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<PayrollRunDto[]> {
    return this.runs.list(user.organizationId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'Get a payroll run with its lines' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PayrollRunDto> {
    return this.runs.get(user.organizationId, id);
  }

  @Get(':id/lines/:lineId')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'Payslip for one line of a payroll run' })
  payslip(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ): Promise<PayslipDto> {
    return this.runs.payslip(user.organizationId, id, lineId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Create the payroll run for a month' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createPayrollRunSchema)) body: CreatePayrollRunPayload,
  ): Promise<PayrollRunDto> {
    return this.runs.create(user.organizationId, user.id, body);
  }

  @Patch(':id/lines/:lineId')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: "Edit a line's monthly extras" })
  updateLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body(zodBody(updatePayrollLineSchema)) body: UpdatePayrollLinePayload,
  ): Promise<PayrollRunDto> {
    return this.runs.updateLine(user.organizationId, id, lineId, body);
  }

  @Post(':id/refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Re-pull employees and packages into a draft run' })
  refresh(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PayrollRunDto> {
    return this.runs.refresh(user.organizationId, id);
  }
}
