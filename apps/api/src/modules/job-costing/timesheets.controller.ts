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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bulkTimesheetSchema,
  crewQuerySchema,
  PERMISSIONS,
  timesheetEntrySchema,
  timesheetQuerySchema,
  updateTimesheetEntrySchema,
  type BulkTimesheetPayload,
  type CrewQueryPayload,
  type TimesheetEmployeeDto,
  type TimesheetEntryDto,
  type TimesheetEntryPayload,
  type TimesheetOperationOptionDto,
  type TimesheetQueryPayload,
  type UpdateTimesheetEntryPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { TimesheetsService } from './timesheets.service';

/** Hours only: rates and amounts never leave through these routes. */
@ApiTags('timesheets')
@Controller('timesheets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TimesheetsController {
  constructor(private readonly timesheets: TimesheetsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TIMESHEET_READ)
  @ApiOperation({ summary: 'Timesheet entries between two dates' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(timesheetQuerySchema)) query: TimesheetQueryPayload,
  ): Promise<TimesheetEntryDto[]> {
    return this.timesheets.list(user.organizationId, query);
  }

  @Get('crew')
  @RequirePermissions(PERMISSIONS.TIMESHEET_READ)
  @ApiOperation({ summary: 'Every entry on a work order on one day' })
  crew(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(crewQuerySchema)) query: CrewQueryPayload,
  ): Promise<TimesheetEntryDto[]> {
    return this.timesheets.crew(user.organizationId, query);
  }

  @Get('employees')
  @RequirePermissions(PERMISSIONS.TIMESHEET_READ)
  @ApiOperation({ summary: 'Employees hours can be logged for' })
  employees(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TimesheetEmployeeDto[]> {
    return this.timesheets.employees(user.organizationId);
  }

  @Get('operations')
  @RequirePermissions(PERMISSIONS.TIMESHEET_READ)
  @ApiOperation({ summary: 'Job operations hours can be logged to' })
  operations(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TimesheetOperationOptionDto[]> {
    return this.timesheets.operations(user.organizationId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TIMESHEET_MANAGE)
  @ApiOperation({ summary: 'Log hours' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(timesheetEntrySchema)) body: TimesheetEntryPayload,
  ): Promise<TimesheetEntryDto> {
    return this.timesheets.create(user.organizationId, user.id, body);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.TIMESHEET_MANAGE)
  @ApiOperation({ summary: 'Save a grid or crew day in one go' })
  bulk(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(bulkTimesheetSchema)) body: BulkTimesheetPayload,
  ): Promise<TimesheetEntryDto[]> {
    return this.timesheets.bulk(user.organizationId, user.id, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TIMESHEET_MANAGE)
  @ApiOperation({ summary: "Change an entry's hours or note" })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateTimesheetEntrySchema))
    body: UpdateTimesheetEntryPayload,
  ): Promise<TimesheetEntryDto> {
    return this.timesheets.update(user.organizationId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.TIMESHEET_MANAGE)
  @ApiOperation({ summary: 'Delete an entry' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.timesheets.remove(user.organizationId, id);
  }
}
