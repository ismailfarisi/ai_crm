import {
  Controller,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '@/common/decorators';
import { AutomationWebhookService } from './automation-webhook.service';

/**
 * The public address of a WEBHOOK automation. No sign-in: the token in the
 * path is the credential. The body arrives unparsed (see `webhook-http.ts`),
 * so the service can verify a signature over the exact bytes and accept JSON
 * of any shape.
 */
@ApiTags('public')
@Controller('automations/webhook')
export class AutomationWebhookController {
  constructor(private readonly webhooks: AutomationWebhookService) {}

  @Public()
  @Post(':token')
  @ApiOperation({
    summary: 'Start an automation run from its webhook address',
    description:
      'Accepts application/json (202 {"accepted":true}) or a form post (303 to the configured page, or 202 text). ' +
      'Optional headers: Idempotency-Key, X-Kerf-Signature: sha256=<hex HMAC-SHA256 of the body>.',
  })
  async receive(
    @Param('token') token: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    const outcome = await this.webhooks.receive(token, {
      contentType: req.get('content-type') ?? '',
      rawBody: req.rawBody ?? Buffer.alloc(0),
      signature: req.get('x-kerf-signature'),
      idempotencyKey: req.get('idempotency-key'),
    });

    if (outcome.kind === 'redirect') {
      res.redirect(HttpStatus.SEE_OTHER, outcome.url);
    } else if (outcome.contentType === 'form') {
      // Someone submitting a form sees this page, not JSON.
      res
        .status(HttpStatus.ACCEPTED)
        .type('text/plain')
        .send('Thanks, received.');
    } else {
      res.status(HttpStatus.ACCEPTED).json({ accepted: true });
    }
  }
}
