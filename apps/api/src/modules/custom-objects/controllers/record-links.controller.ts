import { Controller, Delete, Get, Param, Post, Query, Body, UseGuards } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { JwtAuthGuard as AuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PERMISSIONS } from '@saas/shared';
import { CoreEntityBridgeService } from '../services/core-entity-bridge.service';

@Controller('objects/links')
@UseGuards(AuthGuard)
export class RecordLinksController {
  constructor(private readonly bridgeService: CoreEntityBridgeService) {}

  @Get('reverse')
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_READ)
  getReverseLinks(
    @CurrentUser() user: any,
    @Query('targetType') targetType: string,
    @Query('targetId') targetId: string,
  ) {
    return this.bridgeService.getReverseLinksForCoreEntity(user.organizationId, targetType, targetId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_UPDATE)
  createLink(@CurrentUser() user: any, @Body() body: any) {
    return this.bridgeService.link(user.organizationId, body);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_UPDATE)
  deleteLink(@CurrentUser() user: any, @Param('id') id: string) {
    return this.bridgeService.unlink(user.organizationId, id);
  }
}
