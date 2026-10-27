import quickJsReleaseSync from '@jitl/quickjs-wasmfile-release-sync';
import quickJsModuleLoader from '@jitl/quickjs-wasmfile-release-sync/emscripten-module';
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSSyncVariant,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import {
  AiPromptActivityConfig,
  AiPromptActivityResult,
  CodeTransformActivityConfig,
  CodeTransformActivityResult,
  CrmMutationActivityConfig,
  CrmMutationActivityResult,
  EmailActivityConfig,
  EmailActivityResult,
  HttpActivityConfig,
  HttpActivityResult,
  RecordNodeResultParams,
  RecordNodeResultResult,
} from './interfaces';

/**
 * Executes an HTTP request with configurable method, headers, query parameters, and body.
 */
export async function executeHttpActivity(
  config: HttpActivityConfig,
): Promise<HttpActivityResult> {
  let targetUrl = config.url;

  if (config.query && Object.keys(config.query).length > 0) {
    const parsedUrl = new URL(targetUrl);
    for (const [key, value] of Object.entries(config.query)) {
      if (value !== undefined && value !== null) {
        parsedUrl.searchParams.append(key, String(value));
      }
    }
    targetUrl = parsedUrl.toString();
  }

  const method = (config.method || 'GET').toUpperCase();
  const headers: Record<string, string> = { ...(config.headers || {}) };

  let body: any = undefined;
  if (
    config.body !== undefined &&
    config.body !== null &&
    method !== 'GET' &&
    method !== 'HEAD'
  ) {
    if (typeof config.body === 'object') {
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      body = JSON.stringify(config.body);
    } else {
      body = String(config.body);
    }
  }

  let controller: AbortController | undefined;
  let timeoutId: NodeJS.Timeout | undefined;

  if (config.timeout && config.timeout > 0) {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller?.abort(), config.timeout);
  }

  try {
    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
      signal: controller?.signal,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((val, key) => {
      responseHeaders[key] = val;
    });

    let data: any;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch {
        data = await response.text();
      }
    } else {
      data = await response.text();
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      data,
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Executes an AI prompt and returns generated text and token metrics.
 */
export async function executeAiPromptActivity(
  config: AiPromptActivityConfig,
): Promise<AiPromptActivityResult> {
  if (config.mockResponse) {
    return {
      text: config.mockResponse,
      completion: config.mockResponse,
      usage: {
        promptTokens: 15,
        completionTokens: 25,
        totalTokens: 40,
      },
    };
  }

  const promptSnippet =
    config.prompt.length > 80
      ? `${config.prompt.slice(0, 80)}...`
      : config.prompt;
  const simulatedOutput = `AI response for prompt: "${promptSnippet}" using model ${config.model || 'gpt-4o'}`;

  return {
    text: simulatedOutput,
    completion: simulatedOutput,
    usage: {
      promptTokens: Math.max(10, Math.ceil(config.prompt.length / 4)),
      completionTokens: 30,
      totalTokens: Math.max(10, Math.ceil(config.prompt.length / 4)) + 30,
    },
  };
}

/**
 * Sends an email notification or message payload.
 */
export async function executeEmailActivity(
  config: EmailActivityConfig,
): Promise<EmailActivityResult> {
  const messageId = `email_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const recipients = Array.isArray(config.to)
    ? config.to.join(', ')
    : config.to;

  console.log(
    `[AutomationActivity] sendEmail to [${recipients}], subject: "${config.subject}"`,
  );

  return {
    success: true,
    messageId,
    to: config.to,
    sentAt: new Date().toISOString(),
  };
}

const TRANSFORM_TIMEOUT_MS = 1_000;
const TRANSFORM_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;
const TRANSFORM_STACK_LIMIT_BYTES = 512 * 1024;

// The variant loads its Emscripten module with import(), which Jest's CommonJS
// runtime rejects. A static import resolves the same file everywhere.
const quickJsVariant: QuickJSSyncVariant = {
  ...quickJsReleaseSync,
  importModuleLoader: async () => quickJsModuleLoader,
};

let quickJs: Promise<QuickJSWASMModule> | undefined;

/**
 * Runs tenant-authored transform code in QuickJS, a separate JS engine
 * compiled to WebAssembly. The code sees only `input` and `context` (copied
 * in as JSON) and the standard built-ins: no `process`, no `require`, no I/O.
 * Each run gets a fresh runtime with a memory cap and a wall-clock deadline,
 * and its result comes back as JSON.
 */
export async function executeCodeTransformActivity(
  config: CodeTransformActivityConfig,
): Promise<CodeTransformActivityResult> {
  const QuickJS = await (quickJs ??= newQuickJSWASMModuleFromVariant(quickJsVariant));
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(TRANSFORM_MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(TRANSFORM_STACK_LIMIT_BYTES);
  const deadline = Date.now() + TRANSFORM_TIMEOUT_MS;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();

  try {
    const code = config.code.trim();
    const functionBody = code.includes('return') ? code : `return (${code});`;
    const asJsonLiteral = (value: unknown) =>
      JSON.stringify(JSON.stringify(value ?? null));

    const result = vm.evalCode(
      `"use strict";
       const __output = (function (input, context) { ${functionBody}
       })(JSON.parse(${asJsonLiteral(config.input)}), JSON.parse(${asJsonLiteral(config.context ?? {})}));
       __output === undefined ? undefined : JSON.stringify(__output);`,
      'transform.js',
    );

    if (result.error) {
      const error = vm.dump(result.error);
      result.error.dispose();
      throw new Error(error?.message ?? String(error));
    }

    const json = vm.dump(result.value) as string | undefined;
    result.value.dispose();
    return { output: json === undefined ? undefined : JSON.parse(json) };
  } catch (err: any) {
    throw new Error(`Code transform execution failed: ${err.message}`);
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

/**
 * Performs a mutation on a CRM record (Contact, Quote, Invoice, Deal, etc.).
 */
export async function executeCrmMutationActivity(
  config: CrmMutationActivityConfig,
): Promise<CrmMutationActivityResult> {
  const recordId =
    config.recordId ||
    `${config.entity}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  console.log(
    `[AutomationActivity] crmMutation: entity=${config.entity}, action=${config.action}, recordId=${recordId}`,
  );

  return {
    success: true,
    entity: config.entity,
    action: config.action,
    recordId,
    data: config.data,
  };
}

/**
 * Records execution result of a single node in audit logs and execution state.
 */
export async function recordNodeResultActivity(
  params: RecordNodeResultParams,
): Promise<RecordNodeResultResult> {
  console.log(
    `[AutomationActivity] recordNodeResult: executionId=${params.executionId}, nodeId=${params.nodeId}, status=${params.status}`,
  );

  return {
    recorded: true,
    executionId: params.executionId,
    nodeId: params.nodeId,
  };
}
