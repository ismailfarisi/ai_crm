import { NotFoundException } from '@nestjs/common';
import { ApplicationFailure } from '@temporalio/activity';
import { AUTOMATION_PERMISSIONS } from '@saas/shared';
import { z } from 'zod';
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

const MAX_EMAIL_RECIPIENTS = 10;
const AI_EMAIL_REFUSAL =
  "Your admin hasn't allowed automations to email AI-written text to customers. Send it to your team, or ask an admin to turn this on in Settings → AI.";
const emailSchema = z.string().email();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
          await resolveOwner(deps, ctx, 'send email');

          // Validate everything before sending anything.
          const recipients = [
            ...new Set(
              config.to
                .split(',')
                .map((r) => r.trim().toLowerCase())
                .filter(Boolean),
            ),
          ];
          if (recipients.length === 0) {
            throw ApplicationFailure.nonRetryable(
              'Send email has no recipients',
            );
          }
          if (recipients.length > MAX_EMAIL_RECIPIENTS) {
            throw ApplicationFailure.nonRetryable(
              `Send email supports at most ${MAX_EMAIL_RECIPIENTS} recipients, got ${recipients.length}`,
            );
          }
          for (const address of recipients) {
            if (!emailSchema.safeParse(address).success) {
              throw ApplicationFailure.nonRetryable(
                `"${address}" is not a valid email address`,
              );
            }
          }

          if (ctx.aiWritten) {
            const budget = await deps.ai.getBudgetStatus(ctx.tenantId);
            if (!budget.automationAiEmailToCustomers) {
              const team = new Set(
                await deps.users.findActiveEmails(ctx.tenantId),
              );
              if (recipients.some((r) => !team.has(r))) {
                throw ApplicationFailure.nonRetryable(AI_EMAIL_REFUSAL);
              }
            }
          }

          const html = escapeHtml(config.body).replace(/\r?\n/g, '<br>');
          for (const to of recipients) {
            // Per-recipient key: a Temporal retry after a partial send skips
            // the recipients that already went out. Provider errors propagate.
            await deps.idempotency.runOnce(
              ctx.tenantId,
              `automation:${ctx.executionId}:${ctx.nodeId}:mail:${to}`,
              async () => {
                await deps.mail.sendMail({
                  to,
                  subject: config.subject,
                  html,
                  text: config.body,
                });
                return { sent: true };
              },
            );
          }
          return { sent: recipients, provider: deps.mail.name };
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
