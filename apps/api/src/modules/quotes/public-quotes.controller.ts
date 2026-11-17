import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  approveProofSchema,
  declineQuoteSchema,
  requestProofChangesSchema,
  requestQuoteChangesSchema,
  type ApproveProofPayload,
  type DeclineQuotePayload,
  type PublicQuoteDto,
  type RequestProofChangesPayload,
  type RequestQuoteChangesPayload,
} from '@saas/shared';
import { Public } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { QuoteAcceptanceService } from './quote-acceptance.service';
import { QuoteResponsesService } from './quote-responses.service';

/**
 * The only quote endpoints reachable without signing in.
 *
 * Throttled on the stricter `auth` bucket: the token is unguessable, but
 * there is no reason to let anyone try.
 */
@ApiTags('public')
@Controller('public/quotes')
export class PublicQuotesController {
  constructor(
    private readonly acceptance: QuoteAcceptanceService,
    private readonly responses: QuoteResponsesService,
  ) {}

  @Public()
  @Get(':token')
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'View a quote from its acceptance link' })
  view(@Param('token') token: string): Promise<PublicQuoteDto> {
    return this.acceptance.view(token);
  }

  @Public()
  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Accept a quote from its acceptance link' })
  accept(
    @Param('token') token: string,
    @Body() body: { name: string },
    @Req() req: Request,
  ): Promise<PublicQuoteDto> {
    return this.acceptance.accept(token, body, req.ip);
  }

  @Public()
  @Post(':token/decline')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Decline a quote from its acceptance link' })
  decline(
    @Param('token') token: string,
    @Body(zodBody(declineQuoteSchema)) body: DeclineQuotePayload,
    @Req() req: Request,
  ): Promise<PublicQuoteDto> {
    return this.responses.decline(token, body, req.ip);
  }

  @Public()
  @Post(':token/request-changes')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ask for changes to a quote from its acceptance link' })
  requestChanges(
    @Param('token') token: string,
    @Body(zodBody(requestQuoteChangesSchema)) body: RequestQuoteChangesPayload,
    @Req() req: Request,
  ): Promise<PublicQuoteDto> {
    return this.responses.requestChanges(token, body, req.ip);
  }

  @Public()
  @Post(':token/proofs/:proofId/approve')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Approve the latest artwork proof' })
  approveProof(
    @Param('token') token: string,
    @Param('proofId', ParseUUIDPipe) proofId: string,
    @Body(zodBody(approveProofSchema)) body: ApproveProofPayload,
    @Req() req: Request,
  ): Promise<PublicQuoteDto> {
    return this.responses.approveProof(token, proofId, body, req.ip);
  }

  @Public()
  @Post(':token/proofs/:proofId/request-changes')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ask for changes to the latest artwork proof' })
  requestProofChanges(
    @Param('token') token: string,
    @Param('proofId', ParseUUIDPipe) proofId: string,
    @Body(zodBody(requestProofChangesSchema)) body: RequestProofChangesPayload,
    @Req() req: Request,
  ): Promise<PublicQuoteDto> {
    return this.responses.requestProofChanges(token, proofId, body, req.ip);
  }
}
