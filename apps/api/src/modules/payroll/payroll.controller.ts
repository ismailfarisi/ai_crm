import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  openingGratuityPreviewSchema,
  PERMISSIONS,
  postOpeningGratuitySchema,
  type OpeningGratuityPreviewDto,
  type PostOpeningGratuityPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { GratuityService } from './gratuity.service';

@ApiTags('payroll')
@Controller('payroll')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollController {
  constructor(private readonly gratuity: GratuityService) {}

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
}
