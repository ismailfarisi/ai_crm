import {
  Body,
  Controller,
  Delete,
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
  leaveRecordSchema,
  PERMISSIONS,
  type EmployeeLeaveDto,
  type LeaveRecordDto,
  type LeaveRecordPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { LeaveService } from './leave.service';
import { LeaveRecordsService } from './leave-records.service';

@ApiTags('employees')
@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly records: LeaveRecordsService,
  ) {}

  @Get(':id/leave')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_READ)
  @ApiOperation({ summary: "An employee's leave balance, records and ledger" })
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmployeeLeaveDto> {
    // Days are employee data; the provision behind them is pay data.
    const canSeePay = user.permissions.includes(PERMISSIONS.PAYROLL_READ);
    return this.leave.summary(user.organizationId, id, canSeePay);
  }

  @Post(':id/leave-records')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_MANAGE)
  @ApiOperation({ summary: 'Record leave for an employee' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(leaveRecordSchema)) body: LeaveRecordPayload,
  ): Promise<LeaveRecordDto> {
    return this.records.create(user.organizationId, id, user.id, body);
  }

  @Patch(':id/leave-records/:recordId')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_MANAGE)
  @ApiOperation({ summary: 'Change a leave record' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body(zodBody(leaveRecordSchema)) body: LeaveRecordPayload,
  ): Promise<LeaveRecordDto> {
    return this.records.update(user.organizationId, id, recordId, body);
  }

  @Delete(':id/leave-records/:recordId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.EMPLOYEE_MANAGE)
  @ApiOperation({ summary: 'Delete a leave record' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ): Promise<void> {
    return this.records.remove(user.organizationId, id, recordId);
  }
}
