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

    it('sets app.current_tenant_id using SET LOCAL when tenantId is present on afterTransactionStart', async () => {
      mockTenantContext.getTenantId.mockReturnValue(
        '11111111-1111-1111-1111-111111111111',
      );
      mockTenantContext.isSystem.mockReturnValue(false);

      await subscriber.afterTransactionStart({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as TransactionStartEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET LOCAL app.current_tenant_id = '11111111-1111-1111-1111-111111111111';",
      );
    });

    it('sets app.bypass_rls to on using SET LOCAL when isSystem is true on afterTransactionStart', async () => {
      mockTenantContext.getTenantId.mockReturnValue(null);
      mockTenantContext.isSystem.mockReturnValue(true);

      await subscriber.afterTransactionStart({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as TransactionStartEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET LOCAL app.bypass_rls = 'on';",
      );
    });

    it('clears session variables when neither tenantId nor isSystem is active inside transaction (fail-closed)', async () => {
      mockTenantContext.getTenantId.mockReturnValue(null);
      mockTenantContext.isSystem.mockReturnValue(false);

      await subscriber.afterTransactionStart({
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as TransactionStartEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        'RESET app.current_tenant_id; RESET app.bypass_rls;',
      );
    });

    it('sets SET LOCAL on beforeQuery if query is run inside active transaction', async () => {
      mockTenantContext.getTenantId.mockReturnValue(
        '22222222-2222-2222-2222-222222222222',
      );
      mockTenantContext.isSystem.mockReturnValue(false);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM users;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET LOCAL app.current_tenant_id = '22222222-2222-2222-2222-222222222222';",
      );
    });
  });

  describe('Outside transaction (SET)', () => {
    beforeEach(() => {
      mockQueryRunner.isTransactionActive = false;
    });

    it('sets app.current_tenant_id using SET when tenantId is present on beforeQuery', async () => {
      mockTenantContext.getTenantId.mockReturnValue(
        '33333333-3333-3333-3333-333333333333',
      );
      mockTenantContext.isSystem.mockReturnValue(false);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM customers;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET app.current_tenant_id = '33333333-3333-3333-3333-333333333333';",
      );
    });

    it('sets app.bypass_rls to on using SET when isSystem is true on beforeQuery', async () => {
      mockTenantContext.getTenantId.mockReturnValue(null);
      mockTenantContext.isSystem.mockReturnValue(true);

      await subscriber.beforeQuery({
        query: 'SELECT * FROM customers;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET app.bypass_rls = 'on';",
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
        'RESET app.current_tenant_id; RESET app.bypass_rls;',
      );
    });
  });

  describe('QueryRunner release wrapping', () => {
    it('wraps queryRunner.release and runs RESET statements before returning to pool', async () => {
      mockTenantContext.getTenantId.mockReturnValue('tenant-abc');
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

  describe('Recursion prevention', () => {
    it('does not intercept SET queries in beforeQuery', async () => {
      mockTenantContext.getTenantId.mockReturnValue('tenant-abc');

      await subscriber.beforeQuery({
        query: "SET LOCAL app.current_tenant_id = 'tenant-abc';",
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).not.toHaveBeenCalled();
    });

    it('does not intercept RESET queries in beforeQuery', async () => {
      mockTenantContext.getTenantId.mockReturnValue('tenant-abc');

      await subscriber.beforeQuery({
        query: 'RESET app.current_tenant_id; RESET app.bypass_rls;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).not.toHaveBeenCalled();
    });

    it('does not intercept lowercase or whitespace-prefixed set/reset queries', async () => {
      mockTenantContext.getTenantId.mockReturnValue('tenant-abc');

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
  });

  describe('Redundant execution avoidance', () => {
    it('does not re-execute SET query if context has not changed on the same query runner in a transaction', async () => {
      mockQueryRunner.isTransactionActive = true;
      mockTenantContext.getTenantId.mockReturnValue('tenant-123');

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
  });

  describe('SQL escaping / safety', () => {
    it('escapes single quotes in tenantId to prevent SQL injection', async () => {
      mockTenantContext.getTenantId.mockReturnValue("malicious' OR 1=1; --");

      await subscriber.beforeQuery({
        query: 'SELECT * FROM table1;',
        queryRunner: mockQueryRunner as unknown as QueryRunner,
      } as unknown as BeforeQueryEvent);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET app.current_tenant_id = 'malicious'' OR 1=1; --';",
      );
    });
  });
});
