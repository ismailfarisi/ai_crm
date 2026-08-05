import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  PERMISSIONS,
  assignRolesSchema,
  assignTeamSchema,
  inviteUserSchema,
  type AssignRolesInput,
  type AssignTeamInput,
  type InviteUserInput,
  type UserDto,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { UsersService } from './users.service';

const setActiveSchema = z.object({ isActive: z.boolean() });
const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
});

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USER_READ)
  @ApiOperation({ summary: 'Everyone in the organization, with their roles' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<UserDto[]> {
    return this.users.listMembers(user.organizationId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update your own name' })
  updateOwnProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updateProfileSchema)) input: z.infer<typeof updateProfileSchema>,
  ): Promise<UserDto> {
    return this.users.updateProfile(user.organizationId, user.id, input);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USER_READ)
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserDto> {
    return this.users.getMember(user.organizationId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USER_CREATE)
  @ApiOperation({ summary: 'Add a team member with an initial password and roles' })
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(inviteUserSchema)) input: InviteUserInput,
  ): Promise<UserDto> {
    return this.users.inviteMember(user.organizationId, user.level, input);
  }

  @Patch(':id/roles')
  @RequirePermissions(PERMISSIONS.USER_ASSIGN_ROLE)
  @ApiOperation({ summary: "Replace a member's roles" })
  assignRoles(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(assignRolesSchema)) input: AssignRolesInput,
  ): Promise<UserDto> {
    return this.users.assignRoles(user.organizationId, user.id, user.level, id, input);
  }

  @Patch(':id/team')
  @RequirePermissions(PERMISSIONS.USER_UPDATE)
  @ApiOperation({ summary: 'Assign a member to a team, or remove them with null' })
  assignTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(assignTeamSchema)) input: AssignTeamInput,
  ): Promise<UserDto> {
    return this.users.assignTeam(user.organizationId, user.id, user.level, id, input.teamId);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USER_UPDATE)
  @ApiOperation({ summary: 'Activate or deactivate a member' })
  setActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(setActiveSchema)) input: z.infer<typeof setActiveSchema>,
  ): Promise<UserDto> {
    return this.users.setActive(user.organizationId, user.id, user.level, id, input.isActive);
  }
}
