import { Controller, Delete, Get, Param, Post, Query, Body, UseGuards } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { JwtAuthGuard as AuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import {
  PERMISSIONS,
  createCustomRecordLinkSchema,
  type CreateCustomRecordLinkPayload,
} from '@saas/shared';
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
    return this.bridgeService.getReverseLinksForCoreEntity(
      user.organizationId,
      targetType,
      targetId,
      user,
    );
  }

  /** Linking changes the source record, so it needs update rights on it. */
  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_UPDATE)
  createLink(
    @CurrentUser() user: any,
    @Body(zodBody(createCustomRecordLinkSchema)) body: CreateCustomRecordLinkPayload,
  ) {
    return this.bridgeService.link(user.organizationId, body, user);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_UPDATE)
  deleteLink(@CurrentUser() user: any, @Param('id') id: string) {
    return this.bridgeService.unlink(user.organizationId, id, user);
  }
}
