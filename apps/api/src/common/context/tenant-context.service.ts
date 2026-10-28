import { Injectable } from '@nestjs/common';
import { ClsService, ClsStore } from 'nestjs-cls';

export const CLS_TENANT_ID_KEY = 'tenantId' as const;
export const CLS_IS_SYSTEM_KEY = 'isSystem' as const;
export const CLS_AUTOMATION_EXECUTION_KEY = 'automationExecutionId' as const;

export interface TenantClsStore extends ClsStore {
  [CLS_TENANT_ID_KEY]?: string | null;
  [CLS_IS_SYSTEM_KEY]?: boolean;
  [CLS_AUTOMATION_EXECUTION_KEY]?: string | null;
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

  /** The automation execution this code is running on behalf of, if any. */
  getAutomationExecutionId(): string | null {
    return this.cls.get(CLS_AUTOMATION_EXECUTION_KEY) ?? null;
  }

  /**
   * Runs `fn` as a tenant-scoped automation step. Anything it publishes is
   * marked as caused by automation, so it cannot start further runs.
   */
  async runAsAutomation<T>(
    tenantId: string,
    executionId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.cls.runWith(
      {
        [CLS_TENANT_ID_KEY]: tenantId,
        [CLS_IS_SYSTEM_KEY]: false,
        [CLS_AUTOMATION_EXECUTION_KEY]: executionId,
      },
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
