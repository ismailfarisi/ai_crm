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
  PERMISSIONS,
  sendChannelMessageSchema,
  createAiAgentSchema,
  updateAiAgentSchema,
  upsertIntentAgentConfigSchema,
  type ChannelLinkCodeDto,
  type CreateAiAgentPayload,
  type SendChannelMessagePayload,
  type StaffChannelIdentityDto,
  type UpdateAiAgentPayload,
  type UpsertIntentAgentConfigPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { ChannelsService } from './channels.service';
import { ChannelCommandService } from './services/channel-command.service';
import { AiAgentService } from './services/ai-agent.service';
import { IntentAgentConfigService } from './services/intent-agent-config.service';
import { ChannelThreadService } from './services/channel-thread.service';
import { UsersService } from '@/modules/users/users.service';
import {
  testChannelAiSchema,
  type ChannelThreadDto,
  type TestChannelAiPayload,
} from '@saas/shared';
import { ChannelAiPreviewService } from './services/channel-ai-preview.service';
import { ChannelProviderType } from './entities/channel-config.entity';

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly channelCommandService: ChannelCommandService,
    private readonly aiAgentService: AiAgentService,
    private readonly intentAgentConfigService: IntentAgentConfigService,
    private readonly threads: ChannelThreadService,
    private readonly usersService: UsersService,
    private readonly aiPreview: ChannelAiPreviewService,
  ) {}

  @Get('configs')
  @RequirePermissions(PERMISSIONS.CHANNEL_READ)
  @ApiOperation({
    summary: 'Get all channel configurations for the organization',
  })
  getConfigs(@CurrentUser() user: AuthenticatedUser) {
    return this.channelsService.getConfigs(user.organizationId);
  }

  @Post('configs/:provider')
  @RequirePermissions(PERMISSIONS.CHANNEL_MANAGE)
  @ApiOperation({
    summary: 'Save or update channel configuration for a provider',
  })
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
  async sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(sendChannelMessageSchema)) body: SendChannelMessagePayload,
  ) {
    const sent = await this.channelsService.sendMessage(
      user.organizationId,
      user.id,
      { ...body, provider: body.provider as ChannelProviderType },
    );
    // Replying from the inbox takes the conversation: the AI stays quiet
    // until it is returned.
    if (body.contactId) {
      await this.threads.takeOverByContact(
        user.organizationId,
        body.provider,
        body.contactId,
        user.id,
      );
    }
    return sent;
  }

  @Get('threads')
  @RequirePermissions(PERMISSIONS.CHANNEL_READ)
  @ApiOperation({
    summary: 'List conversations with who is answering each: the AI or a person',
  })
  async listThreads(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChannelThreadDto[]> {
    const threads = await this.threads.list(user.organizationId);
    const members = threads.some((thread) => thread.assigneeUserId)
      ? await this.usersService.listMembers(user.organizationId)
      : [];
    const names = new Map(members.map((m) => [m.id, m.fullName]));
    return threads.map((thread) => ({
      id: thread.id,
      provider: thread.provider,
      contactId: thread.contactId,
      state: thread.state,
      assigneeUserId: thread.assigneeUserId,
      assigneeName: thread.assigneeUserId
        ? (names.get(thread.assigneeUserId) ?? null)
        : null,
      handoverReason: thread.handoverReason,
      handoverSummary: thread.handoverSummary,
      handedOverAt: thread.handedOverAt?.toISOString() ?? null,
      updatedAt: thread.updatedAt.toISOString(),
    }));
  }

  @Post('threads/:id/take-over')
  @RequirePermissions(PERMISSIONS.CHANNEL_SEND)
  @ApiOperation({ summary: 'Take a conversation over from the AI' })
  takeOverThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.threads.takeOver(user.organizationId, id, user.id);
  }

  @Post('threads/:id/return-to-ai')
  @RequirePermissions(PERMISSIONS.CHANNEL_SEND)
  @ApiOperation({ summary: 'Give a conversation back to the AI' })
  returnThreadToAi(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.threads.returnToAi(user.organizationId, id);
  }

  @Post('threads/:id/resolve')
  @RequirePermissions(PERMISSIONS.CHANNEL_SEND)
  @ApiOperation({ summary: 'Mark a conversation resolved' })
  resolveThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.threads.resolve(user.organizationId, id);
  }

  @Post('identities/link-code')
  @ApiOperation({
    summary: 'Generate a channel-linking code',
    description:
      'Generates a short-lived code — send it as a message on any connected channel to link that identity for quote-approval commands',
  })
  async createLinkCode(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChannelLinkCodeDto> {
    const { code, expiresAt } = await this.channelCommandService.createLinkCode(
      user.organizationId,
      user.id,
    );
    return { code, expiresAt: expiresAt.toISOString() };
  }

  @Get('identities')
  @ApiOperation({ summary: "List the caller's linked channel identities" })
  async listIdentities(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StaffChannelIdentityDto[]> {
    const identities = await this.channelCommandService.listIdentities(
      user.organizationId,
      user.id,
    );
    return identities.map((identity) => ({
      id: identity.id,
      provider: identity.provider,
      identifierPreview: maskIdentifier(identity.identifier),
      createdAt: identity.createdAt.toISOString(),
    }));
  }

  @Delete('identities/:id')
  @ApiOperation({
    summary: "Unlink one of the caller's own channel identities",
  })
  async revokeIdentity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    await this.channelCommandService.revokeIdentity(
      user.organizationId,
      user.id,
      id,
    );
    return { success: true };
  }
  @Get('ai-agents')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({
    summary:
      "List the organization's AI agents (intent -> action dispatch rules)",
  })
  listAiAgents(@CurrentUser() user: AuthenticatedUser) {
    return this.aiAgentService.findAll(user.organizationId);
  }

  @Get('ai-agents/:id')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({ summary: 'Get one AI agent' })
  getAiAgent(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.aiAgentService.findOne(user.organizationId, id);
  }

  @Post('ai-agents')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({ summary: 'Create an AI agent' })
  createAiAgent(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createAiAgentSchema)) body: CreateAiAgentPayload,
  ) {
    return this.aiAgentService.create(user.organizationId, body);
  }

  @Patch('ai-agents/:id')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({ summary: 'Update an AI agent' })
  updateAiAgent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(updateAiAgentSchema)) body: UpdateAiAgentPayload,
  ) {
    return this.aiAgentService.update(user.organizationId, id, body);
  }

  @Delete('ai-agents/:id')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({ summary: 'Delete an AI agent' })
  async deleteAiAgent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    await this.aiAgentService.remove(user.organizationId, id);
    return { success: true };
  }

  @Get('intent-agent')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({
    summary: "Get the org's intent-clarifying agent configuration",
  })
  getIntentAgentConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.intentAgentConfigService.getEffective(user.organizationId);
  }

  @Post('intent-agent/test')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({
    summary:
      'Work out what the AI would do with a customer message, without sending or saving anything',
  })
  testIntentAgent(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(testChannelAiSchema)) body: TestChannelAiPayload,
  ) {
    return this.aiPreview.preview(user.organizationId, body);
  }

  @Patch('intent-agent')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({
    summary: "Update the org's intent-clarifying agent configuration",
  })
  updateIntentAgentConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(upsertIntentAgentConfigSchema))
    body: UpsertIntentAgentConfigPayload,
  ) {
    return this.intentAgentConfigService.upsert(user.organizationId, body);
  }
}

function maskIdentifier(identifier: string): string {
  if (identifier.length <= 4) return '••••';
  return `${identifier.slice(0, 2)}••••${identifier.slice(-2)}`;
}
