import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createSavedViewSchema,
  updateSavedViewSchema,
  type CreateSavedViewPayload,
  type UpdateSavedViewPayload,
} from '@saas/shared';
import { CurrentUser } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { SavedViewsService } from './saved-views.service';

@ApiTags('saved-views')
@Controller('saved-views')
export class SavedViewsController {
  constructor(private readonly service: SavedViewsService) {}

  @Get()
  @ApiOperation({
    summary: 'List saved views',
    description: 'Lists saved views accessible to the user for the given entity type',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('entityType') entityType: string,
  ) {
    const userId = (user as any).userId ?? user.id;
    return this.service.findAccessible(user.organizationId, userId, entityType);
  }

  @Post()
  @ApiOperation({
    summary: 'Create saved view',
    description: 'Creates a new private or shared view for the user',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createSavedViewSchema)) body: CreateSavedViewPayload,
  ) {
    const userId = (user as any).userId ?? user.id;
    return this.service.create(user.organizationId, userId, body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update saved view',
    description: 'Updates an existing saved view if owned or by admin',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(updateSavedViewSchema)) body: UpdateSavedViewPayload,
  ) {
    const userId = (user as any).userId ?? user.id;
    const isAdmin = Boolean(
      user.roles?.includes('admin') ||
      user.roles?.includes('owner') ||
      (user as any).isOwner,
    );
    return this.service.update(user.organizationId, userId, id, body, isAdmin);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete saved view',
    description: 'Soft-deletes a saved view if owned or by admin',
  })
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const userId = (user as any).userId ?? user.id;
    const isAdmin = Boolean(
      user.roles?.includes('admin') ||
      user.roles?.includes('owner') ||
      (user as any).isOwner,
    );
    return this.service.delete(user.organizationId, userId, id, isAdmin);
  }
}
