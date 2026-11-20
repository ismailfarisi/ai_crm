import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  linkCustomerSenderSchema,
  type CustomerSenderCheckDto,
  type CustomerSenderLinkDto,
  type LinkCustomerSenderPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { CustomerSenderService } from './services/customer-sender.service';

/**
 * Which customer a sender on a channel is, and the links staff make between
 * the two. A link lets a customer agent tell that sender about the customer's
 * orders and quotes, so making one needs the right to edit the customer.
 */
@ApiTags('channels')
@ApiBearerAuth()
@Controller('channels/customer-senders')
export class CustomerSendersController {
  constructor(private readonly senders: CustomerSenderService) {}

  @Get('check')
  @RequirePermissions(PERMISSIONS.CHANNEL_READ, PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({
    summary: 'Which customer, if any, an agent would treat a sender as',
  })
  check(
    @CurrentUser() user: AuthenticatedUser,
    @Query('provider') provider: string,
    @Query('identifier') identifier: string,
  ): Promise<CustomerSenderCheckDto> {
    return this.senders.check(
      user.organizationId,
      String(provider ?? ''),
      String(identifier ?? ''),
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({ summary: 'Senders staff have linked to a customer' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<CustomerSenderLinkDto[]> {
    const links = await this.senders.listForCustomer(
      user.organizationId,
      customerId,
    );
    return links.map((link) => this.senders.toDto(link));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_UPDATE)
  @ApiOperation({ summary: 'Confirm that a sender is a customer' })
  async link(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(linkCustomerSenderSchema)) body: LinkCustomerSenderPayload,
  ): Promise<CustomerSenderLinkDto> {
    return this.senders.toDto(
      await this.senders.link(user.organizationId, user.id, body),
    );
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_UPDATE)
  @ApiOperation({ summary: 'Remove a link between a sender and a customer' })
  async unlink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: true }> {
    await this.senders.unlink(user.organizationId, id);
    return { success: true };
  }
}
