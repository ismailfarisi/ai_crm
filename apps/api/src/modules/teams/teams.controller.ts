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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  assignTeamSchema,
  createTeamSchema,
  updateTeamSchema,
  type AssignTeamInput,
  type CreateTeamInput,
  type TeamDto,
  type UpdateTeamInput,
  type UserDto,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { TeamsService } from './teams.service';

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USER_READ)
  @ApiOperation({ summary: 'All teams in the organization' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<TeamDto[]> {
    return this.teams.listTeams(user.organizationId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USER_READ)
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TeamDto> {
    return this.teams.getTeam(user.organizationId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USER_UPDATE)
  @ApiOperation({ summary: 'Create a team, optionally with a lead' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createTeamSchema)) input: CreateTeamInput,
  ): Promise<TeamDto> {
    return this.teams.createTeam(user.organizationId, user, input);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USER_UPDATE)
  @ApiOperation({ summary: 'Rename a team or change its lead' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateTeamSchema)) input: UpdateTeamInput,
  ): Promise<TeamDto> {
    return this.teams.updateTeam(user.organizationId, user, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.USER_UPDATE)
  @ApiOperation({ summary: 'Delete a team; members keep their accounts' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.teams.deleteTeam(user.organizationId, user, id);
  }

  @Patch(':id/members/:userId')
  @RequirePermissions(PERMISSIONS.USER_UPDATE)
  @ApiOperation({
    summary: 'Assign a member to a team (null teamId removes them)',
  })
  assignMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(zodBody(assignTeamSchema)) input: AssignTeamInput,
  ): Promise<UserDto> {
    return this.teams.setMemberTeam(
      user.organizationId,
      user,
      userId,
      input.teamId ?? null,
    );
  }
}
