// assistant.controller.ts
import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  PERMISSIONS,
  assistantApprovalSchema,
  createAssistantConversationSchema,
  sendAssistantMessageSchema,
  updateAssistantConversationSchema,
  type AssistantApprovalPayload,
  type CreateAssistantConversationPayload,
  type SendAssistantMessagePayload,
  type UpdateAssistantConversationPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { AssistantService } from './assistant.service';
import { AssistantStreamHub } from './assistant-stream.hub';

const HEARTBEAT_MS = 15_000;
const POLL_MS = 5_000;

@ApiTags('assistant')
@Controller('assistant')
@RequirePermissions(PERMISSIONS.ASSISTANT_USE)
export class AssistantController {
  constructor(
    private readonly service: AssistantService,
    private readonly hub: AssistantStreamHub,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: "List the current user's assistant conversations" })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Post('conversations')
  create(@CurrentUser() user: AuthenticatedUser, @Body(zodBody(createAssistantConversationSchema)) body: CreateAssistantConversationPayload) {
    return this.service.create(user, body);
  }

  @Get('conversations/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, id);
  }

  @Patch('conversations/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateAssistantConversationSchema)) body: UpdateAssistantConversationPayload,
  ) {
    return this.service.update(user, id, body);
  }

  @Post('conversations/:id/messages')
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(sendAssistantMessageSchema)) body: SendAssistantMessagePayload,
  ) {
    return this.service.sendMessage(user, id, body);
  }

  @Post('turns/:id/approval')
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(assistantApprovalSchema)) body: AssistantApprovalPayload,
  ) {
    return this.service.decide(user, id, body);
  }

  @Post('turns/:id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancel(user, id);
  }

  @Get('conversations/:id/stream')
  @ApiOperation({ summary: 'Server-sent events: every new transcript row, in seq order' })
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Ownership check up front so a foreign id 404s before the stream opens.
    let lastSeq = Number(lastEventId ?? 0) || 0;
    const initial = await this.service.messagesAfter(user, id, lastSeq);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    let draining = Promise.resolve();
    const write = (rows: typeof initial) => {
      for (const row of rows) {
        if (row.seq <= lastSeq) continue; // two nudges can race; never send a row twice
        lastSeq = row.seq;
        res.write(`id: ${row.seq}\nevent: message\ndata: ${JSON.stringify(row)}\n\n`);
      }
    };
    // Serialise fetches so rows go out in seq order (Review Focus #1, #3).
    const pull = () => {
      draining = draining.then(async () => {
        if (closed) return;
        const rows = await this.tenantContext.runWithTenant(user.organizationId, () =>
          this.service.messagesAfter(user, id, lastSeq),
        );
        if (!closed) write(rows);
      }).catch(() => undefined);
    };

    write(initial);
    const off = this.hub.listen(id, pull);
    const poll = setInterval(pull, POLL_MS);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      closed = true;
      off();
      clearInterval(poll);
      clearInterval(heartbeat);
    });
  }
}
