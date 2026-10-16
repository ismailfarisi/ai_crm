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
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createPensionSchemeSchema,
  PERMISSIONS,
  payrollSettingsSchema,
  updatePensionSchemeSchema,
  type CreatePensionSchemePayload,
  type PayrollSettingsDto,
  type PayrollSettingsPayload,
  type PensionSchemeDto,
  type UpdatePensionSchemePayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { PayrollSettingsService } from './payroll-settings.service';
import { PensionService } from './pension.service';

@ApiTags('payroll')
@Controller('payroll')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollComplianceController {
  constructor(
    private readonly settings: PayrollSettingsService,
    private readonly pension: PensionService,
  ) {}

  @Get('settings')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'Payroll settings (WPS employer details, leave days)' })
  getSettings(@CurrentUser() user: AuthenticatedUser): Promise<PayrollSettingsDto> {
    return this.settings.get(user.organizationId);
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Save payroll settings' })
  putSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(payrollSettingsSchema)) body: PayrollSettingsPayload,
  ): Promise<PayrollSettingsDto> {
    return this.settings.put(user.organizationId, body);
  }

  @Get('pension-schemes')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'List pension schemes' })
  listSchemes(@CurrentUser() user: AuthenticatedUser): Promise<PensionSchemeDto[]> {
    return this.pension.list(user.organizationId);
  }

  @Post('pension-schemes')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Create a pension scheme' })
  createScheme(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createPensionSchemeSchema)) body: CreatePensionSchemePayload,
  ): Promise<PensionSchemeDto> {
    return this.pension.create(user.organizationId, body);
  }

  @Patch('pension-schemes/:id')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Update or activate a pension scheme' })
  updateScheme(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updatePensionSchemeSchema)) body: UpdatePensionSchemePayload,
  ): Promise<PensionSchemeDto> {
    return this.pension.update(user.organizationId, id, body);
  }

  @Delete('pension-schemes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Delete an unassigned pension scheme' })
  removeScheme(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.pension.remove(user.organizationId, id);
  }
}
