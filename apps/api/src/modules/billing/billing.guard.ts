import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { BillingService } from './billing.service';

/**
 * Stops writes for an organization whose trial has ended or whose payment
 * has failed past the grace period.
 *
 * Registered after authentication and authorization, so `req.user` is known.
 * Reads always pass — a lapsed customer can still see and export their data —
 * as do the routes needed to fix the situation: billing itself, signing in
 * and out, and dismissing notifications.
 */
@Injectable()
export class BillingGuard implements CanActivate {
  private static readonly ALWAYS_ALLOWED = [
    '/billing',
    '/auth',
    '/notifications',
  ];

  constructor(
    private readonly reflector: Reflector,
    private readonly billing: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || !req.user) return true;

    const path = req.path.replace(/^\/api\/v\d+/, '');
    if (BillingGuard.ALWAYS_ALLOWED.some((prefix) => path.startsWith(prefix)))
      return true;

    const restriction = await this.billing.restrictionFor(
      req.user.organizationId,
    );
    if (!restriction.restricted) return true;
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Payment Required',
        message: restriction.reason,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
