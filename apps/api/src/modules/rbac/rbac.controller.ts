import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_GROUPS,
  createRoleSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type RoleDto,
  type UpdateRoleInput,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { RbacService } from './rbac.service';

@ApiTags('rbac')
@Controller()
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLE_READ)
  @ApiOperation({ summary: 'The permission catalog, grouped for the role editor' })
  listPermissions() {
    return {
      permissions: ALL_PERMISSIONS.map((key) => ({
        key,
        description: PERMISSION_DESCRIPTIONS[key],
      })),
      groups: PERMISSION_GROUPS,
    };
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLE_READ)
  @ApiOperation({ summary: 'Every role in the organization' })
  listRoles(@CurrentUser() user: AuthenticatedUser): Promise<RoleDto[]> {
    return this.rbac.listRoles(user.organizationId);
  }

  @Get('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLE_READ)
  getRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoleDto> {
    return this.rbac.getRole(user.organizationId, id);
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.ROLE_CREATE)
  @ApiOperation({ summary: 'Create a custom role' })
  createRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createRoleSchema)) input: CreateRoleInput,
  ): Promise<RoleDto> {
    return this.rbac.createRole(user.organizationId, user, input);
  }

  @Patch('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLE_UPDATE)
  @ApiOperation({ summary: "Rename a role or change its permissions" })
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateRoleSchema)) input: UpdateRoleInput,
  ): Promise<RoleDto> {
    return this.rbac.updateRole(user.organizationId, user, id, input);
  }

  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.ROLE_DELETE)
  async deleteRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.rbac.deleteRole(user.organizationId, user, id);
  }
}
