import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { PERMISSIONS, type PlanDto } from '@saas/shared';
import { BillingService } from './billing.service';
import { Plan, Subscription } from './entities/billing.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantContextService } from '@/common/context/tenant-context.service';
import type { ProviderEvent } from './billing-provider';

describe('BillingService', () => {
  let service: BillingService;
  let plansRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let subscriptionsRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
    save: jest.Mock;
  };
  let usersRepo: {
    count: jest.Mock;
  };
  let notifications: {
    notifyHolders: jest.Mock;
    resolve: jest.Mock;
  };
  let config: {
    get: jest.Mock;
  };
  let dataSource: {
    query: jest.Mock;
    transaction: jest.Mock;
  };
  let tenantContext: {
    runAsSystem: jest.Mock;
    runWithTenant: jest.Mock;
    getTenantId: jest.Mock;
    setTenantId: jest.Mock;
    isSystem: jest.Mock;
  };

  const tenantId = 'org-1';

  beforeEach(() => {
    plansRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };

    subscriptionsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockImplementation(async (sub) => sub),
    };

    usersRepo = {
      count: jest.fn().mockResolvedValue(1),
    };

    notifications = {
      notifyHolders: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };

    config = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'billing') {
          return {
            provider: 'stripe',
            stripeSecretKey: 'sk_test_123',
            stripeWebhookSecret: 'whsec_test_123',
            enforce: true,
            fakeCheckout: false,
            stripePriceIds: {},
          };
        }
        if (key === 'publicWebUrl') return 'https://example.com';
        return null;
      }),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn().mockImplementation(async (cb) => {
        const manager = {
          query: jest.fn().mockResolvedValue([{ id: 'billing-evt-1' }]),
          getRepository: jest.fn().mockReturnValue(subscriptionsRepo),
        };
        return cb(manager);
      }),
    };

    tenantContext = {
      runAsSystem: jest.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      runWithTenant: jest.fn().mockImplementation(async (_tenantId: string, fn: () => Promise<unknown>) => fn()),
      getTenantId: jest.fn().mockReturnValue(null),
      setTenantId: jest.fn(),
      isSystem: jest.fn().mockReturnValue(false),
    };

    service = new BillingService(
      plansRepo as unknown as Repository<Plan>,
      subscriptionsRepo as unknown as Repository<Subscription>,
      usersRepo as unknown as Repository<User>,
      notifications as unknown as NotificationsService,
      config as unknown as ConfigService<any, true>,
      dataSource as unknown as DataSource,
      tenantContext as unknown as TenantContextService,
    );
  });

  describe('handleWebhook & handleWebhookEvent', () => {
    it('executes handleWebhook inside tenantContext.runAsSystem', async () => {
      const parseSpy = jest.spyOn(service.provider, 'parseWebhook').mockReturnValue({
        id: 'evt_stripe_1',
        type: 'checkout.completed',
        tenantId,
        checkoutId: 'cs_123',
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
        status: 'ACTIVE',
        raw: {},
      });

      const handleEventSpy = jest.spyOn(service, 'handleWebhookEvent');

      const rawBody = Buffer.from('{}');
      const headers = { 'stripe-signature': 'sig' };

      const res = await service.handleWebhook(rawBody, headers);

      expect(parseSpy).toHaveBeenCalledWith(rawBody, headers);
      expect(handleEventSpy).toHaveBeenCalled();
      expect(tenantContext.runAsSystem).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ received: true });
    });

    it('verifies that handleWebhookEvent wraps database transactions inside runAsSystem', async () => {
      let isInsideSystemContext = false;
      tenantContext.runAsSystem.mockImplementationOnce(async (fn: () => Promise<unknown>) => {
        isInsideSystemContext = true;
        try {
          return await fn();
        } finally {
          isInsideSystemContext = false;
        }
      });

      const mockSub: Partial<Subscription> = {
        id: 'sub-row-1',
        tenantId,
        status: 'TRIALING',
        providerCustomerId: null,
        providerSubscriptionId: null,
        failedPaymentCount: 0,
        cancelAtPeriodEnd: false,
      };
      subscriptionsRepo.findOne.mockResolvedValue(mockSub);

      const event: ProviderEvent = {
        id: 'evt_1',
        type: 'checkout.completed',
        tenantId,
        checkoutId: 'cs_1',
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
        status: 'ACTIVE',
        raw: {},
      };

      await service.handleWebhookEvent(event);

      expect(tenantContext.runAsSystem).toHaveBeenCalledTimes(1);
      expect(mockSub.status).toBe('ACTIVE');
      expect(mockSub.providerCustomerId).toBe('cus_1');
      expect(mockSub.providerSubscriptionId).toBe('sub_1');
      expect(isInsideSystemContext).toBe(false);
    });

    it('handles checkout.completed event and activates subscription', async () => {
      const mockSub: Partial<Subscription> = {
        id: 'sub-1',
        tenantId,
        status: 'TRIALING',
        pendingCheckoutId: 'cs_test',
        providerCustomerId: null,
        providerSubscriptionId: null,
        failedPaymentCount: 0,
        cancelAtPeriodEnd: true,
      };
      subscriptionsRepo.findOne.mockResolvedValue(mockSub);

      const event: ProviderEvent = {
        id: 'evt_checkout_1',
        type: 'checkout.completed',
        tenantId,
        checkoutId: 'cs_test',
        customerId: 'cus_new',
        subscriptionId: 'sub_new',
        status: 'ACTIVE',
        raw: {},
      };

      await service.handleWebhookEvent(event);

      expect(mockSub.status).toBe('ACTIVE');
      expect(mockSub.pendingCheckoutId).toBeNull();
      expect(mockSub.providerCustomerId).toBe('cus_new');
      expect(mockSub.providerSubscriptionId).toBe('sub_new');
      expect(mockSub.cancelAtPeriodEnd).toBe(false);
      expect(subscriptionsRepo.save).toHaveBeenCalledWith(mockSub);
    });

    it('handles subscription.updated event', async () => {
      const mockSub: Partial<Subscription> = {
        id: 'sub-1',
        tenantId,
        status: 'ACTIVE',
        seats: 2,
        cancelAtPeriodEnd: false,
      };
      subscriptionsRepo.findOne.mockResolvedValue(mockSub);

      const event: ProviderEvent = {
        id: 'evt_update_1',
        type: 'subscription.updated',
        subscriptionId: 'sub_existing',
        status: 'ACTIVE',
        seats: 5,
        cancelAtPeriodEnd: true,
        raw: {},
      };

      await service.handleWebhookEvent(event);

      expect(mockSub.seats).toBe(5);
      expect(mockSub.cancelAtPeriodEnd).toBe(true);
      expect(subscriptionsRepo.save).toHaveBeenCalledWith(mockSub);
    });

    it('handles subscription.deleted event', async () => {
      const mockSub: Partial<Subscription> = {
        id: 'sub-1',
        tenantId,
        status: 'ACTIVE',
      };
      subscriptionsRepo.findOne.mockResolvedValue(mockSub);

      const event: ProviderEvent = {
        id: 'evt_del_1',
        type: 'subscription.deleted',
        subscriptionId: 'sub_existing',
        raw: {},
      };

      await service.handleWebhookEvent(event);

      expect(mockSub.status).toBe('CANCELED');
      expect(subscriptionsRepo.save).toHaveBeenCalledWith(mockSub);
    });

    it('handles payment.failed event and alerts billing holders', async () => {
      const mockSub: Partial<Subscription> = {
        id: 'sub-1',
        tenantId,
        status: 'ACTIVE',
        failedPaymentCount: 0,
        pastDueSince: null,
      };
      subscriptionsRepo.findOne.mockResolvedValue(mockSub);

      const event: ProviderEvent = {
        id: 'evt_fail_1',
        type: 'payment.failed',
        subscriptionId: 'sub_existing',
        raw: {},
      };

      await service.handleWebhookEvent(event);

      expect(mockSub.status).toBe('PAST_DUE');
      expect(mockSub.failedPaymentCount).toBe(1);
      expect(mockSub.pastDueSince).toBeInstanceOf(Date);
      expect(notifications.notifyHolders).toHaveBeenCalledWith(
        tenantId,
        PERMISSIONS.ORG_MANAGE_BILLING,
        expect.objectContaining({ type: 'PAYMENT_FAILED' }),
        expect.any(Object),
      );
    });

    it('handles payment.succeeded event and resolves payment failure notices', async () => {
      const mockSub: Partial<Subscription> = {
        id: 'sub-1',
        tenantId,
        status: 'PAST_DUE',
        failedPaymentCount: 2,
        pastDueSince: new Date(),
      };
      subscriptionsRepo.findOne.mockResolvedValue(mockSub);

      const event: ProviderEvent = {
        id: 'evt_succ_1',
        type: 'payment.succeeded',
        subscriptionId: 'sub_existing',
        raw: {},
      };

      await service.handleWebhookEvent(event);

      expect(mockSub.status).toBe('ACTIVE');
      expect(mockSub.failedPaymentCount).toBe(0);
      expect(mockSub.pastDueSince).toBeNull();
      expect(notifications.resolve).toHaveBeenCalledWith(
        tenantId,
        'sub-1',
        expect.any(Object),
      );
    });

    it('skips processing if event was already inserted (idempotency)', async () => {
      dataSource.transaction.mockImplementationOnce(async (cb) => {
        const manager = {
          query: jest.fn().mockResolvedValue([]), // already exists!
          getRepository: jest.fn().mockReturnValue(subscriptionsRepo),
        };
        return cb(manager);
      });

      const event: ProviderEvent = {
        id: 'evt_duplicate',
        type: 'checkout.completed',
        tenantId,
        raw: {},
      };

      await service.handleWebhookEvent(event);

      expect(subscriptionsRepo.findOne).not.toHaveBeenCalled();
      expect(subscriptionsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('cron jobs', () => {
    it('syncAllSeats runs inside tenantContext.runAsSystem', async () => {
      subscriptionsRepo.find.mockResolvedValue([
        { tenantId: 'org-1', status: 'ACTIVE' },
        { tenantId: 'org-2', status: 'PAST_DUE' },
      ]);
      const syncSeatsSpy = jest.spyOn(service, 'syncSeats').mockResolvedValue(undefined);

      await service.syncAllSeats();

      expect(tenantContext.runAsSystem).toHaveBeenCalledTimes(1);
      expect(subscriptionsRepo.find).toHaveBeenCalled();
      expect(syncSeatsSpy).toHaveBeenCalledWith('org-1');
      expect(syncSeatsSpy).toHaveBeenCalledWith('org-2');
    });

    it('warnEndingTrials runs inside tenantContext.runAsSystem', async () => {
      dataSource.query.mockResolvedValueOnce([
        { tenant_id: 'org-1', id: 'sub-1', trial_ends_at: new Date() },
      ]);

      await service.warnEndingTrials();

      expect(tenantContext.runAsSystem).toHaveBeenCalledTimes(1);
      expect(notifications.notifyHolders).toHaveBeenCalledWith(
        'org-1',
        PERMISSIONS.ORG_MANAGE_BILLING,
        expect.objectContaining({ type: 'TRIAL_ENDING' }),
      );
    });
  });

  describe('listPlans', () => {
    it('returns active plans formatted as PlanDto', async () => {
      const mockPlan: Partial<Plan> = {
        id: 'plan-1',
        code: 'pro',
        name: 'Pro Plan',
        description: 'For growing teams',
        currency: 'USD',
        pricePerSeat: 2900,
        interval: 'MONTH',
        trialDays: 14,
        features: ['feature_1'],
        isActive: true,
        sortOrder: 1,
        providerPriceId: 'price_pro_123',
      };
      plansRepo.find.mockResolvedValue([mockPlan]);

      const plans = await service.listPlans();

      expect(plans.length).toBe(1);
      expect(plans[0]).toMatchObject({
        id: 'plan-1',
        code: 'pro',
        name: 'Pro Plan',
        purchasable: true,
      });
    });
  });

  describe('ensure', () => {
    it('returns existing subscription when found', async () => {
      const existing: Partial<Subscription> = { id: 'sub-1', tenantId };
      subscriptionsRepo.findOne.mockResolvedValue(existing);

      const sub = await service.ensure(tenantId);

      expect(sub).toBe(existing);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('creates a new trial subscription when not found', async () => {
      const created: Partial<Subscription> = { id: 'sub-new', tenantId };
      subscriptionsRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(created);

      const sub = await service.ensure(tenantId);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO "subscriptions"'),
        expect.any(Array),
      );
      expect(sub).toBe(created);
    });
  });
});
