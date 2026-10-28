import { HttpException, NotFoundException } from '@nestjs/common';
import { ApplicationFailure } from '@temporalio/activity';
import {
  AUTOMATION_PERMISSIONS,
  PERMISSIONS,
  createContactSchema,
  updateContactSchema,
  type Permission,
} from '@saas/shared';
import { z } from 'zod';
import { AUDIT_SUBJECTS } from '@/modules/audit/audit-subjects';
import { AiBudgetExceededException } from '@/modules/ai/exceptions/ai-budget-exceeded.exception';
import { AiNotConfiguredException } from '@/modules/ai/interfaces/ai-provider.interface';
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
const AI_NOT_CONFIGURED =
  "AI isn't set up for this organisation. Add a provider in Settings → AI.";
const emailSchema = z.string().email();

/**
 * Interpolation can turn a field into a number, an object or null; every text
 * field is read as text before it is validated.
 */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

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
  contacts: Pick<ContactsService, 'create' | 'update' | 'findOne'>;
  quotes: Pick<QuotesService, 'sendSignal' | 'findQuoteById'>;
  users: Pick<UsersService, 'findMember' | 'findActiveEmails'>;
  rbac: Pick<RbacService, 'resolveAccess'>;
  audit: Pick<AuditService, 'record'>;
  tenantContext: Pick<TenantContextService, 'runAsAutomation'>;
  idempotency: Pick<ChannelIdempotencyService, 'runOnce'>;
}

/** The one wording for "the owner can't do this any more", naming what is missing. */
function ownerCannot(
  who: string,
  actionLabel: string,
  missingPermission?: string,
): ApplicationFailure {
  const missing = missingPermission ? ` (missing ${missingPermission})` : '';
  return ApplicationFailure.nonRetryable(
    `${who} can no longer ${actionLabel}${missing}; reactivate the automation as someone who can`,
  );
}

interface CrmStep {
  /** Completes "<owner> can no longer ...". */
  label: string;
  permission: Permission;
  /** Past tense for the audit summary. */
  verb: string;
  needsRecord: boolean;
  auditSubject: string;
}

/** Every entity/action pair the Update CRM record step supports. */
const CRM_STEPS: Record<string, CrmStep> = {
  'contact.create': {
    label: 'create contacts',
    permission: PERMISSIONS.CONTACT_CREATE,
    verb: 'created',
    needsRecord: false,
    auditSubject: AUDIT_SUBJECTS.contacts.subject,
  },
  'contact.update': {
    label: 'update contacts',
    permission: PERMISSIONS.CONTACT_UPDATE,
    verb: 'updated',
    needsRecord: true,
    auditSubject: AUDIT_SUBJECTS.contacts.subject,
  },
  'quote.approve': {
    label: 'approve quotes',
    permission: PERMISSIONS.QUOTE_APPROVE,
    verb: 'approved',
    needsRecord: true,
    auditSubject: AUDIT_SUBJECTS.quotes.subject,
  },
  'quote.reject': {
    label: 'reject quotes',
    permission: PERMISSIONS.QUOTE_APPROVE,
    verb: 'rejected',
    needsRecord: true,
    auditSubject: AUDIT_SUBJECTS.quotes.subject,
  },
};

/**
 * Validates contact fields with the same schemas the API uses, rejecting keys
 * the schema doesn't know. An update keeps only the fields the step named:
 * the partial schema would otherwise fill in `status`/`source` defaults and
 * silently reset them.
 */
function parseContactFields(
  action: 'create' | 'update',
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const input = fields ?? {};
  const schema =
    action === 'create'
      ? createContactSchema.strict()
      : updateContactSchema.strict();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue.code === 'unrecognized_keys') {
      throw ApplicationFailure.nonRetryable(
        `Contacts have no field ${issue.keys.map((k) => `"${k}"`).join(', ')}`,
      );
    }
    const field = issue.path.join('.');
    throw ApplicationFailure.nonRetryable(
      field
        ? `Contact field "${field}" is invalid: ${issue.message}`
        : `Contact fields are invalid: ${issue.message}`,
    );
  }
  if (action === 'create') return parsed.data;

  const named = Object.fromEntries(
    Object.entries(parsed.data).filter(([key]) => Object.hasOwn(input, key)),
  );
  if (Object.keys(named).length === 0) {
    throw ApplicationFailure.nonRetryable(
      'Update contact has no fields to change',
    );
  }
  return named;
}

/** Temporal payloads and idempotency storage are JSON: Dates become ISO strings. */
function toJson(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
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
  if (!user || !user.isActive) {
    throw ownerCannot(user?.email ?? 'The automation owner', actionLabel);
  }

  const access = await deps.rbac.resolveAccess(user.id, user.tenantId);
  if (!access.permissions.includes(AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE)) {
    throw ownerCannot(
      user.email,
      actionLabel,
      AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE,
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
          const to = asText(config.to);
          const subject = asText(config.subject);
          const body = asText(config.body);

          // Validate everything before sending anything.
          const recipients = [
            ...new Set(
              to
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

          const html = escapeHtml(body).replace(/\r?\n/g, '<br>');
          for (const recipient of recipients) {
            // Per-recipient key: a Temporal retry after a partial send skips
            // the recipients that already went out. Provider errors propagate.
            await deps.idempotency.runOnce(
              ctx.tenantId,
              `automation:${ctx.executionId}:${ctx.nodeId}:mail:${recipient}`,
              async () => {
                await deps.mail.sendMail({
                  to: recipient,
                  subject,
                  html,
                  text: body,
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
          const owner = await resolveOwner(deps, ctx, 'run an AI prompt');

          const prompt = asText(config.prompt);
          if (!prompt.trim()) {
            throw ApplicationFailure.nonRetryable('The AI prompt is empty');
          }
          if (!(await deps.ai.isConfigured(ctx.tenantId))) {
            throw ApplicationFailure.nonRetryable(AI_NOT_CONFIGURED);
          }

          // No idempotency wrapper: re-running a prompt on retry is cheaper
          // than storing large outputs.
          try {
            const res = await deps.ai.generateText(
              'automation.prompt',
              { messages: [{ role: 'user', content: prompt }] },
              { organizationId: ctx.tenantId, userId: owner.id },
            );
            return {
              text: res.text,
              model: res.model,
              usage: {
                inputTokens: res.usage.inputTokens,
                outputTokens: res.usage.outputTokens,
              },
            };
          } catch (err) {
            if (err instanceof AiNotConfiguredException) {
              throw ApplicationFailure.nonRetryable(AI_NOT_CONFIGURED);
            }
            if (err instanceof AiBudgetExceededException) {
              throw ApplicationFailure.nonRetryable(err.message);
            }
            throw err;
          }
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
          const { entity, action } = config;
          const key = `${entity}.${action}`;
          const step = Object.hasOwn(CRM_STEPS, key)
            ? CRM_STEPS[key]
            : undefined;
          const owner = await resolveOwner(
            deps,
            ctx,
            step?.label ?? 'update CRM records',
          );

          if (!step) {
            throw ApplicationFailure.nonRetryable(
              `Update CRM record cannot ${action} a ${entity}`,
            );
          }
          const recordId = config.recordId?.trim() ?? '';
          if (step.needsRecord && !recordId) {
            throw ApplicationFailure.nonRetryable(
              `Update CRM record needs the id of the ${entity} record to ${action}`,
            );
          }
          if (!owner.permissions.includes(step.permission)) {
            throw ownerCannot(owner.email, step.label, step.permission);
          }
          const fields =
            entity === 'contact'
              ? parseContactFields(action as 'create' | 'update', config.fields)
              : undefined;

          const mutate = async (): Promise<{
            before: Record<string, unknown> | null;
            after: Record<string, unknown>;
          }> => {
            if (key === 'contact.create') {
              const created = await deps.contacts.create(
                owner,
                fields as never,
              );
              return { before: null, after: toJson(created) };
            }
            if (key === 'contact.update') {
              const before = toJson(
                await deps.contacts.findOne(owner, recordId),
              );
              const updated = await deps.contacts.update(
                owner,
                recordId,
                fields as never,
              );
              return { before, after: toJson(updated) };
            }
            const before = toJson(
              await deps.quotes.findQuoteById(ctx.tenantId, recordId),
            );
            await deps.quotes.sendSignal(
              ctx.tenantId,
              recordId,
              action === 'approve' ? 'APPROVE' : 'REJECT',
              action === 'reject' && config.reason
                ? { reason: config.reason }
                : undefined,
              owner.id,
              // Never waives a margin floor, whatever the owner may do.
              { automated: true },
            );
            const after = toJson(
              await deps.quotes.findQuoteById(ctx.tenantId, recordId),
            );
            return { before, after };
          };

          try {
            // The audit row is written inside the same once-only block, so a
            // retry neither repeats the change nor files it twice.
            return await deps.idempotency.runOnce(
              ctx.tenantId,
              `automation:${ctx.executionId}:${ctx.nodeId}:crm`,
              async (): Promise<CrmMutationActivityResult> => {
                const { before, after } = await mutate();
                const id = String(after.id);
                const labelField =
                  entity === 'contact' ? 'fullName' : 'quoteNumber';
                const named = after[labelField] ?? before?.[labelField];
                const label = typeof named === 'string' && named ? named : id;
                await deps.audit.record({
                  tenantId: ctx.tenantId,
                  action: `automation.${key}`,
                  subjectType: step.auditSubject,
                  subjectId: id,
                  actorId: owner.id,
                  actorName:
                    [owner.firstName, owner.lastName]
                      .filter(Boolean)
                      .join(' ')
                      .trim() || owner.email,
                  origin: 'HUMAN',
                  channel: 'SYSTEM',
                  messageId: `automation:${ctx.executionId}:${ctx.nodeId}`,
                  summary: `Automation "${ctx.workflowName}" ${step.verb} ${entity} ${label}`,
                  before,
                  after,
                });
                return { entity, action, recordId: id, record: after };
              },
            );
          } catch (err) {
            // Out of scope, refused by a floor or rule, or bad input: the
            // caller's fault, and a retry would get the same answer.
            if (err instanceof HttpException && err.getStatus() < 500) {
              throw ApplicationFailure.nonRetryable(err.message);
            }
            throw err;
          }
        },
      );
    },
  };
}
