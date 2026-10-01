import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const req = context
        .switchToHttp()
        .getRequest<Request & { user?: AuthenticatedUser }>();
      const tenantId = req.user?.organizationId;
      if (tenantId) {
        this.tenantContext.setTenantId(tenantId);
      }
    }
    return next.handle();
  }
}
