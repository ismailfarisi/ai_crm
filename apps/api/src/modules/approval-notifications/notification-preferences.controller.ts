import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  orgNotificationPreferencesSchema,
  userNotificationPreferencesSchema,
  type NotificationPreferencesView,
  type OrgNotificationPreferencesPayload,
  type UserNotificationPreferencesPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { NotificationPreferencesService } from './notification-preferences.service';

/** Your own notification choices need no permission; the organisation default does. */
@ApiTags('notifications')
@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly prefs: NotificationPreferencesService) {}

  @Get('me')
  @ApiOperation({ summary: 'My notification preferences' })
  get(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationPreferencesView> {
    return this.prefs.view(user.organizationId, user.id, user.permissions);
  }

  @Put('me')
  @ApiOperation({ summary: 'Save my notification preferences' })
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(userNotificationPreferencesSchema))
    body: UserNotificationPreferencesPayload,
  ): Promise<NotificationPreferencesView> {
    return this.prefs.saveOwn(
      user.organizationId,
      user.id,
      body,
      user.permissions,
    );
  }

  @Delete('me')
  @ApiOperation({ summary: 'Follow the organisation default again' })
  reset(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationPreferencesView> {
    return this.prefs.resetOwn(user.organizationId, user.id, user.permissions);
  }

  @Put('organization')
  @RequirePermissions(PERMISSIONS.ORG_UPDATE)
  @ApiOperation({ summary: 'Save the organisation default' })
  saveOrg(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(orgNotificationPreferencesSchema))
    body: OrgNotificationPreferencesPayload,
  ): Promise<NotificationPreferencesView> {
    return this.prefs.saveOrgDefault(
      user.organizationId,
      user.id,
      body,
      user.permissions,
    );
  }
}
