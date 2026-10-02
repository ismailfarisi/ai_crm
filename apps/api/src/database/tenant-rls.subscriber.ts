import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ClsServiceManager } from 'nestjs-cls';
import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  QueryRunner,
} from 'typeorm';
import { TenantContextService } from '../common/context/tenant-context.service';

type BeforeQueryEvent = Parameters<
  NonNullable<EntitySubscriberInterface['beforeQuery']>
>[0];
type TransactionStartEvent = Parameters<
  NonNullable<EntitySubscriberInterface['afterTransactionStart']>
>[0];
type TransactionCommitEvent = Parameters<
  NonNullable<EntitySubscriberInterface['afterTransactionCommit']>
>[0];
type TransactionRollbackEvent = Parameters<
  NonNullable<EntitySubscriberInterface['afterTransactionRollback']>
>[0];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
@EventSubscriber()
export class TenantRlsSubscriber implements EntitySubscriberInterface {
  private readonly tenantContext: TenantContextService;
  private readonly dataSource?: DataSource;

  constructor(
    @Optional()
    @InjectDataSource()
    dataSourceOrContext?: DataSource | TenantContextService,
    @Optional() tenantContext?: TenantContextService,
  ) {
    if (
      dataSourceOrContext &&
      'getTenantId' in dataSourceOrContext &&
      typeof (dataSourceOrContext as Partial<TenantContextService>)
        .getTenantId === 'function'
    ) {
      this.tenantContext = dataSourceOrContext;
      this.dataSource = undefined;
    } else {
      this.dataSource = dataSourceOrContext as DataSource | undefined;
      this.tenantContext =
        tenantContext ??
        new TenantContextService(ClsServiceManager.getClsService());
    }

    if (
      this.dataSource?.subscribers &&
      Array.isArray(this.dataSource.subscribers) &&
      !this.dataSource.subscribers.includes(this)
    ) {
      this.dataSource.subscribers.push(this);
    }
  }

  private wrapRelease(queryRunner: QueryRunner): void {
    if (!queryRunner) {
      return;
    }
    if (!queryRunner.data) {
      queryRunner.data = {};
    }
    if (queryRunner.data.__rlsReleaseWrapped) {
      return;
    }
    queryRunner.data.__rlsReleaseWrapped = true;

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalRelease = queryRunner.release;
    queryRunner.release = async (): Promise<void> => {
      try {
        if (!queryRunner.isReleased) {
          await queryRunner.query(
            'RESET app.current_tenant_id; RESET app.bypass_rls;',
          );
        }
      } catch {
        // Connection may already be closed, disconnected, or errored
      } finally {
        if (queryRunner.data) {
          delete queryRunner.data.__rlsContextKey;
        }
        await originalRelease.call(queryRunner);
      }
    };
  }

  private async applyRlsContext(queryRunner: QueryRunner): Promise<void> {
    if (!queryRunner) {
      return;
    }
    if (!queryRunner.data) {
      queryRunner.data = {};
    }

    this.wrapRelease(queryRunner);

    if (queryRunner.data.__rlsSetting) {
      return;
    }

    const isTx = Boolean(queryRunner.isTransactionActive);
    const isSystem = this.tenantContext.isSystem();
    const rawTenantId = this.tenantContext.getTenantId();
    const tenantId =
      rawTenantId && UUID_REGEX.test(rawTenantId) ? rawTenantId : null;

    const contextKey = `${isTx ? 'tx' : 'notx'}:${isSystem ? 'system' : (tenantId ?? 'none')}`;
    if (queryRunner.data.__rlsContextKey === contextKey) {
      return;
    }

    queryRunner.data.__rlsSetting = true;
    try {
      const prefix = isTx ? 'SET LOCAL' : 'SET';
      if (isSystem) {
        await queryRunner.query(
          `${prefix} app.bypass_rls = 'on'; ${prefix} app.current_tenant_id = '';`,
        );
      } else if (tenantId) {
        const safeTenantId = tenantId.replace(/'/g, "''");
        await queryRunner.query(
          `${prefix} app.current_tenant_id = '${safeTenantId}'; ${prefix} app.bypass_rls = 'off';`,
        );
      } else {
        // Fail-closed: clear session variables so RLS blocks access
        await queryRunner.query(
          `${prefix} app.current_tenant_id = ''; ${prefix} app.bypass_rls = 'off';`,
        );
      }
      queryRunner.data.__rlsContextKey = contextKey;
    } finally {
      queryRunner.data.__rlsSetting = false;
    }
  }

  async afterTransactionStart(event: TransactionStartEvent): Promise<void> {
    if (!event?.queryRunner) {
      return;
    }
    await this.applyRlsContext(event.queryRunner);
  }

  async afterTransactionCommit(event: TransactionCommitEvent): Promise<void> {
    if (event?.queryRunner?.data) {
      delete event.queryRunner.data.__rlsContextKey;
    }
  }

  async afterTransactionRollback(
    event: TransactionRollbackEvent,
  ): Promise<void> {
    if (event?.queryRunner?.data) {
      delete event.queryRunner.data.__rlsContextKey;
    }
  }

  async beforeQuery(event: BeforeQueryEvent): Promise<void> {
    if (!event?.query || !event?.queryRunner) {
      return;
    }

    // Guard against recursion and transaction control queries
    if (
      /^\s*(SET|RESET|BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(
        event.query,
      )
    ) {
      return;
    }

    await this.applyRlsContext(event.queryRunner);
  }
}
