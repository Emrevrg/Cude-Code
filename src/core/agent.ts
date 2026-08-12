import chalk from 'chalk';
import { selectProviderAndModel, type TaskType } from './selector.js';
import { executeTool, TOOL_DEFINITIONS, setConfirmCallback, formatToolCall, formatToolResult } from './tools.js';
import { recordSpending } from '../storage/budget.js';
import { checkBudgetAlert } from '../storage/budget.js';
import type { Message } from '../providers/types.js';

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

export interface AgentResult {
  success: boolean;
  stopReason: 'completed' | 'max_iterations' | 'budget_exceeded' | 'empty_output';
  output: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  iterations: number;
  steps: AgentStep[];
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
  let stopReason: AgentResult['stopReason'] = 'max_iterations';

  while (iterations < maxIterations) {
    iterations++;

    // Check budget
    const budgetCheck = checkBudgetAlert();
    if (budgetCheck.exceeded) {
      finalOutput = `Budget exceeded: ${budgetCheck.message}`;
      stopReason = 'budget_exceeded';
      break;
    }

    options.onProgress?.(`Step ${iterations}: Thinking...`);

    const { response, toolCalls } = await provider.chatWithTools!(
      messages,
      model,
      TOOL_DEFINITIONS,
      { systemPrompt: AGENT_SYSTEM_PROMPT, maxTokens: 4096 }
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
      stopReason = response.content.trim().length > 0 ? 'completed' : 'empty_output';
      break;
    }

    // Execute tool calls
    const toolResults: string[] = [];
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

      toolResults.push(
        `Tool: ${toolCall.name}\nResult: ${result.success ? result.output.substring(0, 500) : `ERROR: ${result.error}`}`
      );
    }

    // Add the assistant message carrying its tool_calls, then one role:'tool'
    // message per call keyed by tool_call_id so the provider can route results.
    messages.push({
      role: 'assistant',
      content: response.content ?? '',
      tool_calls: toolCalls,
    });
    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      messages.push({
        role: 'tool',
        content: toolResults[i],
        tool_call_id: toolCall.id,
      });
    }

    // Check if task is complete
    if (response.content.includes('TASK COMPLETE:') || response.content.includes('Task complete:')) {
      finalOutput = response.content;
      stopReason = 'completed';
      break;
    }
  }

  // Döngü tükenirse stopReason zaten 'max_iterations' (initial değer).
  // finalOutput boşsa ek bir sorun var ama yine de döngü tükenmiş sayılır.

  steps.push({ type: 'final', content: finalOutput });

  const success = stopReason === 'completed' && finalOutput.trim().length > 0;

  return {
    success,
    stopReason,
    output: finalOutput,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    iterations,
    steps,
  };
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

  const systemPrompt = `${AGENT_SYSTEM_PROMPT}

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
  let stopReason: AgentResult['stopReason'] = 'max_iterations';

  while (iterations < maxIterations) {
    iterations++;

    const budgetCheck = checkBudgetAlert();
    if (budgetCheck.exceeded) {
      finalOutput = `Budget exceeded: ${budgetCheck.message}`;
      stopReason = 'budget_exceeded';
      break;
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
        ? result.output.substring(0, 1000)
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

      if (content.includes('TASK COMPLETE:') || content.includes('Task complete:') || iterations >= maxIterations - 1) {
        finalOutput = content;
        const isComplete = content.includes('TASK COMPLETE:') || content.includes('Task complete:');
        stopReason = isComplete
          ? (content.trim().length > 0 ? 'completed' : 'empty_output')
          : 'max_iterations';
        messages.push({ role: 'assistant', content });
        break;
      }

      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: 'Continue to the next step.' });
    }
  }

  if (!finalOutput) {
    finalOutput = messages[messages.length - 1]?.content ?? '';
  }

  steps.push({ type: 'final', content: finalOutput });

  const success = stopReason === 'completed' && finalOutput.trim().length > 0;

  return {
    success,
    stopReason,
    output: finalOutput,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    iterations,
    steps,
  };
}
