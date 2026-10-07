export interface ToolCallSpec {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  isMutating: boolean;
  requiresApproval: boolean;
  previewPayload?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorMessage?: string;
}

export interface ReActTurnInput {
  organizationId: string;
  userId: string;
  prompt: string;
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>;
  availableTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

export interface ReActTurnOutput {
  thought: string;
  toolCalls?: ToolCallSpec[];
  finalAnswer?: string;
}

export interface AgentReactActivities {
  planReActTurn(input: ReActTurnInput): Promise<ReActTurnOutput>;
  executeToolActivity(
    tool: ToolCallSpec,
    ctx: { organizationId: string; userId: string },
  ): Promise<ToolExecutionResult>;
  commitToolMutationActivity(
    tool: ToolCallSpec,
    ctx: { organizationId: string; userId: string },
  ): Promise<{ success: boolean; resultSummary: string }>;
}
