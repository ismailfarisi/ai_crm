import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  openingGratuityPreviewSchema,
  openingLeavePreviewSchema,
  PERMISSIONS,
  postOpeningGratuitySchema,
  postOpeningLeaveSchema,
  type OpeningGratuityPreviewDto,
  type OpeningLeavePreviewDto,
  type PostOpeningGratuityPayload,
  type PostOpeningLeavePayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { GratuityService } from './gratuity.service';
import { LeaveService } from './leave.service';

@ApiTags('payroll')
@Controller('payroll')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollController {
  constructor(
    private readonly gratuity: GratuityService,
    private readonly leave: LeaveService,
  ) {}

  @Post('opening-gratuity/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Calculate opening gratuity balances at a cut-over date' })
  previewOpening(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(openingGratuityPreviewSchema)) body: { cutoverDate?: string },
  ): Promise<OpeningGratuityPreviewDto> {
    return this.gratuity.previewOpening(user.organizationId, body.cutoverDate);
  }

  @Post('opening-gratuity')
  @RequirePermissions(PERMISSIONS.PAYROLL_APPROVE)
  @ApiOperation({ summary: 'Post opening gratuity balances at go-live' })
  postOpening(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(postOpeningGratuitySchema)) body: PostOpeningGratuityPayload,
  ): Promise<{ journalEntryId: string | null; total: number }> {
    return this.gratuity.postOpening(user.organizationId, user.id, body);
  }

  @Post('opening-leave/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Calculate opening leave balances at a cut-over date' })
  previewOpeningLeave(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(openingLeavePreviewSchema)) body: { cutoverDate?: string },
  ): Promise<OpeningLeavePreviewDto> {
    return this.leave.previewOpening(user.organizationId, body.cutoverDate);
  }

  @Post('opening-leave')
  @RequirePermissions(PERMISSIONS.PAYROLL_APPROVE)
  @ApiOperation({ summary: 'Post opening leave balances at go-live' })
  postOpeningLeave(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(postOpeningLeaveSchema)) body: PostOpeningLeavePayload,
  ): Promise<{ journalEntryId: string | null; total: number }> {
    return this.leave.postOpening(user.organizationId, user.id, body, user.permissions);
  }
}
