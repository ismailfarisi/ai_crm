import { AiModule } from '@/modules/ai/ai.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { AutomationsModule } from '@/modules/automations/automations.module';
import { CatalogModule } from '@/modules/catalog/catalog.module';
import { ChannelsModule } from '@/modules/channels/channels.module';
import { ContactsModule } from '@/modules/contacts/contacts.module';
import { CustomersModule } from '@/modules/customers/customers.module';
import { FinanceModule } from '@/modules/finance/finance.module';
import { HealthModule } from '@/modules/health/health.module';
import { InventoryModule } from '@/modules/inventory/inventory.module';
import { InvitationsModule } from '@/modules/invitations/invitations.module';
import { MailModule } from '@/modules/mail/mail.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { OrganizationsModule } from '@/modules/organizations/organizations.module';
import { PayablesModule } from '@/modules/payables/payables.module';
import { ProductionModule } from '@/modules/production/production.module';
import { TaxModule } from '@/modules/tax/tax.module';
import { CreditsModule } from '@/modules/credits/credits.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { BillingModule } from '@/modules/billing/billing.module';
import { AuditModule } from '@/modules/audit/audit.module';
import { StorageModule } from '@/modules/storage/storage.module';
import { PurchasingModule } from '@/modules/purchasing/purchasing.module';
import { QuotesModule } from '@/modules/quotes/quotes.module';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { TeamsModule } from '@/modules/teams/teams.module';
import { TemporalModule } from '@/modules/temporal/temporal.module';
import { UsersModule } from '@/modules/users/users.module';

/**
 * The feature module registry, kept out of `app.module.ts` and
 * `worker.module.ts` so that adding a feature touches one file instead of two
 * import blocks and two arrays — the shape that makes concurrent feature
 * branches conflict.
 *
 * Everything the HTTP app serves. Order is preserved from the original
 * `AppModule` imports array.
 */
export const FEATURE_MODULES = [
  // The spine first: the audit interceptor and the file store are what every
  // other module assumes is already there.
  AuditModule,
  StorageModule,
  AiModule,
  RbacModule,
  UsersModule,
  AuthModule,
  OrganizationsModule,
  ContactsModule,
  CustomersModule,
  TeamsModule,
  InvitationsModule,
  MailModule,
  HealthModule,
  TemporalModule,
  QuotesModule,
  CatalogModule,
  ChannelsModule,
  AutomationsModule,
  FinanceModule,
  PurchasingModule,
  InventoryModule,
  PayablesModule,
  OrdersModule,
  ProductionModule,
  TaxModule,
  CreditsModule,
  NotificationsModule,
  BillingModule,
];

/**
 * The subset the standalone Temporal worker needs.
 *
 * Deliberately NOT `FEATURE_MODULES` minus a couple of entries. The worker
 * process only needs enough of the graph to satisfy TypeORM's relation
 * closure and its own activities; it currently runs without TeamsModule,
 * MailModule, CatalogModule, AutomationsModule or FinanceModule, and widening
 * it would change what boots in that process. If you add a module here,
 * do it because the worker needs it, not for symmetry.
 */
export const WORKER_FEATURE_MODULES = [
  // The worker records what its activities change, same as the HTTP app.
  AuditModule,
  TemporalModule,
  RbacModule,
  UsersModule,
  ContactsModule,
  CustomersModule,
  InvitationsModule,
  AiModule,
  ChannelsModule,
  QuotesModule,
  PurchasingModule,
  InventoryModule,
];
