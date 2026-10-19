import { randomUUID } from 'node:crypto';
import { ApplicationFailure, Context } from '@temporalio/activity';
import { PERMISSIONS, type Permission } from '@saas/shared';
import { AiService } from '@/modules/ai/ai.service';
import {
  AiProviderError,
  type AiMessage,
  type AiToolResultContent,
} from '@/modules/ai/interfaces/ai-provider.interface';
import { AiBudgetExceededException } from '@/modules/ai/exceptions/ai-budget-exceeded.exception';
import { AuditService } from '@/modules/audit/audit.service';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { CustomObjectToolFactoryService } from '@/modules/custom-objects/services/custom-object-tool-factory.service';
import { CustomObjectsService } from '@/modules/custom-objects/services/custom-objects.service';
import { CustomRecordsService } from '@/modules/custom-objects/services/custom-records.service';
import type { CustomObjectDefinition } from '@/modules/custom-objects/entities/custom-object-definition.entity';
import { RbacService } from '@/modules/rbac/rbac.service';
import { ChannelProviderType } from '../../entities/channel-config.entity';
import { SkillRegistry } from '../../skills/skill.registry';
import { ToolExecutionPolicyService } from '../../skills/tool-execution-policy.service';
import { ChannelIdempotencyService } from '../../services/channel-idempotency.service';
import type { ChannelSkill, SkillContext } from '../../skills/skill.types';
import {
  APPROVED_ACTION_CHANGED,
  type AgentActivityCtx,
  type AgentHistoryEntry,
  type AgentReactActivities,
  type ToolCallSpec,
  type ToolExecutionResult,
} from './agent-react.activities';

/** The running activity's workflow id, or null when called outside an activity. */
const currentWorkflowId = (): string | null => {
  try {
    return Context.current().info.workflowExecution?.workflowId ?? null;
  } catch {
    return null;
  }
};

/** Stable across rounds and turns, so it sits in the cached prefix. */
const AGENT_SYSTEM_PROMPT = [
  "You are the assistant inside Kerf, a business management app. Work toward the user's goal using only the tools provided.",
  'Tools that change data may wait for the user to approve them. A tool result is the only confirmation that an action happened: never say an action succeeded until a tool result confirms it.',
  'If a tool returns an error or a question, explain it to the user or try another way.',
  'When you have what you need, or no tool fits, reply to the user in plain text without calling a tool.',
].join('\n');

const REFUSAL_ANSWER = "I can't help with that request.";
const NO_ANSWER = "I couldn't come up with an answer to that.";

/**
 * A rejected request (bad schema, refusal, cut-off output) or an exhausted
 * budget fails the same way on every attempt, so Temporal must not retry it:
 * each retry is another paid request.
 */
export function toPlannerFailure(err: unknown): unknown {
  if (err instanceof AiProviderError && !err.retryable) {
    return ApplicationFailure.nonRetryable(err.message, 'AiProviderError');
  }
  if (err instanceof AiBudgetExceededException) {
    return ApplicationFailure.nonRetryable(err.message, 'AiBudgetExceeded');
  }
  return err;
}

/**
 * The agent's history as provider messages: each assistant tool call is
 * followed by one user message holding all of that round's results.
 */
export function toAiMessages(history: AgentHistoryEntry[]): AiMessage[] {
  const messages: AiMessage[] = [];
  for (const entry of history) {
    if (entry.role === 'tool') {
      const block: AiToolResultContent = {
        type: 'tool_result',
        toolUseId: entry.toolCallId,
        content: entry.content,
        ...(entry.isError ? { isError: true } : {}),
      };
      const last = messages[messages.length - 1];
      if (
        last?.role === 'user' &&
        Array.isArray(last.content) &&
        last.content.every((b) => b.type === 'tool_result')
      ) {
        last.content.push(block);
      } else {
        messages.push({ role: 'user', content: [block] });
      }
    } else if (entry.role === 'assistant' && entry.toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: [
          ...(entry.content ? [{ type: 'text' as const, text: entry.content }] : []),
          ...entry.toolCalls.map((call) => ({
            type: 'tool_use' as const,
            id: call.id,
            name: call.name,
            input: call.args,
          })),
        ],
        ...(entry.raw ? { raw: entry.raw } : {}),
      });
    } else {
      messages.push({ role: entry.role, content: entry.content });
    }
  }
  // A conversation must open with the user; a trimmed history may not.
  while (messages[0]?.role === 'assistant') messages.shift();
  return messages;
}

const skillDomain = (name: string): string => {
  if (name.startsWith('work_order.')) return 'PRODUCTION';
  if (name.startsWith('purchase_order.')) return 'FINANCE';
  return 'SALES';
};

export function createAgentReactActivities(deps: {
  aiService: AiService;
  rbacService: RbacService;
  skillRegistry: SkillRegistry;
  auditService: AuditService;
  customObjectToolFactory: CustomObjectToolFactoryService;
  customObjectsService: CustomObjectsService;
  customRecordsService: CustomRecordsService;
  tenantContext: TenantContextService;
  idempotency: Pick<ChannelIdempotencyService, 'runOnce'>;
}): Omit<AgentReactActivities, 'emitAssistantEventActivity'> {
  const policy = new ToolExecutionPolicyService();

  const resolveSkills = async (
    ctx: Pick<AgentActivityCtx, 'organizationId' | 'userId' | 'surface'>,
    allowedDomains?: string[],
  ): Promise<{ skills: ChannelSkill<never>[]; permissions: Permission[] }> => {
    if (!ctx.userId) {
      return { skills: [], permissions: [] };
    }
    const access = await deps.rbacService.resolveAccess(
      ctx.userId,
      ctx.organizationId,
    );
    // No surface means an automation: assistant-only skills stay out.
    const skills = deps.skillRegistry.permittedFor(
      access.permissions,
      ctx.surface ?? 'automation',
    );
    return {
      skills:
        allowedDomains?.length
          ? skills.filter((skill) => allowedDomains.includes(skillDomain(skill.name)))
          : skills,
      permissions: access.permissions,
    };
  };

  const makeContext = (
    input: AgentActivityCtx,
    permissions: Permission[],
  ): SkillContext => ({
    organizationId: input.organizationId,
    userId: input.userId,
    message: input.message,
    permissions,
    provider: ChannelProviderType.EMAIL_RESEND,
    senderIdentifier: 'automation',
  });

  const findSkill = (
    skills: ChannelSkill<never>[],
    name: string,
  ): ChannelSkill<never> | undefined => skills.find((skill) => skill.name === name);

  const resolveTool = async (
    tool: ToolCallSpec,
    ctx: AgentActivityCtx,
  ) => {
    const { skills, permissions } = await resolveSkills(ctx);
    const skill = findSkill(skills, tool.name);
    if (!skill) {
      throw new Error(`Tool '${tool.name}' is unavailable or not authorized`);
    }
    const skillContext = makeContext(ctx, permissions);
    const args =
      tool.pinned || !skill.pinnedOnlySlots?.length
        ? tool.args
        : Object.fromEntries(
            Object.entries(tool.args).filter(([key]) => !skill.pinnedOnlySlots!.includes(key)),
          );
    const resolution = await skill.resolve(args, skillContext);
    return { skill, skillContext, resolution };
  };

  const resolveCustomObjectTool = async (
    toolName: string,
    ctx: Pick<AgentActivityCtx, 'organizationId' | 'userId'>,
  ): Promise<{ object: CustomObjectDefinition; permissions: Permission[] } | null> => {
    const isQuery = toolName.startsWith('query_custom_');
    const isCreate = toolName.startsWith('create_custom_');
    if (!isQuery && !isCreate) return null;

    const { permissions } = await resolveSkills(ctx);
    const requiredPermission = isQuery
      ? PERMISSIONS.CUSTOM_RECORD_READ
      : PERMISSIONS.CUSTOM_RECORD_CREATE;
    if (!permissions.includes(requiredPermission)) {
      throw new Error(`Tool '${toolName}' is unavailable or not authorized`);
    }

    const prefix = isQuery ? 'query_custom_' : 'create_custom_';
    const normalizeSlug = (slug: string) =>
      slug.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const objects = await deps.customObjectsService.list(ctx.organizationId);
    const object = objects.find(
      (candidate) => `${prefix}${normalizeSlug(candidate.slug)}` === toolName,
    );
    if (!object) {
      throw new Error(`Custom object tool '${toolName}' no longer exists`);
    }
    return { object, permissions };
  };

  return {
    async listAvailableTools(input) {
      return deps.tenantContext.runWithTenant(input.organizationId, async () => {
        const { skills, permissions } = await resolveSkills(input, input.allowedDomains);
        const availableTools: Array<{
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
        }> = skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          inputSchema: skill.jsonSchema,
        }));
        if (
          (!input.allowedDomains?.length ||
            input.allowedDomains.includes('CUSTOM_OBJECTS')) &&
          (permissions.includes(PERMISSIONS.CUSTOM_RECORD_READ) ||
            permissions.includes(PERMISSIONS.CUSTOM_RECORD_CREATE))
        ) {
          const objects = await deps.customObjectsService.list(input.organizationId);
          availableTools.push(
            ...deps.customObjectToolFactory
              .createDynamicTools(objects)
              .filter(
                (tool) =>
                  (tool.name.startsWith('query_custom_') &&
                    permissions.includes(PERMISSIONS.CUSTOM_RECORD_READ)) ||
                  (tool.name.startsWith('create_custom_') &&
                    permissions.includes(PERMISSIONS.CUSTOM_RECORD_CREATE)),
              )
              .map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.jsonSchema,
              })),
          );
        }
        return availableTools;
      });
    },

    async planReActTurn(input) {
      return deps.tenantContext.runWithTenant(input.organizationId, async () => {
        const result = await deps.aiService
          .generateWithTools(
            'automations.ai_agent',
            {
              system: AGENT_SYSTEM_PROMPT,
              tools: input.availableTools,
              messages: toAiMessages(input.conversationHistory),
              // Every round resends the same tools, instructions and history.
              cache: true,
            },
            {
              organizationId: input.organizationId,
              ...(input.userId ? { userId: input.userId } : {}),
            },
          )
          .catch((err: unknown) => {
            throw toPlannerFailure(err);
          });
        if (result.stopReason === 'refusal') {
          return { thought: '', model: result.model, finalAnswer: REFUSAL_ANSWER };
        }

        const knownNames = new Set(input.availableTools.map((tool) => tool.name));
        // Tool-call ids key approvals, event rows and tool results, so they
        // must be unique within a turn. Assigned here, inside the activity,
        // so the workflow sees them as recorded results.
        const seenIds = new Set<string>();
        let idsRewritten = false;
        const toolCalls: ToolCallSpec[] = [];
        const invalidToolCalls: Array<{ id: string; name: string }> = [];
        for (const call of result.toolCalls) {
          let id = call.id;
          if (!id || seenIds.has(id)) {
            id = randomUUID();
            idsRewritten = true;
          }
          seenIds.add(id);
          if (knownNames.has(call.name)) {
            toolCalls.push({ id, name: call.name, args: call.input ?? {} });
          } else {
            invalidToolCalls.push({ id, name: call.name });
          }
        }

        if (!toolCalls.length && !invalidToolCalls.length) {
          return {
            thought: '',
            model: result.model,
            finalAnswer: result.text || NO_ANSWER,
          };
        }
        return {
          thought: result.text,
          model: result.model,
          ...(toolCalls.length ? { toolCalls } : {}),
          ...(invalidToolCalls.length ? { invalidToolCalls } : {}),
          // A rewritten id no longer matches the provider's own record of
          // the turn, so the turn is rebuilt from the calls instead.
          ...(idsRewritten ? {} : { raw: result.raw }),
        };
      });
    },

    async executeToolActivity(
      tool: ToolCallSpec,
      ctx: AgentActivityCtx,
    ): Promise<ToolExecutionResult> {
      return deps.tenantContext.runWithTenant(ctx.organizationId, async () => {
        const customTool = await resolveCustomObjectTool(tool.name, ctx);
        if (customTool) {
          const isQuery = tool.name.startsWith('query_custom_');
          if (isQuery) {
            const result = await deps.customRecordsService.list(
              ctx.organizationId,
              customTool.object.slug,
              { search: tool.args.search, limit: tool.args.limit },
              { id: ctx.userId, permissions: customTool.permissions },
            );
            return {
              toolCallId: tool.id,
              toolName: tool.name,
              isMutating: false,
              requiresApproval: false,
              output: { items: result.items, total: result.total },
            };
          }
          return {
            toolCallId: tool.id,
            toolName: tool.name,
            isMutating: true,
            requiresApproval: true,
            previewPayload: {
              summary: `Create ${customTool.object.singularName} in ${customTool.object.name}`,
              values: tool.args,
            },
          };
        }

        const { skill, skillContext, resolution } = await resolveTool(tool, ctx);
        if (resolution.kind === 'question') {
          return {
            toolCallId: tool.id,
            toolName: tool.name,
            isMutating: false,
            requiresApproval: false,
            output: { reply: resolution.question, slots: resolution.slots },
          };
        }
        if (resolution.kind === 'refused') {
          return {
            toolCallId: tool.id,
            toolName: tool.name,
            isMutating: false,
            requiresApproval: false,
            output: { error: resolution.reason },
          };
        }

        const isMutating = skill.isMutating !== false;
        const evaluation = policy.evaluatePolicy(tool.name, isMutating);
        if (evaluation.requiresApproval) {
          return {
            toolCallId: tool.id,
            toolName: tool.name,
            isMutating,
            requiresApproval: true,
            previewPayload: {
              summary: await skill.preview(resolution.value, skillContext),
            },
            ...(skill.pinArgs
              ? { resolvedArgs: skill.pinArgs(resolution.value) }
              : {}),
          };
        }

        const run = async (): Promise<ToolExecutionResult> => {
          const outcome = await skill.execute(resolution.value, skillContext);
          return {
            toolCallId: tool.id,
            toolName: tool.name,
            isMutating,
            requiresApproval: false,
            output: {
              reply: outcome.reply,
              resultType: outcome.resultType,
              resultId: outcome.resultId,
            },
          };
        };
        if (!isMutating) return run();

        // This activity is retried (maximumAttempts 3), including after an
        // attempt that timed out while the skill was still running. The tool
        // call id is fixed in workflow history, so (workflow, tool call)
        // names this one execution: a retry gets the recorded result back
        // instead of creating the record a second time.
        const workflowId = currentWorkflowId();
        if (!workflowId) return run();
        return deps.idempotency.runOnce(
          ctx.organizationId,
          `agent-react:tool:${workflowId}:${tool.id}`,
          run,
        );
      });
    },

    async commitToolMutationActivity(tool, ctx) {
      return deps.tenantContext.runWithTenant(ctx.organizationId, async () => {
        const customTool = await resolveCustomObjectTool(tool.name, ctx);
        if (customTool) {
          if (!tool.name.startsWith('create_custom_')) {
            throw new Error(
              `Tool '${tool.name}' is read-only and cannot be committed`,
            );
          }
          const record = await deps.customRecordsService.create(
            ctx.organizationId,
            customTool.object.slug,
            { values: tool.args },
            { id: ctx.userId, permissions: customTool.permissions },
          );
          await deps.auditService.record({
            tenantId: ctx.organizationId,
            action: 'custom_record.created',
            subjectType: customTool.object.slug,
            subjectId: record.id,
            actorId: ctx.userId,
            summary: `Created ${customTool.object.singularName} via AI`,
            origin: 'AI_ASSISTED',
            channel: ctx.audit?.channel ?? 'SYSTEM',
            messageId: ctx.audit?.messageId ?? null,
            model: tool.model,
            promptVersion: 'custom-object/1',
          });
          return {
            success: true,
            resultSummary: `Created ${customTool.object.singularName} record ${record.id}.`,
          };
        }

        const { skill, skillContext, resolution } = await resolveTool(tool, ctx);
        if (resolution.kind !== 'resolved') {
          throw new Error(`Tool '${tool.name}' is no longer ready to execute`);
        }
        if (skill.isMutating === false) {
          throw new Error(
            `Tool '${tool.name}' is read-only and cannot be committed`,
          );
        }
        if (ctx.approvedPreview) {
          const current = await skill.preview(resolution.value, skillContext);
          if (current !== ctx.approvedPreview.summary) {
            throw ApplicationFailure.nonRetryable(
              'This action changed since you approved it — ask again.',
              APPROVED_ACTION_CHANGED,
            );
          }
        }
        const outcome = await skill.execute(resolution.value, skillContext);
        await deps.auditService.record({
          tenantId: ctx.organizationId,
          action: `${skill.name}.executed`,
          subjectType: outcome.resultType ?? skill.name,
          subjectId: outcome.resultId,
          actorId: ctx.userId,
          summary: outcome.reply,
          origin: 'AI_ASSISTED',
          channel: ctx.audit?.channel ?? 'SYSTEM',
          messageId: ctx.audit?.messageId ?? null,
          model: tool.model,
          promptVersion: skill.promptVersion,
        });
        return {
          success: true,
          resultSummary: outcome.reply,
        };
      });
    },
  };
}
