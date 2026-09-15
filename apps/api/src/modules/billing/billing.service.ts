import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  billingRestriction,
  PERMISSIONS,
  TRIAL_DAYS,
  type PlanDto,
  type SubscriptionDto,
} from '@saas/shared';
import type { AppConfig } from '@/config/configuration';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/entities/user.entity';
import {
  FakeBillingProvider,
  StripeBillingProvider,
  type BillingProvider,
  type ProviderEvent,
} from './billing-provider';
import { Plan, Subscription } from './entities/billing.entity';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  readonly provider: BillingProvider;
  private readonly restrictionCache = new Map<
    string,
    { value: ReturnType<typeof billingRestriction>; expiresAt: number }
  >();

  constructor(
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly dataSource: DataSource,
  ) {
    const billing = this.config.get('billing', { infer: true });
    const origin = this.config.get('webOrigin', { infer: true })[0];
    this.provider =
      billing.provider === 'stripe'
        ? new StripeBillingProvider(
            billing.stripeSecretKey!,
            billing.stripeWebhookSecret!,
          )
        : new FakeBillingProvider(origin);
  }

  /* ------------------------------------------------------------------ *
   * Reading
   * ------------------------------------------------------------------ */

  async listPlans(): Promise<PlanDto[]> {
    const rows = await this.plans.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
    return rows.map((p) => this.planDto(p));
  }

  /** The organization's subscription, created as a trial if it has none. */
  async ensure(tenantId: string): Promise<Subscription> {
    const existing = await this.subscriptions.findOne({ where: { tenantId } });
    if (existing) return existing;
    await this.dataSource.query(
      `INSERT INTO "subscriptions" ("tenant_id", "status", "seats", "trial_ends_at", "provider")
       VALUES ($1, 'TRIALING', 1, now() + ($2 || ' days')::interval, $3)
       ON CONFLICT ("tenant_id") DO NOTHING`,
      [tenantId, String(TRIAL_DAYS), this.provider.name],
    );
    return (await this.subscriptions.findOne({ where: { tenantId } }))!;
  }

  async get(tenantId: string): Promise<SubscriptionDto> {
    const sub = await this.ensure(tenantId);
    const [plan, activeUsers] = await Promise.all([
      sub.planId
        ? this.plans.findOne({ where: { id: sub.planId } })
        : Promise.resolve(null),
      this.activeUsers(tenantId),
    ]);
    const restriction = this.enforce()
      ? billingRestriction(sub)
      : { restricted: false, restrictsAt: null, reason: null };
    return {
      status: sub.status,
      plan: plan ? this.planDto(plan) : null,
      seats: sub.seats,
      activeUsers,
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      pastDueSince: sub.pastDueSince?.toISOString() ?? null,
      restrictsAt: restriction.restrictsAt?.toISOString() ?? null,
      restricted: restriction.restricted,
      provider: this.provider.name,
    };
  }

  /**
   * Whether writes are blocked for an organization. Cached for a minute: this
   * runs on every write request, and the answer changes on the scale of days.
   */
  async restrictionFor(
    tenantId: string,
  ): Promise<ReturnType<typeof billingRestriction>> {
    if (!this.enforce())
      return { restricted: false, restrictsAt: null, reason: null };
    const cached = this.restrictionCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const sub = await this.ensure(tenantId);
    const value = billingRestriction(sub);
    this.restrictionCache.set(tenantId, {
      value,
      expiresAt: Date.now() + 60_000,
    });
    return value;
  }

  /* ------------------------------------------------------------------ *
   * Changing
   * ------------------------------------------------------------------ */

  async checkout(
    tenantId: string,
    user: { id: string; email: string },
    planCode: string,
  ): Promise<{ url: string }> {
    const plan = await this.plans.findOne({
      where: { code: planCode, isActive: true },
    });
    if (!plan) throw new NotFoundException('That plan does not exist');
    const dto = this.planDto(plan);
    if (!dto.purchasable) {
      throw new BadRequestException(
        `${plan.name} cannot be bought yet: no price is configured with the payment provider`,
      );
    }
    const sub = await this.ensure(tenantId);
    if (sub.status === 'ACTIVE' && sub.planId === plan.id) {
      throw new BadRequestException(
        `You are already subscribed to ${plan.name}`,
      );
    }
    const seats = Math.max(1, await this.activeUsers(tenantId));
    const origin = this.config.get('webOrigin', { infer: true })[0];
    const session = await this.provider.createCheckout({
      tenantId,
      planCode: plan.code,
      priceId: dto.purchasable ? this.priceIdFor(plan) : null,
      seats,
      customerEmail: user.email,
      customerId: sub.providerCustomerId,
      successUrl: `${origin}/settings/billing?checkout=success`,
      cancelUrl: `${origin}/settings/billing?checkout=cancelled`,
    });
    await this.subscriptions.update(
      { id: sub.id },
      {
        pendingCheckoutId: session.checkoutId,
        planId: plan.id,
        provider: this.provider.name,
      },
    );
    return { url: session.url };
  }

  async cancel(tenantId: string): Promise<SubscriptionDto> {
    const sub = await this.ensure(tenantId);
    if (sub.status !== 'ACTIVE' && sub.status !== 'PAST_DUE') {
      throw new BadRequestException('There is no paid subscription to cancel');
    }
    if (sub.providerSubscriptionId)
      await this.provider.cancelAtPeriodEnd(sub.providerSubscriptionId);
    await this.subscriptions.update(
      { id: sub.id },
      { cancelAtPeriodEnd: true },
    );
    this.restrictionCache.delete(tenantId);
    return this.get(tenantId);
  }

  /**
   * Keeps the billed seat count equal to active users. Run hourly, and after
   * checkout; a failure is logged and retried next hour, never surfaced to
   * whoever happened to add a user.
   */
  async syncSeats(tenantId: string): Promise<void> {
    const sub = await this.ensure(tenantId);
    const seats = Math.max(1, await this.activeUsers(tenantId));
    if (seats === sub.seats) return;
    try {
      if (sub.status === 'ACTIVE' && sub.providerSubscriptionId) {
        await this.provider.updateSeats(sub.providerSubscriptionId, seats);
      }
      await this.subscriptions.update(
        { id: sub.id },
        { seats, seatsSyncedAt: new Date() },
      );
    } catch (err) {
      this.logger.warn(
        `Seat sync failed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async syncAllSeats(): Promise<void> {
    const subs = await this.subscriptions.find({
      where: { status: In(['ACTIVE', 'TRIALING', 'PAST_DUE']) },
    });
    for (const sub of subs) await this.syncSeats(sub.tenantId);
  }

  /** Three days before a trial ends, the people who can pay are told. */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async warnEndingTrials(): Promise<void> {
    const rows: { tenant_id: string; id: string; trial_ends_at: Date }[] =
      await this.dataSource.query(
        `SELECT "tenant_id", "id", "trial_ends_at" FROM "subscriptions"
       WHERE "status" = 'TRIALING' AND "trial_ends_at" BETWEEN now() AND now() + interval '3 days'`,
      );
    for (const row of rows) {
      await this.notifications.notifyHolders(
        row.tenant_id,
        PERMISSIONS.ORG_MANAGE_BILLING,
        {
          type: 'TRIAL_ENDING',
          title: `Your trial ends on ${new Date(row.trial_ends_at).toDateString()}`,
          body: 'Choose a plan to keep making changes after it ends.',
          link: '/settings/billing',
          entityType: 'SUBSCRIPTION',
          entityId: row.id,
        },
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * Provider events
   * ------------------------------------------------------------------ */

  handleWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: true }> {
    const event = this.provider.parseWebhook(rawBody, headers);
    return this.apply(event).then(() => ({ received: true as const }));
  }

  /**
   * Development and staging only: completes a fake checkout as if the
   * provider had confirmed payment, through the same path a real webhook takes.
   */
  async completeFakeCheckout(
    tenantId: string,
    checkoutId: string,
  ): Promise<SubscriptionDto> {
    this.assertFake();
    const sub = await this.ensure(tenantId);
    if (!sub.pendingCheckoutId || sub.pendingCheckoutId !== checkoutId) {
      throw new BadRequestException(
        'That checkout is not pending for this organization',
      );
    }
    const now = Date.now();
    await this.apply({
      id: `fake_evt_${checkoutId}`,
      type: 'checkout.completed',
      tenantId,
      checkoutId,
      customerId: sub.providerCustomerId ?? `fake_cus_${tenantId.slice(0, 8)}`,
      subscriptionId:
        sub.providerSubscriptionId ?? `fake_sub_${tenantId.slice(0, 8)}`,
      status: 'ACTIVE',
      currentPeriodEnd: new Date(now + 30 * 86_400_000),
      raw: { fake: true, checkoutId },
    });
    return this.get(tenantId);
  }

  /** Development and staging only: a declined renewal, to exercise dunning. */
  async failFakePayment(tenantId: string): Promise<SubscriptionDto> {
    this.assertFake();
    const sub = await this.ensure(tenantId);
    await this.apply({
      id: `fake_evt_fail_${Date.now()}`,
      type: 'payment.failed',
      tenantId,
      subscriptionId: sub.providerSubscriptionId,
      raw: { fake: true },
    });
    return this.get(tenantId);
  }

  private async apply(event: ProviderEvent): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // At-least-once delivery: the event id decides whether this is news.
      const inserted: { id: string }[] = await manager.query(
        `INSERT INTO "billing_events" ("provider", "provider_event_id", "type", "tenant_id", "payload")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("provider", "provider_event_id") DO NOTHING
         RETURNING "id"`,
        [
          this.provider.name,
          event.id,
          event.type,
          event.tenantId,
          JSON.stringify(event.raw),
        ],
      );
      if (!inserted.length || event.type === 'ignored') return;

      const repo = manager.getRepository(Subscription);
      const sub =
        (event.tenantId
          ? await repo.findOne({ where: { tenantId: event.tenantId } })
          : null) ??
        (event.subscriptionId
          ? await repo.findOne({
              where: { providerSubscriptionId: event.subscriptionId },
            })
          : null) ??
        (event.customerId
          ? await repo.findOne({
              where: { providerCustomerId: event.customerId },
            })
          : null);
      if (!sub) {
        this.logger.warn(
          `Billing event ${event.id} (${event.type}) matched no subscription`,
        );
        return;
      }

      switch (event.type) {
        case 'checkout.completed':
          sub.status = 'ACTIVE';
          sub.pendingCheckoutId = null;
          sub.providerCustomerId = event.customerId ?? sub.providerCustomerId;
          sub.providerSubscriptionId =
            event.subscriptionId ?? sub.providerSubscriptionId;
          sub.currentPeriodEnd = event.currentPeriodEnd ?? sub.currentPeriodEnd;
          sub.pastDueSince = null;
          sub.failedPaymentCount = 0;
          sub.cancelAtPeriodEnd = false;
          break;
        case 'subscription.updated':
          if (event.status) sub.status = event.status;
          if (event.currentPeriodEnd)
            sub.currentPeriodEnd = event.currentPeriodEnd;
          if (event.cancelAtPeriodEnd != null)
            sub.cancelAtPeriodEnd = event.cancelAtPeriodEnd;
          if (event.seats) sub.seats = event.seats;
          if (sub.status === 'ACTIVE') sub.pastDueSince = null;
          if (sub.status === 'PAST_DUE')
            sub.pastDueSince = sub.pastDueSince ?? new Date();
          break;
        case 'subscription.deleted':
          sub.status = 'CANCELED';
          break;
        case 'payment.failed':
          sub.status = 'PAST_DUE';
          sub.pastDueSince = sub.pastDueSince ?? new Date();
          sub.failedPaymentCount += 1;
          await this.notifications.notifyHolders(
            sub.tenantId,
            PERMISSIONS.ORG_MANAGE_BILLING,
            {
              type: 'PAYMENT_FAILED',
              title: 'A subscription payment failed',
              body: 'Update your payment details to avoid losing the ability to make changes.',
              link: '/settings/billing',
              entityType: 'SUBSCRIPTION',
              entityId: sub.id,
            },
            { manager },
          );
          break;
        case 'payment.succeeded':
          if (sub.status === 'PAST_DUE') sub.status = 'ACTIVE';
          sub.pastDueSince = null;
          sub.failedPaymentCount = 0;
          await this.notifications.resolve(sub.tenantId, sub.id, manager);
          break;
      }
      await repo.save(sub);
      this.restrictionCache.delete(sub.tenantId);
    });
  }

  /* ------------------------------------------------------------------ */

  private enforce(): boolean {
    return this.config.get('billing', { infer: true }).enforce;
  }

  private assertFake(): void {
    const billing = this.config.get('billing', { infer: true });
    if (this.provider.name !== 'fake' || !billing.fakeCheckout) {
      throw new ForbiddenException(
        'Simulated checkout is not available in this environment',
      );
    }
  }

  private priceIdFor(plan: Plan): string | null {
    const configured = this.config.get('billing', { infer: true })
      .stripePriceIds[plan.code];
    return configured ?? plan.providerPriceId;
  }

  private planDto(plan: Plan): PlanDto {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      currency: plan.currency,
      pricePerSeat: plan.pricePerSeat,
      interval: plan.interval,
      trialDays: plan.trialDays,
      features: plan.features ?? [],
      purchasable:
        this.provider.name === 'fake' || Boolean(this.priceIdFor(plan)),
    };
  }

  private activeUsers(tenantId: string): Promise<number> {
    return this.users.count({
      where: { organizationId: tenantId, isActive: true },
    });
  }
}
