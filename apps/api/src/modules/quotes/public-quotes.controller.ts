import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { PublicQuoteDto } from '@saas/shared';
import { Public } from '@/common/decorators';
import { QuoteAcceptanceService } from './quote-acceptance.service';

/**
 * The only quote endpoints reachable without signing in.
 *
 * Throttled on the stricter `auth` bucket: the token is unguessable, but
 * there is no reason to let anyone try.
 */
@ApiTags('public')
@Controller('public/quotes')
export class PublicQuotesController {
  constructor(private readonly acceptance: QuoteAcceptanceService) {}

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
}
