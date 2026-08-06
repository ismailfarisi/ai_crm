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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  contactQuerySchema,
  createContactSchema,
  updateContactSchema,
  type ContactDto,
  type ContactStatsDto,
  type CreateContactInput,
  type PaginatedResult,
  type UpdateContactInput,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { ContactsService } from './contacts.service';
import type { ContactQueryDto } from './dto/contact-query.dto';

@ApiTags('contacts')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CONTACT_READ)
  @ApiOperation({
    summary: 'List contacts',
    description:
      'Returns only contacts the caller owns, unless they also hold contact:read_all.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(contactQuerySchema)) query: ContactQueryDto,
  ): Promise<PaginatedResult<ContactDto>> {
    return this.contacts.list(user, query);
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.CONTACT_READ)
  @ApiOperation({
    summary: 'Counts for the dashboard, scoped the same way as the list',
  })
  stats(@CurrentUser() user: AuthenticatedUser): Promise<ContactStatsDto> {
    return this.contacts.stats(user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CONTACT_READ)
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContactDto> {
    return this.contacts.findOne(user, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CONTACT_CREATE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createContactSchema)) input: CreateContactInput,
  ): Promise<ContactDto> {
    return this.contacts.create(user, input);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CONTACT_UPDATE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateContactSchema)) input: UpdateContactInput,
  ): Promise<ContactDto> {
    return this.contacts.update(user, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.CONTACT_DELETE)
  @ApiOperation({ summary: 'Soft-delete a contact' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.contacts.remove(user, id);
  }
}
