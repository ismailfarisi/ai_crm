import {
  BadRequestException,
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
  remitPensionSchema,
  updatePensionSchemeSchema,
  type CreatePensionSchemePayload,
  type PayrollSettingsDto,
  type PayrollSettingsPayload,
  type PensionPeriodDto,
  type PensionRemittanceDto,
  type PensionSchemeDto,
  type RemitPensionPayload,
  type UpdatePensionSchemePayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { PayrollSettingsService } from './payroll-settings.service';
import type { PayrollActor } from './payroll-posting.service';
import { PensionRemittanceService } from './pension-remittance.service';
import { PensionService } from './pension.service';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
export const validPeriod =(period: string): string => {
  if (!PERIOD.test(period)) {
    throw new BadRequestException('Period must be YYYY-MM');
  }
  return period;
};

@ApiTags('payroll')
@Controller('payroll')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollComplianceController {
  constructor(
    private readonly settings: PayrollSettingsService,
    private readonly pension: PensionService,
    private readonly remittances: PensionRemittanceService,
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

  @Get('pension/:period')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'Pension due for a month and its remittance' })
  pensionPeriod(
    @CurrentUser() user: AuthenticatedUser,
    @Param('period') period: string,
  ): Promise<PensionPeriodDto> {
    return this.remittances.period(user.organizationId, validPeriod(period));
  }

  @Post('pension/:period/remit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PAYROLL_PAY)
  @ApiOperation({ summary: 'Remit a month of pension contributions to the fund' })
  remitPension(
    @CurrentUser() user: AuthenticatedUser,
    @Param('period') period: string,
    @Body(zodBody(remitPensionSchema)) body: RemitPensionPayload,
  ): Promise<PensionRemittanceDto> {
    return this.remittances.remit(
      user.organizationId,
      validPeriod(period),
      { userId: user.id, permissions: user.permissions },
      body,
    );
  }

  @Post('pension/:period/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PAYROLL_PAY)
  @ApiOperation({ summary: 'Void the live pension remittance for a month' })
  voidPension(
    @CurrentUser() user: AuthenticatedUser,
    @Param('period') period: string,
  ): Promise<PensionRemittanceDto> {
    return this.remittances.void(user.organizationId, validPeriod(period), {
      userId: user.id,
      permissions: user.permissions,
    });
  }
}
