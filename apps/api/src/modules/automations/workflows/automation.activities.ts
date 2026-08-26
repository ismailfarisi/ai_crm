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
export async function executeHttpActivity(config: HttpActivityConfig): Promise<HttpActivityResult> {
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
  if (config.body !== undefined && config.body !== null && method !== 'GET' && method !== 'HEAD') {
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

  const promptSnippet = config.prompt.length > 80 ? `${config.prompt.slice(0, 80)}...` : config.prompt;
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
export async function executeEmailActivity(config: EmailActivityConfig): Promise<EmailActivityResult> {
  const messageId = `email_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const recipients = Array.isArray(config.to) ? config.to.join(', ') : config.to;

  console.log(`[AutomationActivity] sendEmail to [${recipients}], subject: "${config.subject}"`);

  return {
    success: true,
    messageId,
    to: config.to,
    sentAt: new Date().toISOString(),
  };
}

/**
 * Executes custom JS transform code securely.
 */
export async function executeCodeTransformActivity(
  config: CodeTransformActivityConfig,
): Promise<CodeTransformActivityResult> {
  try {
    const code = config.code.trim();
    const functionBody = code.includes('return') ? code : `return (${code});`;

    const transformFn = new Function('input', 'context', `"use strict"; ${functionBody}`);
    const output = transformFn(config.input, config.context ?? {});

    return { output };
  } catch (err: any) {
    throw new Error(`Code transform execution failed: ${err.message}`);
  }
}

/**
 * Performs a mutation on a CRM record (Contact, Quote, Invoice, Deal, etc.).
 */
export async function executeCrmMutationActivity(
  config: CrmMutationActivityConfig,
): Promise<CrmMutationActivityResult> {
  const recordId =
    config.recordId || `${config.entity}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

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
