import { NotFoundException } from '@nestjs/common';
import { ApplicationFailure } from '@temporalio/activity';
import { AUTOMATION_PERMISSIONS } from '@saas/shared';
import type { AiService } from '@/modules/ai/ai.service';
import type { AuditService } from '@/modules/audit/audit.service';
import type { ChannelIdempotencyService } from '@/modules/channels/services/channel-idempotency.service';
import type { ContactsService } from '@/modules/contacts/contacts.service';
import type { MailService } from '@/modules/mail/mail.service';
import type { QuotesService } from '@/modules/quotes/quotes.service';
import type { RbacService } from '@/modules/rbac/rbac.service';
import type { UsersService } from '@/modules/users/users.service';
import type { TenantContextService } from '@/common/context/tenant-context.service';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import type {
  AiPromptActivityConfig,
  AiPromptActivityResult,
  AutomationActionContext,
  CrmMutationActivityConfig,
  CrmMutationActivityResult,
  EmailActivityConfig,
  EmailActivityResult,
} from './interfaces';

export interface AutomationActionDeps {
  mail: Pick<MailService, 'sendMail' | 'name'>;
  ai: Pick<AiService, 'generateText' | 'isConfigured' | 'getBudgetStatus'>;
  contacts: Pick<ContactsService, 'create' | 'update'>;
  quotes: Pick<QuotesService, 'sendSignal'>;
  users: Pick<UsersService, 'findMember' | 'findActiveEmails'>;
  rbac: Pick<RbacService, 'resolveAccess'>;
  audit: Pick<AuditService, 'record'>;
  tenantContext: Pick<TenantContextService, 'runAsAutomation'>;
  idempotency: Pick<ChannelIdempotencyService, 'runOnce'>;
}

/**
 * Resolves the person an automation acts as and builds the same
 * `AuthenticatedUser` the JWT strategy would, with permissions resolved fresh.
 * Every failure is non-retryable: retrying cannot make the owner active.
 */
export async function resolveOwner(
  deps: Pick<AutomationActionDeps, 'users' | 'rbac'>,
  ctx: AutomationActionContext,
  actionLabel: string,
): Promise<AuthenticatedUser> {
  if (!ctx.ownerUserId) {
    throw ApplicationFailure.nonRetryable(
      `This automation has no owner; reactivate it to run ${actionLabel}`,
    );
  }

  // Only "not found" means the owner is gone; anything else (a dropped
  // connection, say) propagates so Temporal can retry it.
  const user = await deps.users
    .findMember(ctx.tenantId, ctx.ownerUserId)
    .catch((err: unknown) => {
      if (err instanceof NotFoundException) return null;
      throw err;
    });
  const cannot = (who: string, missing = '') =>
    ApplicationFailure.nonRetryable(
      `${who} can no longer ${actionLabel}${missing}; reactivate the automation as someone who can`,
    );
  if (!user || !user.isActive) {
    throw cannot(user?.email ?? 'The automation owner');
  }

  const access = await deps.rbac.resolveAccess(user.id, user.tenantId);
  if (!access.permissions.includes(AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE)) {
    throw cannot(
      user.email,
      ` (missing ${AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE})`,
    );
  }

  return {
    id: user.id,
    organizationId: user.tenantId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roles: access.roles,
    level: access.level,
    permissions: access.permissions,
    isOwner: access.isOwner,
    teamId: user.teamId ?? null,
    managerId: user.managerId ?? null,
  };
}

/**
 * The automation steps that touch the CRM, mail and AI. Built from DI-resolved
 * services in the worker; every body runs in a tenant context marked as
 * automation-caused so it cannot start further runs.
 */
export function createAutomationActions(deps: AutomationActionDeps) {
  return {
    async executeEmailActivity(
      config: EmailActivityConfig,
      ctx: AutomationActionContext,
    ): Promise<EmailActivityResult> {
      return deps.tenantContext.runAsAutomation(
        ctx.tenantId,
        ctx.executionId,
        async () => {
          void config;
          throw new Error('executeEmailActivity: not implemented');
        },
      );
    },

    async executeAiPromptActivity(
      config: AiPromptActivityConfig,
      ctx: AutomationActionContext,
    ): Promise<AiPromptActivityResult> {
      return deps.tenantContext.runAsAutomation(
        ctx.tenantId,
        ctx.executionId,
        async () => {
          void config;
          throw new Error('executeAiPromptActivity: not implemented');
        },
      );
    },

    async executeCrmMutationActivity(
      config: CrmMutationActivityConfig,
      ctx: AutomationActionContext,
    ): Promise<CrmMutationActivityResult> {
      return deps.tenantContext.runAsAutomation(
        ctx.tenantId,
        ctx.executionId,
        async () => {
          void config;
          throw new Error('executeCrmMutationActivity: not implemented');
        },
      );
    },
  };
}
