import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Query,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators';
import { ChannelsService } from './channels.service';
import { ChannelProviderType } from './entities/channel-config.entity';

@ApiTags('channels-webhooks')
@Public()
@Controller('webhooks/channels')
export class ChannelsWebhookController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get('whatsapp/:orgId')
  @ApiOperation({ summary: 'Meta WhatsApp Webhook Verification Challenge' })
  verifyMetaWebhook(
    @Param('orgId') orgId: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.channelsService.verifyMetaChallenge(
      orgId,
      mode,
      verifyToken,
      challenge,
    );
  }

  @Post(':provider/:orgId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Handle inbound public channel webhook' })
  handleInboundWebhook(
    @Param('provider') provider: ChannelProviderType,
    @Param('orgId') orgId: string,
    @Headers() headers: any,
    @Body() body: any,
  ) {
    return this.channelsService.processInboundWebhook(
      orgId,
      provider,
      headers,
      body,
    );
  }
}
