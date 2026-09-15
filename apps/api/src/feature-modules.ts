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
import { PayablesModule } from '@/modules/payables/payables.module';
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
  AiModule,
  RbacModule,
  UsersModule,
  AuthModule,
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
