import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, branchSchema, type BranchPayload } from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { BranchesService } from './branches.service';

@ApiTags('branches')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORG_READ)
  @ApiOperation({ summary: 'List branches, head office first' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.branches.list(user.organizationId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ORG_UPDATE)
  @ApiOperation({ summary: 'Add a branch' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(branchSchema)) body: BranchPayload,
  ) {
    return this.branches.create(user.organizationId, body);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.ORG_UPDATE)
  @ApiOperation({
    summary: 'Update a branch. Branches are deactivated, never deleted.',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(branchSchema)) body: BranchPayload,
  ) {
    return this.branches.update(user.organizationId, id, body);
  }
}
