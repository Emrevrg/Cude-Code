import chalk from 'chalk';
import { selectProviderAndModel, type TaskType } from './selector.js';
import { executeTool, TOOL_DEFINITIONS, setConfirmCallback, formatToolCall, formatToolResult } from './tools.js';
import { recordSpending } from '../storage/budget.js';
import { checkBudgetAlert } from '../storage/budget.js';
import type { Message } from '../providers/types.js';
import { validateTurnSequence } from '../providers/wire.js';
import { MODELS } from '../config/models.js';
import { formatProjectContext, formatProjectSkills, loadProjectContext, loadProjectSkills } from './context.js';

export interface AgentOptions {
  task: string;
  taskType?: TaskType;
  free?: boolean;
  provider?: string;
  model?: string;
  maxIterations?: number;
  verbose?: boolean;
  onProgress?: (step: string) => void;
  onConfirm?: (message: string) => Promise<boolean>;
}

/**
 * Why the loop stopped. `completed` is the only reason that can produce
 * `success: true` — every other value means the agent was cut short and the
 * caller must treat the run as a failure.
 */
export type AgentStopReason =
  | 'completed'
  | 'max_iterations'
  | 'budget_exceeded'
  | 'empty_output';

export interface AgentResult {
  success: boolean;
  stopReason: AgentStopReason;
  output: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  iterations: number;
  steps: AgentStep[];
}

/**
 * How much of a tool's output reaches the model. The old limits — 500 chars in
 * the tools loop, 1000 in the ReAct loop — cut a `npm test` result off mid-word
 * with nothing to say anything had been dropped, so the model reasoned from a
 * fragment it believed was complete.
 */
export const TOOL_RESULT_MAX_CHARS = 8000;
/** The ReAct loop re-sends the whole transcript each turn, so it keeps less. */
export const REACT_TOOL_RESULT_MAX_CHARS = 4000;

export function truncateToolOutput(output: string, limit: number): string {
  if (output.length <= limit) return output;
  return (
    output.substring(0, limit) +
    `\n... [truncated, showed ${limit} of ${output.length} chars]`
  );
}

/**
 * Whether a run costs money. The budget gate used to run before every
 * iteration regardless of provider, so a $0 limit — or a spent-out monthly cap
 * — stopped local vLLM and Ollama agents dead even though they charge nothing.
 *
 * The provider's own declared cost class is the source of truth.
 */
export function isFreeOrLocal(
  provider: import('../providers/types.js').Provider,
  model: string
): boolean {
  if (provider.costClass === 'local' || provider.costClass === 'free') return true;
  const catalogued = MODELS[model];
  if (catalogued) return catalogued.free || catalogued.local;
  const listed = provider.listModels().find(m => m.id === model);
  if (listed) return listed.free || listed.local;
  return false;
}

export const STOP_REASON_MESSAGES: Record<AgentStopReason, string> = {
  completed: 'The model finished the task.',
  max_iterations: 'Hit the iteration limit before the model finished. Raise --max-iterations or narrow the task.',
  budget_exceeded: 'Stopped by the spending limit. Raise it with "cude budget set" or clear it with "cude budget unset --all".',
  empty_output: 'The model stopped without producing any output.',
};

/**
 * A run only succeeded if the model itself decided it was done *and* it left
 * something behind. Returning `success: true` for an exhausted loop made
 * failure indistinguishable from success in CI.
 */
function finalize(
  stopReason: AgentStopReason,
  output: string,
  rest: Omit<AgentResult, 'success' | 'stopReason' | 'output'>
): AgentResult {
  const trimmed = output.trim();
  const reason: AgentStopReason =
    stopReason === 'completed' && trimmed.length === 0 ? 'empty_output' : stopReason;
  return {
    success: reason === 'completed',
    stopReason: reason,
    output,
    ...rest,
  };
}

export interface AgentStep {
  type: 'thought' | 'tool_call' | 'tool_result' | 'final';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

const AGENT_SYSTEM_PROMPT = `You are an autonomous AI agent with access to 22 tools for completing tasks.
You can read/write/modify files, execute commands, manage directories, automate browsers, and search local codebases with RAG.

When given a task:
1. Analyze what needs to be done
2. Break it into steps
3. Use the available tools to complete each step
4. Report the final result

Important guidelines:
- Always verify files exist before trying to read them
- Create directories before writing files in them
- For shell commands, prefer simple, safe commands
- Use browser tools to navigate, screenshot, or extract web content
- Use RAG tools to index and search local codebases for relevant code
- Provide clear explanations of what you're doing
- When the task is complete, provide a summary of what was accomplished

When you have completed the task, start your final response with "TASK COMPLETE:" followed by a summary.`;

function getAgentSystemPrompt(): string {
  return AGENT_SYSTEM_PROMPT + formatProjectContext(loadProjectContext()) + formatProjectSkills(loadProjectSkills());
}

export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const {
    taskType = 'code',
    free = false,
    provider: preferredProvider,
    model: preferredModel,
    maxIterations = 10,
    verbose = false,
    onConfirm,
  } = options;

  if (onConfirm) {
    setConfirmCallback(onConfirm);
  }

  const { provider, model, reason } = selectProviderAndModel(taskType, {
    free,
    preferredProvider,
    preferredModel,
  });
  if (verbose) {
    console.log(chalk.dim(`  Using ${provider.displayName} / ${model} (${reason})`));
  }

  if (!provider.supportsTools() && provider.name !== 'ollama') {
    // For providers without native tool support, use ReAct-style prompting
    return runReActAgent(provider, model, options, maxIterations);
  }

  if (provider.supportsTools() && provider.chatWithTools) {
    return runToolsAgent(provider, model, options, maxIterations);
  }

  return runReActAgent(provider, model, options, maxIterations);
}

async function runToolsAgent(
  provider: import('../providers/types.js').Provider,
  model: string,
  options: AgentOptions,
  maxIterations: number
): Promise<AgentResult> {
  const messages: Message[] = [
    { role: 'user', content: options.task },
  ];

  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let iterations = 0;
  const steps: AgentStep[] = [];
  let finalOutput = '';
  let stopReason: AgentStopReason = 'max_iterations';

  // A free or local provider costs nothing, so a spending limit has no bearing
  // on it — checking one only takes the agent away from someone at their cap.
  const budgetApplies = !isFreeOrLocal(provider, model);

  while (iterations < maxIterations) {
    iterations++;

    // Check budget
    if (budgetApplies) {
      const budgetCheck = checkBudgetAlert();
      if (budgetCheck.exceeded) {
        finalOutput = `Budget exceeded: ${budgetCheck.message}`;
        stopReason = 'budget_exceeded';
        break;
      }
    }

    options.onProgress?.(`Step ${iterations}: Thinking...`);

    // A malformed turn sequence is a bug in this loop, not a model problem —
    // fail loudly rather than shipping a request that means something else.
    const violation = validateTurnSequence(messages);
    if (violation) {
      throw new Error(`Refusing to send a malformed conversation: ${violation}`);
    }

    const { response, toolCalls } = await provider.chatWithTools!(
      messages,
      model,
      TOOL_DEFINITIONS,
      { systemPrompt: getAgentSystemPrompt(), maxTokens: 4096 }
    );

    totalCost += response.cost;
    totalInputTokens += response.inputTokens;
    totalOutputTokens += response.outputTokens;

    recordSpending(provider.name, model, response.cost, response.inputTokens, response.outputTokens);

    if (response.content) {
      steps.push({ type: 'thought', content: response.content });
      if (options.verbose) {
        console.log(chalk.cyan('\n  Agent: ') + response.content);
      }
    }

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      finalOutput = response.content;
      stopReason = 'completed';
      break;
    }

    // The assistant message carries the calls it made, so the model can see the
    // arguments it chose; each result then comes back as its own tool message.
    messages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: toolCalls,
    });

    // Execute tool calls
    for (const toolCall of toolCalls) {
      options.onProgress?.(`Step ${iterations}: Running ${toolCall.name}...`);

      if (options.verbose) {
        console.log(formatToolCall(toolCall.name, toolCall.arguments));
      }

      steps.push({
        type: 'tool_call',
        content: `${toolCall.name}(${JSON.stringify(toolCall.arguments)})`,
        toolName: toolCall.name,
        toolArgs: toolCall.arguments,
      });

      const result = await executeTool(toolCall.name, toolCall.arguments);

      if (options.verbose) {
        console.log(formatToolResult(result));
      }

      steps.push({
        type: 'tool_result',
        content: result.success ? result.output : `Error: ${result.error}`,
      });

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.name,
        content: result.success
          ? truncateToolOutput(result.output, TOOL_RESULT_MAX_CHARS)
          : `ERROR: ${result.error}`,
      });
    }

    // Check if task is complete
    if (response.content.includes('TASK COMPLETE:') || response.content.includes('Task complete:')) {
      finalOutput = response.content;
      stopReason = 'completed';
      break;
    }
  }

  steps.push({ type: 'final', content: finalOutput });

  return finalize(stopReason, finalOutput, {
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    iterations,
    steps,
  });
}

async function runReActAgent(
  provider: import('../providers/types.js').Provider,
  model: string,
  options: AgentOptions,
  maxIterations: number
): Promise<AgentResult> {
  const toolDescriptions = TOOL_DEFINITIONS.map(t =>
    `- ${t.name}: ${t.description}`
  ).join('\n');

  const systemPrompt = `${getAgentSystemPrompt()}

Available tools:
${toolDescriptions}

To use a tool, respond with:
TOOL: tool_name
ARGS: {"arg1": "value1", "arg2": "value2"}

After getting the tool result, continue with your next step or final answer.
When done, start with "TASK COMPLETE:" to finish.`;

  const messages: Message[] = [
    { role: 'user', content: `Task: ${options.task}` },
  ];

  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let iterations = 0;
  const steps: AgentStep[] = [];
  let finalOutput = '';
  let stopReason: AgentStopReason = 'max_iterations';

  const budgetApplies = !isFreeOrLocal(provider, model);

  while (iterations < maxIterations) {
    iterations++;

    if (budgetApplies) {
      const budgetCheck = checkBudgetAlert();
      if (budgetCheck.exceeded) {
        finalOutput = `Budget exceeded: ${budgetCheck.message}`;
        stopReason = 'budget_exceeded';
        break;
      }
    }

    options.onProgress?.(`Step ${iterations}: Thinking...`);

    const response = await provider.chat(messages, model, {
      systemPrompt,
      maxTokens: 2048,
    });

    totalCost += response.cost;
    totalInputTokens += response.inputTokens;
    totalOutputTokens += response.outputTokens;

    recordSpending(provider.name, model, response.cost, response.inputTokens, response.outputTokens);

    const content = response.content;

    if (options.verbose) {
      console.log(chalk.cyan('\n  Agent: ') + content.substring(0, 200));
    }

    // Parse tool call
    const toolMatch = content.match(/TOOL:\s*(\w+)\s*\nARGS:\s*(\{[\s\S]*?\})/);
    if (toolMatch) {
      const toolName = toolMatch[1];
      let toolArgs: Record<string, unknown> = {};

      try {
        toolArgs = JSON.parse(toolMatch[2]) as Record<string, unknown>;
      } catch {
        toolArgs = {};
      }

      steps.push({
        type: 'tool_call',
        content: `${toolName}(${JSON.stringify(toolArgs)})`,
        toolName,
        toolArgs,
      });

      options.onProgress?.(`Step ${iterations}: Running ${toolName}...`);
      if (options.verbose) {
        console.log(formatToolCall(toolName, toolArgs));
      }

      const result = await executeTool(toolName, toolArgs);

      if (options.verbose) {
        console.log(formatToolResult(result));
      }

      const resultText = result.success
        ? truncateToolOutput(result.output, REACT_TOOL_RESULT_MAX_CHARS)
        : `Error: ${result.error}`;

      steps.push({ type: 'tool_result', content: resultText });

      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: `Tool result for ${toolName}:\n${resultText}\n\nContinue with the next step.`,
      });
    } else {
      // No tool call - either thinking or final
      steps.push({ type: 'thought', content });

      // Running out of iterations is not the same as finishing: the old
      // `iterations >= maxIterations - 1` clause here reported an exhausted
      // loop as a completed task.
      if (content.includes('TASK COMPLETE:') || content.includes('Task complete:')) {
        finalOutput = content;
        stopReason = 'completed';
        messages.push({ role: 'assistant', content });
        break;
      }

      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: 'Continue to the next step.' });
    }
  }

  if (!finalOutput) {
    // Surface whatever the model last said so the caller has something to show,
    // but leave stopReason alone — this is not a completed run.
    finalOutput = messages[messages.length - 1]?.content ?? '';
  }

  steps.push({ type: 'final', content: finalOutput });

  return finalize(stopReason, finalOutput, {
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    iterations,
    steps,
  });
}
