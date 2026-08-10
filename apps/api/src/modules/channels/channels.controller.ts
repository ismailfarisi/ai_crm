import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  sendChannelMessageSchema,
  type SendChannelMessagePayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { ChannelsService } from './channels.service';
import { ChannelProviderType } from './entities/channel-config.entity';

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get('configs')
  @RequirePermissions(PERMISSIONS.CHANNEL_READ)
  @ApiOperation({ summary: 'Get all channel configurations for the organization' })
  getConfigs(@CurrentUser() user: AuthenticatedUser) {
    return this.channelsService.getConfigs(user.organizationId);
  }

  @Post('configs/:provider')
  @RequirePermissions(PERMISSIONS.CHANNEL_MANAGE)
  @ApiOperation({ summary: 'Save or update channel configuration for a provider' })
  saveConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: ChannelProviderType,
    @Body() body: { isEnabled?: boolean; credentials?: Record<string, any> },
  ) {
    return this.channelsService.saveConfig(
      user.organizationId,
      provider,
      body.isEnabled ?? true,
      body.credentials,
    );
  }

  @Post('configs/:provider/test')
  @RequirePermissions(PERMISSIONS.CHANNEL_MANAGE)
  @ApiOperation({ summary: 'Test connection for a channel provider' })
  testConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: ChannelProviderType,
  ) {
    return this.channelsService.testConnection(user.organizationId, provider);
  }

  @Get('messages')
  @RequirePermissions(PERMISSIONS.CHANNEL_READ)
  @ApiOperation({ summary: 'Get channel message history' })
  getMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Query('contactId') contactId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.channelsService.getMessages(user.organizationId, {
      contactId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('send')
  @RequirePermissions(PERMISSIONS.CHANNEL_SEND)
  @ApiOperation({ summary: 'Send an outbound channel message' })
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(sendChannelMessageSchema)) body: SendChannelMessagePayload,
  ) {
    return this.channelsService.sendMessage(
      user.organizationId,
      user.id,
      {
        ...body,
        provider: body.provider as ChannelProviderType,
      },
    );
  }
}
