import { Injectable } from '@nestjs/common';
import { ClsService, ClsStore } from 'nestjs-cls';

export const CLS_TENANT_ID_KEY = 'tenantId' as const;
export const CLS_IS_SYSTEM_KEY = 'isSystem' as const;

export interface TenantClsStore extends ClsStore {
  [CLS_TENANT_ID_KEY]?: string | null;
  [CLS_IS_SYSTEM_KEY]?: boolean;
}

declare module 'nestjs-cls' {
  interface ClsStore {
    [CLS_TENANT_ID_KEY]?: string | null;
    [CLS_IS_SYSTEM_KEY]?: boolean;
  }
}

@Injectable()
export class TenantContextService {
  constructor(private readonly cls: ClsService<TenantClsStore>) {}

  getTenantId(): string | null {
    return this.cls.get(CLS_TENANT_ID_KEY) ?? null;
  }

  setTenantId(tenantId: string): void {
    this.cls.set(CLS_TENANT_ID_KEY, tenantId);
  }

  isSystem(): boolean {
    return Boolean(this.cls.get(CLS_IS_SYSTEM_KEY));
  }

  async runWithTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.cls.runWith(
      { [CLS_TENANT_ID_KEY]: tenantId, [CLS_IS_SYSTEM_KEY]: false },
      fn,
    );
  }

  async runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
    return this.cls.runWith(
      { [CLS_TENANT_ID_KEY]: null, [CLS_IS_SYSTEM_KEY]: true },
      fn,
    );
  }
}
