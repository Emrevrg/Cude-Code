import chalk from 'chalk';
import { selectProviderAndModel, type TaskType } from './selector.js';
import { executeTool, TOOL_DEFINITIONS, setConfirmCallback, formatToolCall, formatToolResult, smartTruncate } from './tools.js';
import { recordSpending, checkBudgetAlert } from '../storage/budget.js';
import { trimMessagesToFit } from './context.js';
import type { Message } from '../providers/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─── Options & Results ────────────────────────────────────────────────────────

export interface AgentOptions {
  task: string;
  taskType?: TaskType;
  free?: boolean;
  provider?: string;
  model?: string;
  maxIterations?: number;
  verbose?: boolean;
  autoCommit?: boolean;
  enablePlanning?: boolean;
  onProgress?: (step: string) => void;
  onConfirm?: (message: string) => Promise<boolean>;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, success: boolean, output: string) => void;
}

export interface AgentResult {
  success: boolean;
  output: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  iterations: number;
  steps: AgentStep[];
  gitSummary?: string;
}

export interface AgentStep {
  type: 'thought' | 'tool_call' | 'tool_result' | 'final';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

// ─── Completion signals ───────────────────────────────────────────────────────

const COMPLETION_SIGNALS = [
  'TASK COMPLETE:',
  'Task complete:',
  'task_complete:',
  'COMPLETED:',
  'Task completed',
  'I have completed',
  'I have finished',
  'Successfully completed',
  'All done',
  'The task is complete',
  'The task has been completed',
];

function isTaskComplete(content: string): boolean {
  return COMPLETION_SIGNALS.some(sig => content.includes(sig));
}

// ─── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(isGitRepo: boolean): string {
  return `You are an autonomous AI coding agent with expert-level capabilities. You have access to tools to complete coding tasks autonomously and thoroughly.

## Core workflow
1. Understand the task fully — explore the codebase with read_file / list_directory first
2. Plan your approach for complex tasks: identify files to change, dependencies, edge cases
3. Use edit_file (preferred) or write_file to make changes
4. Run tests with test_project after each significant change
5. If tests fail, read the failure output carefully and fix the issues — iterate until green
6. Use git tools to track and commit your work
7. Self-reflect when stuck: re-read the task, check recent changes, try a different approach
8. Report completion with a clear summary

## File editing strategy (IMPORTANT)
- **edit_file** → modify existing files (surgical, safe, shows what changed)
- **write_file** → create new files or full rewrites only
- Always read_file BEFORE editing to get exact text
- edit_file requires exact text match — copy from read_file output
- For large files: use start_line/end_line to read relevant sections

## Test-driven development
- After making changes, use test_project to verify correctness
- If tests fail: read the failing test names carefully, fix the root cause, re-run tests
- Never claim "TASK COMPLETE" if you know tests are still failing
- Run tests with filter parameter to focus on specific failing tests

## Git workflow
${isGitRepo ? `- Use git_status to see what changed
- Use git_diff to review changes before committing
- Use git_commit to commit with meaningful message
- Use git_log to understand project history` : '- No git repository detected in this directory'}

## Self-reflection rules
- If you've tried the same approach twice without progress, STOP and rethink
- Re-read the original task requirements
- Check if your understanding of the codebase is correct with read_file
- Consider whether you're solving the right problem

## Tool usage rules
- Prefer specific tools over run_command (e.g., read_file over "cat file")
- Use web_search to look up APIs, error messages, or unfamiliar patterns
- Use run_code for quick calculations or data transformations
- If a tool fails, read the error carefully and adjust

## Completion
When the task is fully done, respond with "TASK COMPLETE:" followed by:
- What was accomplished
- Files created/modified
- Test results (pass/fail counts)
- Git commit hash if committed`;
}

// ─── Git repo detection ───────────────────────────────────────────────────────

async function isGitRepository(): Promise<boolean> {
  try {
    await execAsync('git rev-parse --git-dir', { cwd: process.cwd(), timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function getGitSummary(): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync('git diff --stat HEAD 2>/dev/null || git status --short', {
      cwd: process.cwd(), timeout: 5000,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

// ─── Main entry ─────────────────────────────────────────────────────────────

// ─── Planning phase ─────────────────────────────────────────────────────────

const COMPLEX_TASK_SIGNALS = [
  'refactor', 'migrate', 'implement', 'build', 'create', 'add feature',
  'redesign', 'architecture', 'optimize', 'multi', 'step', 'complex',
];

function isComplexTask(task: string): boolean {
  const lower = task.toLowerCase();
  return COMPLEX_TASK_SIGNALS.some(s => lower.includes(s)) || task.length > 200;
}

async function buildPlan(
  provider: import('../providers/types.js').Provider,
  model: string,
  task: string,
  systemPrompt: string
): Promise<string | null> {
  try {
    const response = await provider.chat(
      [{ role: 'user', content: `Task: ${task}\n\nCreate a concise step-by-step plan (max 8 steps). Each step on its own line starting with a number. Focus on specific file operations, tests to run, and verification steps.` }],
      model,
      { systemPrompt, maxTokens: 512 }
    );
    return response.content.trim() || null;
  } catch {
    return null;
  }
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const {
    task,
    taskType = 'code',
    free = false,
    provider: preferredProvider,
    model: preferredModel,
    maxIterations = 10,
    verbose = false,
    autoCommit = false,
    enablePlanning,
    onProgress,
    onConfirm,
  } = options;

  if (onConfirm) setConfirmCallback(onConfirm);

  const { provider, model, reason } = selectProviderAndModel(taskType, { free, preferredProvider, preferredModel });

  if (verbose) {
    console.log(chalk.dim(`  Using ${provider.displayName} / ${model} (${reason})`));
  }

  const isGitRepo = await isGitRepository();
  const systemPrompt = buildSystemPrompt(isGitRepo);

  // Optional planning phase for complex tasks
  const usePlanning = enablePlanning ?? isComplexTask(task);
  let planContext = '';
  if (usePlanning && maxIterations >= 5) {
    onProgress?.('Planning task...');
    const plan = await buildPlan(provider, model, task, systemPrompt);
    if (plan) {
      planContext = `\n\nExecution plan:\n${plan}`;
      if (verbose) console.log(chalk.dim('\n  Plan:\n') + chalk.dim(plan));
    }
  }

  const enrichedOptions = planContext
    ? { ...options, task: task + planContext }
    : options;

  let result: AgentResult;
  if (provider.supportsTools() && provider.chatWithTools) {
    result = await runToolsAgent(provider, model, enrichedOptions, maxIterations, systemPrompt);
  } else {
    result = await runReActAgent(provider, model, enrichedOptions, maxIterations, systemPrompt);
  }

  // Auto-commit if requested and we're in a git repo
  if (autoCommit && isGitRepo) {
    try {
      const { stdout: status } = await execAsync('git status --short', { cwd: process.cwd(), timeout: 5000 });
      if (status.trim()) {
        const commitMsg = `cude: ${task.slice(0, 72)}`;
        await execAsync(`git add -A && git commit -m ${JSON.stringify(commitMsg)}`, {
          cwd: process.cwd(), timeout: 15000,
        });
        if (verbose) console.log(chalk.green('\n  ✓ Changes auto-committed to git'));
      }
    } catch { /* non-fatal */ }
  }

  result.gitSummary = await getGitSummary();
  return result;
}

// ─── Tool-calling agent (for providers with native tool use) ────────────────

async function runToolsAgent(
  provider: import('../providers/types.js').Provider,
  model: string,
  options: AgentOptions,
  maxIterations: number,
  systemPrompt: string
): Promise<AgentResult> {
  const messages: Message[] = [{ role: 'user', content: options.task }];

  let totalCost = 0, totalInputTokens = 0, totalOutputTokens = 0, iterations = 0;
  const steps: AgentStep[] = [];
  let finalOutput = '';
  let stagnantRounds = 0;
  let lastToolCount = -1;
  let exitReason: 'complete' | 'budget' | 'stagnant' | 'max_iter' = 'max_iter';

  while (iterations < maxIterations) {
    iterations++;

    const budgetCheck = checkBudgetAlert();
    if (budgetCheck.exceeded) {
      finalOutput = `Budget exceeded: ${budgetCheck.message}`;
      exitReason = 'budget';
      break;
    }

    // Inject self-reflection when stagnating
    if (stagnantRounds === 1) {
      messages.push({
        role: 'user',
        content: 'You seem to be stuck. Re-read the original task, review what you\'ve done so far, and try a different approach. What is the actual root cause of the problem?',
      });
    }

    options.onProgress?.(`Step ${iterations}: Thinking...`);

    // Trim context to fit within the provider's window
    const trimmedMessages = trimMessagesToFit(messages, provider.name, model);

    const { response, toolCalls } = await provider.chatWithTools!(
      trimmedMessages, model, TOOL_DEFINITIONS,
      { systemPrompt, maxTokens: 4096 }
    );

    totalCost += response.cost;
    totalInputTokens += response.inputTokens;
    totalOutputTokens += response.outputTokens;
    recordSpending(provider.name, model, response.cost, response.inputTokens, response.outputTokens);

    if (response.content) {
      steps.push({ type: 'thought', content: response.content });
      if (options.verbose) console.log(chalk.cyan('\n  Agent: ') + response.content.slice(0, 300));
    }

    // Detect stagnation: no tools for this round, or same tool count as last round (loop)
    if (toolCalls.length === 0) {
      stagnantRounds++;
    } else if (toolCalls.length === lastToolCount && iterations > 3) {
      stagnantRounds++;
    } else {
      stagnantRounds = 0;
    }
    lastToolCount = toolCalls.length;

    // Task complete or no more tools needed
    if (toolCalls.length === 0 || isTaskComplete(response.content) || stagnantRounds >= 2) {
      finalOutput = response.content;
      exitReason = isTaskComplete(response.content) ? 'complete' : 'stagnant';
      break;
    }

    // Execute tools
    const toolResults: string[] = [];
    for (const toolCall of toolCalls) {
      options.onProgress?.(`Step ${iterations}: running ${toolCall.name}...`);

      if (options.verbose) console.log(formatToolCall(toolCall.name, toolCall.arguments));

      steps.push({
        type: 'tool_call',
        content: `${toolCall.name}(${JSON.stringify(toolCall.arguments)})`,
        toolName: toolCall.name,
        toolArgs: toolCall.arguments,
      });

      options.onToolCall?.(toolCall.name, toolCall.arguments);

      const result = await executeTool(toolCall.name, toolCall.arguments);

      options.onToolResult?.(toolCall.name, result.success, result.success ? result.output : (result.error ?? ''));
      if (options.verbose) console.log(formatToolResult(result));

      steps.push({ type: 'tool_result', content: result.success ? result.output : `Error: ${result.error}` });

      const resultText = result.success
        ? smartTruncate(result.output, 4000)
        : `ERROR: ${result.error}`;

      toolResults.push(`Tool: ${toolCall.name}\nResult: ${resultText}`);
    }

    messages.push({
      role: 'assistant',
      content: (response.content ? response.content + '\n\n' : '') + 'Tool Results:\n' + toolResults.join('\n---\n'),
    });
  }

  steps.push({ type: 'final', content: finalOutput });
  const success = exitReason === 'complete';
  return { success, output: finalOutput, totalCost, totalInputTokens, totalOutputTokens, iterations, steps };
}

// ─── ReAct agent (text-based tool use for providers without native tool support) ─

async function runReActAgent(
  provider: import('../providers/types.js').Provider,
  model: string,
  options: AgentOptions,
  maxIterations: number,
  systemPrompt: string
): Promise<AgentResult> {
  const toolDescriptions = TOOL_DEFINITIONS.map(t =>
    `- **${t.name}**: ${t.description}`
  ).join('\n');

  const fullSystemPrompt = `${systemPrompt}

## Available tools
${toolDescriptions}

## Tool call format
To use a tool, respond EXACTLY with:
TOOL: tool_name
ARGS: {"arg1": "value1", "arg2": "value2"}

Wait for the tool result before continuing.
When the task is done, respond with "TASK COMPLETE:" and a summary.`;

  const messages: Message[] = [{ role: 'user', content: `Task: ${options.task}` }];

  let totalCost = 0, totalInputTokens = 0, totalOutputTokens = 0, iterations = 0;
  const steps: AgentStep[] = [];
  let finalOutput = '';
  let noToolRounds = 0;
  let reactExitReason: 'complete' | 'budget' | 'stagnant' | 'max_iter' = 'max_iter';

  while (iterations < maxIterations) {
    iterations++;

    const budgetCheck = checkBudgetAlert();
    if (budgetCheck.exceeded) {
      finalOutput = `Budget exceeded: ${budgetCheck.message}`;
      reactExitReason = 'budget';
      break;
    }

    // Inject self-reflection when stagnating
    if (noToolRounds === 1 && iterations > 2) {
      messages.push({
        role: 'user',
        content: 'You seem to be repeating yourself. Re-read the original task requirements, check what files actually exist, and try a fresh approach using the available tools.',
      });
    }

    options.onProgress?.(`Step ${iterations}: Thinking...`);

    // Trim context to fit within the provider's window
    const trimmedMessages = trimMessagesToFit(messages, provider.name, model);

    const response = await provider.chat(trimmedMessages, model, { systemPrompt: fullSystemPrompt, maxTokens: 2048 });

    totalCost += response.cost;
    totalInputTokens += response.inputTokens;
    totalOutputTokens += response.outputTokens;
    recordSpending(provider.name, model, response.cost, response.inputTokens, response.outputTokens);

    const content = response.content;
    if (options.verbose) console.log(chalk.cyan('\n  Agent: ') + content.slice(0, 300));

    // Parse tool call
    const toolMatch = content.match(/TOOL:\s*(\w+)\s*\nARGS:\s*(\{[\s\S]*?\})/);
    if (toolMatch) {
      const toolName = toolMatch[1];
      let toolArgs: Record<string, unknown> = {};
      try { toolArgs = JSON.parse(toolMatch[2]) as Record<string, unknown>; } catch { toolArgs = {}; }

      steps.push({ type: 'tool_call', content: `${toolName}(${JSON.stringify(toolArgs)})`, toolName, toolArgs });
      options.onProgress?.(`Step ${iterations}: running ${toolName}...`);
      if (options.verbose) console.log(formatToolCall(toolName, toolArgs));

      options.onToolCall?.(toolName, toolArgs);
      const result = await executeTool(toolName, toolArgs);
      options.onToolResult?.(toolName, result.success, result.success ? result.output : (result.error ?? ''));
      if (options.verbose) console.log(formatToolResult(result));

      const resultText = result.success
        ? smartTruncate(result.output, 4000)
        : `Error: ${result.error}`;

      steps.push({ type: 'tool_result', content: resultText });
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: `Tool result for ${toolName}:\n${resultText}\n\nContinue with the next step.` });
      noToolRounds = 0;
    } else {
      steps.push({ type: 'thought', content });
      noToolRounds++;

      if (isTaskComplete(content) || noToolRounds >= 2 || iterations >= maxIterations - 1) {
        finalOutput = content;
        reactExitReason = isTaskComplete(content) ? 'complete' : 'stagnant';
        messages.push({ role: 'assistant', content });
        break;
      }

      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: 'Continue to the next step.' });
    }
  }

  if (!finalOutput) finalOutput = messages.at(-1)?.content ?? 'Task completed';

  steps.push({ type: 'final', content: finalOutput });
  const reactSuccess = reactExitReason === 'complete';
  return { success: reactSuccess, output: finalOutput, totalCost, totalInputTokens, totalOutputTokens, iterations, steps };
}
