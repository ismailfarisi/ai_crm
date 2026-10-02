import { DataSource, EntitySubscriberInterface, QueryRunner } from 'typeorm';
import { TenantRlsSubscriber } from './tenant-rls.subscriber';
import { TenantContextService } from '../common/context/tenant-context.service';

type BeforeQueryEvent = Parameters<
  NonNullable<EntitySubscriberInterface['beforeQuery']>
>[0];
type TransactionStartEvent = Parameters<
  NonNullable<EntitySubscriberInterface['afterTransactionStart']>
>[0];

describe('TenantRlsSubscriber', () => {
  let subscriber: TenantRlsSubscriber;
  let mockTenantContext: jest.Mocked<TenantContextService>;
  let mockDataSource: jest.Mocked<DataSource>;
  let mockQueryRunner: {
    query: jest.Mock;
    release: jest.Mock;
    isTransactionActive: boolean;
    isReleased: boolean;
    data: Record<string, any>;
  };

  const VALID_TENANT_ID_1 = '11111111-1111-1111-1111-111111111111';
  const VALID_TENANT_ID_2 = '22222222-2222-2222-2222-222222222222';
  const VALID_TENANT_ID_3 = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    mockTenantContext = {
      getTenantId: jest.fn().mockReturnValue(null),
      isSystem: jest.fn().mockReturnValue(false),
      setTenantId: jest.fn(),
      runWithTenant: jest.fn(),
      runAsSystem: jest.fn(),
    } as unknown as jest.Mocked<TenantContextService>;

    mockQueryRunner = {
      query: jest.fn().mockResolvedValue([]),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: false,
      isReleased: false,
      data: {},
    };

    mockDataSource = {
      subscribers: [],
    } as unknown as jest.Mocked<DataSource>;

    subscriber = new TenantRlsSubscriber(mockDataSource, mockTenantContext);
  });

  describe('DataSource registration', () => {
    it('registers itself in DataSource.subscribers when DataSource is provided', () => {
      const ds = { subscribers: [] } as unknown as DataSource;
      const sub = new TenantRlsSubscriber(ds, mockTenantContext);
      expect(ds.subscribers).toContain(sub);
    });

    it('does not duplicate registration if already in subscribers array', () => {
      const ds = { subscribers: [] } as unknown as DataSource;
      const sub = new TenantRlsSubscriber(ds, mockTenantContext);
      new TenantRlsSubscriber(ds, mockTenantContext);
      expect(ds.subscribers.filter((s) => s === sub).length).toBe(1);
    });

    it('instantiates without error when DataSource is not provided', () => {
      expect(
        () => new TenantRlsSubscriber(undefined, mockTenantContext),
      ).not.toThrow();
    });

    it('accepts TenantContextService as the first argument', () => {
      const sub = new TenantRlsSubscriber(mockTenantContext);
      expect(sub).toBeInstanceOf(TenantRlsSubscriber);
    });
  });

  describe('Inside transaction (SET LOCAL)', () => {
    beforeEach(() => {
      mockQueryRunner.isTransactionActive = true;
    });

    it('sets app.current_tenant_id and disables bypass_rls using SET LOCAL when tenantId is present on afterTransactionStart', async () => {
      mockTenantContext.getTenantId.mockReturnValue(VALID_TENANT_ID_1);
      mockTenantContext.isSystem.mockReturnValue(false);

      await subscriber.afterTransactionStart({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as TransactionStartEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        `SET LOCAL app.current_tenant_id = '${VALID_TENANT_ID_1}'; SET LOCAL app.bypass_rls = 'off';`,
      );
    });

    it('sets app.bypass_rls to on and clears current_tenant_id using SET LOCAL when isSystem is true on afterTransactionStart', async () => {
      mockTenantContext.getTenantId.mockReturnValue(null);
      mockTenantContext.isSystem.mockReturnValue(true);

      await subscriber.afterTransactionStart({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as TransactionStartEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET LOCAL app.bypass_rls = 'on'; SET LOCAL app.current_tenant_id = '';",
      );
    });

    it('clears session variables when neither tenantId nor isSystem is active inside transaction (fail-closed)', async () => {
      mockTenantContext.getTenantId.mockReturnValue(null);
      mockTenantContext.isSystem.mockReturnValue(false);

      await subscriber.afterTransactionStart({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as TransactionStartEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET LOCAL app.current_tenant_id = ''; SET LOCAL app.bypass_rls = 'off';",
      );
    });

    it('sets SET LOCAL on beforeQuery if query is run inside active transaction', async () => {
      mockTenantContext.getTenantId.mockReturnValue(VALID_TENANT_ID_2);
      mockTenantContext.isSystem.mockReturnValue(false);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM users;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        `SET LOCAL app.current_tenant_id = '${VALID_TENANT_ID_2}'; SET LOCAL app.bypass_rls = 'off';`,
      );
    });
  });

  describe('Outside transaction (SET)', () => {
    beforeEach(() => {
      mockQueryRunner.isTransactionActive = false;
    });

    it('sets app.current_tenant_id and disables bypass_rls using SET when tenantId is present on beforeQuery', async () => {
      mockTenantContext.getTenantId.mockReturnValue(VALID_TENANT_ID_3);
      mockTenantContext.isSystem.mockReturnValue(false);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM customers;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        `SET app.current_tenant_id = '${VALID_TENANT_ID_3}'; SET app.bypass_rls = 'off';`,
      );
    });

    it('sets app.bypass_rls to on and clears current_tenant_id using SET when isSystem is true on beforeQuery', async () => {
      mockTenantContext.getTenantId.mockReturnValue(null);
      mockTenantContext.isSystem.mockReturnValue(true);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM customers;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET app.bypass_rls = 'on'; SET app.current_tenant_id = '';",
      );
    });

    it('clears session variables when neither tenantId nor isSystem is active outside transaction (fail-closed)', async () => {
      mockTenantContext.getTenantId.mockReturnValue(null);
      mockTenantContext.isSystem.mockReturnValue(false);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM customers;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET app.current_tenant_id = ''; SET app.bypass_rls = 'off';",
      );
    });
  });

  describe('Context transitions (prevent bypass_rls leakage)', () => {
    it('switches from system context to tenant context and turns bypass_rls off', async () => {
      // Step 1: Run as system
      mockTenantContext.isSystem.mockReturnValue(true);
      mockTenantContext.getTenantId.mockReturnValue(null);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM global_config;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET app.bypass_rls = 'on'; SET app.current_tenant_id = '';",
      );

      mockQueryRunner.query.mockClear();

      // Step 2: Same queryRunner executes tenant query
      mockTenantContext.isSystem.mockReturnValue(false);
      mockTenantContext.getTenantId.mockReturnValue(VALID_TENANT_ID_1);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM tenant_data;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        `SET app.current_tenant_id = '${VALID_TENANT_ID_1}'; SET app.bypass_rls = 'off';`,
      );
    });

    it('switches from system context to unset context and turns bypass_rls off', async () => {
      // Step 1: Run as system
      mockTenantContext.isSystem.mockReturnValue(true);
      mockTenantContext.getTenantId.mockReturnValue(null);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM global_config;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      mockQueryRunner.query.mockClear();

      // Step 2: Unset context
      mockTenantContext.isSystem.mockReturnValue(false);
      mockTenantContext.getTenantId.mockReturnValue(null);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM some_table;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET app.current_tenant_id = ''; SET app.bypass_rls = 'off';",
      );
    });
  });

  describe('UUID validation & fail-closed', () => {
    it('fails closed when tenantId is malformed (SQL injection attempt)', async () => {
      mockTenantContext.getTenantId.mockReturnValue("malicious' OR 1=1; --");
      mockTenantContext.isSystem.mockReturnValue(false);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM table1;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET app.current_tenant_id = ''; SET app.bypass_rls = 'off';",
      );
    });

    it('fails closed when tenantId is non-UUID string', async () => {
      mockTenantContext.getTenantId.mockReturnValue('not-a-valid-uuid');
      mockTenantContext.isSystem.mockReturnValue(false);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM table1;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET app.current_tenant_id = ''; SET app.bypass_rls = 'off';",
      );
    });

    it('accepts valid uppercase UUID', async () => {
      const upperUuid = 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11';
      mockTenantContext.getTenantId.mockReturnValue(upperUuid);
      mockTenantContext.isSystem.mockReturnValue(false);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM table1;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        `SET app.current_tenant_id = '${upperUuid}'; SET app.bypass_rls = 'off';`,
      );
    });
  });

  describe('QueryRunner release wrapping', () => {
    it('wraps queryRunner.release and runs RESET statements before returning to pool', async () => {
      mockTenantContext.getTenantId.mockReturnValue(VALID_TENANT_ID_1);
      const originalRelease = mockQueryRunner.release;

      await subscriber.beforeQuery({
        query: 'SELECT * FROM invoices;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      // Now queryRunner.release should be wrapped
      expect(mockQueryRunner.release).not.toBe(originalRelease);

      mockQueryRunner.query.mockClear();

      await mockQueryRunner.release();

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        'RESET app.current_tenant_id; RESET app.bypass_rls;',
      );
      expect(originalRelease).toHaveBeenCalled();
    });

    it('still calls original release even if RESET query throws', async () => {
      const originalRelease = mockQueryRunner.release;

      await subscriber.beforeQuery({
        query: 'SELECT 1;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      mockQueryRunner.query.mockRejectedValueOnce(
        new Error('connection closed'),
      );

      await expect(mockQueryRunner.release()).resolves.not.toThrow();
      expect(originalRelease).toHaveBeenCalled();
    });

    it('does not execute RESET query if queryRunner is already marked isReleased', async () => {
      const originalRelease = mockQueryRunner.release;

      await subscriber.beforeQuery({
        query: 'SELECT 1;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      mockQueryRunner.isReleased = true;
      mockQueryRunner.query.mockClear();

      await mockQueryRunner.release();

      expect(mockQueryRunner.query).not.toHaveBeenCalledWith(
        'RESET app.current_tenant_id; RESET app.bypass_rls;',
      );
      expect(originalRelease).toHaveBeenCalled();
    });
  });

  describe('Recursion and transaction control queries prevention', () => {
    it('does not intercept SET queries in beforeQuery', async () => {
      mockTenantContext.getTenantId.mockReturnValue(VALID_TENANT_ID_1);

      await subscriber.beforeQuery({
        query: `SET LOCAL app.current_tenant_id = '${VALID_TENANT_ID_1}';`,
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).not.toHaveBeenCalled();
    });

    it('does not intercept RESET queries in beforeQuery', async () => {
      mockTenantContext.getTenantId.mockReturnValue(VALID_TENANT_ID_1);

      await subscriber.beforeQuery({
        query: 'RESET app.current_tenant_id; RESET app.bypass_rls;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).not.toHaveBeenCalled();
    });

    it('does not intercept lowercase or whitespace-prefixed set/reset queries', async () => {
      mockTenantContext.getTenantId.mockReturnValue(VALID_TENANT_ID_1);

      await subscriber.beforeQuery({
        query: "  \n\t set app.bypass_rls = 'on';",
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      await subscriber.beforeQuery({
        query: '  reset ALL;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).not.toHaveBeenCalled();
    });

    it('does not intercept START TRANSACTION, BEGIN, COMMIT, or ROLLBACK queries', async () => {
      mockTenantContext.getTenantId.mockReturnValue(VALID_TENANT_ID_1);

      const controlQueries = [
        'START TRANSACTION;',
        'START   TRANSACTION READ ONLY;',
        'BEGIN',
        'BEGIN TRANSACTION;',
        'COMMIT;',
        'COMMIT AND CHAIN;',
        'ROLLBACK;',
        'ROLLBACK TO SAVEPOINT sp1;',
        'SAVEPOINT my_savepoint;',
        'RELEASE SAVEPOINT my_savepoint;',
        '  \n\t rollback ;',
      ];

      for (const query of controlQueries) {
        await subscriber.beforeQuery({
          query,
          queryRunner: mockQueryRunner as unknown as QueryRunner,
        } as unknown as BeforeQueryEvent);
      }

      expect(mockQueryRunner.query).not.toHaveBeenCalled();
    });
  });

  describe('Redundant execution avoidance', () => {
    it('does not re-execute SET query if context has not changed on the same query runner in a transaction', async () => {
      mockQueryRunner.isTransactionActive = true;
      mockTenantContext.getTenantId.mockReturnValue(VALID_TENANT_ID_1);

      // First query in transaction: afterTransactionStart fires
      await subscriber.afterTransactionStart({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as TransactionStartEvent);
      expect(mockQueryRunner.query).toHaveBeenCalledTimes(1);

      // Next query in transaction: beforeQuery fires
      await subscriber.beforeQuery({
        query: 'SELECT * FROM table1;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);
      expect(mockQueryRunner.query).toHaveBeenCalledTimes(1); // not called again!

      // Another query in same transaction
      await subscriber.beforeQuery({
        query: 'SELECT * FROM table2;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);
      expect(mockQueryRunner.query).toHaveBeenCalledTimes(1); // still not called again!
    });

    it('clears context cache on transaction commit so next transaction applies context fresh', async () => {
      mockQueryRunner.isTransactionActive = true;
      mockTenantContext.getTenantId.mockReturnValue(VALID_TENANT_ID_1);

      await subscriber.afterTransactionStart({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as TransactionStartEvent);
      expect(mockQueryRunner.query).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.data.__rlsContextKey).toBeDefined();

      await subscriber.afterTransactionCommit({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as never);
      expect(mockQueryRunner.data.__rlsContextKey).toBeUndefined();

      // Next transaction starts
      await subscriber.afterTransactionStart({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as TransactionStartEvent);
      expect(mockQueryRunner.query).toHaveBeenCalledTimes(2);
    });

    it('clears context cache on transaction rollback so next transaction applies context fresh', async () => {
      mockQueryRunner.isTransactionActive = true;
      mockTenantContext.getTenantId.mockReturnValue(VALID_TENANT_ID_1);

      await subscriber.afterTransactionStart({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as TransactionStartEvent);
      expect(mockQueryRunner.query).toHaveBeenCalledTimes(1);

      await subscriber.afterTransactionRollback({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as never);
      expect(mockQueryRunner.data.__rlsContextKey).toBeUndefined();

      // Next transaction starts
      await subscriber.afterTransactionStart({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as TransactionStartEvent);
      expect(mockQueryRunner.query).toHaveBeenCalledTimes(2);
    });
  });
});
