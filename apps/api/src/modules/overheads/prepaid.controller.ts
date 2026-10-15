import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type PrepaidScheduleDto } from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { PrepaidService } from './prepaid.service';

@ApiTags('finance')
@Controller('finance/prepaid-schedules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PrepaidController {
  constructor(private readonly prepaid: PrepaidService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILL_READ)
  list(@CurrentUser() user: AuthenticatedUser, @Query('billId', new ParseUUIDPipe({ optional: true })) billId?: string): Promise<PrepaidScheduleDto[]> {
    return this.prepaid.list(user.organizationId, billId);
  }

  @Post(':id/end-early')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  endEarly(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<PrepaidScheduleDto> {
    return this.prepaid.endEarly(user.organizationId, id, user.id);
  }
}
