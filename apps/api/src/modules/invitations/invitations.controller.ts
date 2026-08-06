import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  inviteUserSchema,
  type InvitationDto,
  type InviteUserInput,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.USER_CREATE)
  @ApiOperation({
    summary: 'Invite someone by email; they set their own password',
  })
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(inviteUserSchema)) input: InviteUserInput,
  ): Promise<InvitationDto> {
    return this.invitations.createInvitation(
      user.organizationId,
      {
        id: user.id,
        level: user.level,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      input,
    );
  }

  @Post(':id/resend')
  @RequirePermissions(PERMISSIONS.USER_CREATE)
  @ApiOperation({ summary: 'Re-send a pending invite with a fresh token' })
  resend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvitationDto> {
    return this.invitations.resendInvitation(
      user.organizationId,
      id,
      `${user.firstName} ${user.lastName}`.trim(),
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.USER_READ)
  @ApiOperation({ summary: 'Pending invitations in the organization' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<InvitationDto[]> {
    return this.invitations.listPending(user.organizationId);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.USER_UPDATE)
  @ApiOperation({ summary: 'Cancel a pending invitation' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: true }> {
    await this.invitations.cancelInvitation(user.organizationId, id);
    return { success: true };
  }
}
