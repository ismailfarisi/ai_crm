import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Body,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PERMISSIONS,
  connectImapAccountSchema,
  sendEmailSchema,
  updateEmailAccountSchema,
  updateEmailThreadSchema,
  emailThreadQuerySchema,
  type ConnectImapAccountPayload,
  type SendEmailPayload,
  type UpdateEmailAccountPayload,
  type UpdateEmailThreadPayload,
  type EmailThreadQuery,
} from '@saas/shared';
import {
  CurrentUser,
  Public,
  RequireAnyPermission,
  RequirePermissions,
} from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { EmailService } from './email.service';

@ApiTags('email')
@Controller('email')
export class EmailController {
  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /* --------------------------------------------------- OAuth connect flow */

  @Get('oauth/google/start')
  @RequireAnyPermission(
    PERMISSIONS.EMAIL_READ,
    PERMISSIONS.EMAIL_SEND,
    PERMISSIONS.EMAIL_MANAGE,
  )
  @ApiOperation({ summary: 'Build the Google consent URL for this user' })
  googleStart(@CurrentUser() user: AuthenticatedUser) {
    return this.email.googleAuthUrl(user);
  }

  /**
   * Google redirects the browser here. Public by design — the HMAC-signed
   * `state` carries the user/org identity, so the session cookie being
   * absent (e.g. SameSite=Strict) cannot break the flow.
   */
  @Public()
  @Get('oauth/google/callback')
  @ApiOperation({ summary: 'Google OAuth redirect target' })
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const base = `${this.config.get<string>('publicWebUrl')}/settings/email`;
    if (error || !code || !state) {
      res.redirect(
        `${base}?gmail=error&reason=${encodeURIComponent(error ?? 'missing_code')}`,
      );
      return;
    }
    try {
      const { emailAddress } = await this.email.completeGoogleConnect(
        state,
        code,
      );
      res.redirect(
        `${base}?gmail=connected&address=${encodeURIComponent(emailAddress)}`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'connect_failed';
      res.redirect(`${base}?gmail=error&reason=${encodeURIComponent(reason)}`);
    }
  }

  /* ------------------------------------------------------------- accounts */

  /**
   * App-password connect — works for any Workspace domain or Gmail account,
   * unlike the OAuth flow which Google limits to our own organisation.
   */
  @Post('accounts/imap')
  @RequirePermissions(PERMISSIONS.EMAIL_SEND)
  @ApiOperation({ summary: 'Connect a Gmail mailbox with an app password' })
  connectImap(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(connectImapAccountSchema)) body: ConnectImapAccountPayload,
  ) {
    return this.email.connectImap(user, body);
  }

  @Get('accounts')
  @RequirePermissions(PERMISSIONS.EMAIL_READ)
  @ApiOperation({ summary: 'Accounts the caller can read (own + shared)' })
  listAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.email.listAccounts(user);
  }

  @Patch('accounts/:id')
  @RequirePermissions(PERMISSIONS.EMAIL_READ)
  updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(updateEmailAccountSchema)) body: UpdateEmailAccountPayload,
  ) {
    return this.email.setShared(user, id, body.isShared);
  }

  @Post('accounts/:id/sync')
  @RequirePermissions(PERMISSIONS.EMAIL_READ)
  syncNow(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.email.syncNow(user, id);
  }

  @Delete('accounts/:id')
  @RequirePermissions(PERMISSIONS.EMAIL_READ)
  disconnect(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.email.disconnect(user, id);
  }

  /* -------------------------------------------------------------- threads */

  @Get('threads')
  @RequirePermissions(PERMISSIONS.EMAIL_READ)
  listThreads(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(emailThreadQuerySchema)) query: EmailThreadQuery,
  ) {
    return this.email.listThreads(user, query);
  }

  @Get('threads/:id')
  @RequirePermissions(PERMISSIONS.EMAIL_READ)
  getThread(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.email.getThread(user, id);
  }

  @Patch('threads/:id')
  @RequirePermissions(PERMISSIONS.EMAIL_READ)
  updateThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(updateEmailThreadSchema)) body: UpdateEmailThreadPayload,
  ) {
    return this.email.updateThread(user, id, body);
  }

  /* ------------------------------------------------------------- messages */

  @Post('messages/send')
  @RequirePermissions(PERMISSIONS.EMAIL_SEND)
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(sendEmailSchema)) body: SendEmailPayload,
  ) {
    return this.email.send(user, body);
  }

  @Get('messages/:messageId/attachments/:attachmentId')
  @RequirePermissions(PERMISSIONS.EMAIL_READ)
  async downloadAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const file = await this.email.downloadAttachment(
      user,
      messageId,
      attachmentId,
    );
    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.filename)}"`,
      'Content-Length': String(file.data.length),
    });
    res.send(file.data);
  }
}
