import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { executeTool } from './tools.js';
import { getMode, toolsForMode, checkToolCall, DEFAULT_MODE, type AgentMode } from './modes.js';
import { buildSystemPrompt, truncateToolOutput, TOOL_RESULT_MAX_CHARS, isFreeOrLocal } from './agent.js';
import { recordCheckpoint, MUTATING_TOOLS } from './checkpoints.js';
import { selectProviderAndModel, type TaskType } from './selector.js';
import { validateTurnSequence } from '../providers/wire.js';
import { checkBudgetAlert, recordSpending } from '../storage/budget.js';
import type { Message, Provider, ToolCall } from '../providers/types.js';

/**
 * Cude Claw: a conversation that keeps its context between turns, rather than
 * `cude run` starting from nothing each time.
 *
 * The difference that matters is not the prompt — it is that the user is
 * present. Every edit can be shown and approved before it happens, the mode and
 * model can change mid-conversation, and the accumulated cost is visible as it
 * grows.
 */

export type ApprovalDecision = 'yes' | 'no' | 'always' | 'abort';

export interface PendingEdit {
  toolName: string;
  args: Record<string, unknown>;
  /** Present when the change can be previewed as a diff. */
  before?: string;
  after?: string;
  path?: string;
}

export interface ClawEvents {
  onThought?: (text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, ok: boolean, summary: string) => void;
  onApproval?: (edit: PendingEdit) => Promise<ApprovalDecision>;
  onIteration?: (n: number) => void;
}

export interface ClawTurnResult {
  output: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  iterations: number;
  toolCalls: number;
  stopReason: 'completed' | 'max_iterations' | 'budget_exceeded' | 'aborted';
}

export interface ClawSessionOptions {
  provider?: string;
  model?: string;
  mode?: string;
  taskType?: TaskType;
  free?: boolean;
  maxIterationsPerTurn?: number;
  /** Approve every edit without asking. */
  autoApprove?: boolean;
}

export class ClawSession {
  readonly runId = randomUUID().slice(0, 8);
  readonly messages: Message[] = [];

  provider: Provider;
  model: string;
  mode: AgentMode;
  autoApprove: boolean;

  totalCost = 0;
  totalInputTokens = 0;
  totalOutputTokens = 0;
  turns = 0;

  private maxIterations: number;
  private alwaysAllowed = new Set<string>();

  constructor(options: ClawSessionOptions = {}) {
    this.mode = getMode(options.mode ?? DEFAULT_MODE);
    this.maxIterations = options.maxIterationsPerTurn ?? 12;
    this.autoApprove = options.autoApprove ?? false;

    const selected = selectProviderAndModel(options.taskType ?? this.mode.defaultTaskType, {
      free: options.free ?? false,
      preferredProvider: options.provider,
      preferredModel: options.model,
    });
    this.provider = selected.provider;
    this.model = selected.model;
  }

  get supportsTools(): boolean {
    return this.provider.supportsTools() && typeof this.provider.chatWithTools === 'function';
  }

  setMode(name: string): void {
    this.mode = getMode(name);
  }

  setModel(provider: string | undefined, model: string): void {
    const selected = selectProviderAndModel(this.mode.defaultTaskType, {
      preferredProvider: provider ?? this.provider.name,
      preferredModel: model,
    });
    this.provider = selected.provider;
    this.model = selected.model;
  }

  /** Drops the conversation but keeps the session's cost tally and settings. */
  clear(): void {
    this.messages.length = 0;
    this.alwaysAllowed.clear();
  }

  /**
   * Expands `@path` mentions into the file's contents, so "explain @src/x.ts"
   * does not need a tool round-trip just to read something the user named.
   */
  expandMentions(input: string): string {
    const mentions = [...input.matchAll(/(?:^|\s)@([^\s]+)/g)].map(m => m[1]);
    if (mentions.length === 0) return input;

    const attachments: string[] = [];
    for (const mention of mentions) {
      const path = resolve(mention);
      if (!existsSync(path)) {
        attachments.push(`--- @${mention} ---\n(no such file)`);
        continue;
      }
      try {
        const content = readFileSync(path, 'utf-8');
        attachments.push(
          `--- @${mention} ---\n${truncateToolOutput(content, TOOL_RESULT_MAX_CHARS)}`
        );
      } catch (err) {
        attachments.push(`--- @${mention} ---\n(could not read: ${err instanceof Error ? err.message : String(err)})`);
      }
    }

    return `${input}\n\nReferenced files:\n\n${attachments.join('\n\n')}`;
  }

  /** What a mutating call is about to do, for the approval prompt. */
  private describeEdit(toolName: string, args: Record<string, unknown>): PendingEdit {
    const pathArg = MUTATING_TOOLS[toolName];
    const target = pathArg ? args[pathArg] : undefined;
    const edit: PendingEdit = { toolName, args };
    if (typeof target !== 'string') return edit;

    edit.path = target;
    const resolved = resolve(target);
    const before = existsSync(resolved) ? safeRead(resolved) : '';
    edit.before = before;

    if (toolName === 'write_file' && typeof args.content === 'string') {
      edit.after = args.content;
    } else if (
      toolName === 'replace_in_file' &&
      typeof args.old_text === 'string' &&
      typeof args.new_text === 'string' &&
      before
    ) {
      edit.after = args.replace_all
        ? before.split(args.old_text).join(args.new_text)
        : before.replace(args.old_text, args.new_text);
    }

    return edit;
  }

  private async approve(
    toolName: string,
    args: Record<string, unknown>,
    events: ClawEvents
  ): Promise<ApprovalDecision> {
    if (!MUTATING_TOOLS[toolName]) return 'yes';
    if (this.autoApprove || this.alwaysAllowed.has(toolName)) return 'yes';
    if (!events.onApproval) return 'yes';

    const decision = await events.onApproval(this.describeEdit(toolName, args));
    if (decision === 'always') this.alwaysAllowed.add(toolName);
    return decision;
  }

  async send(userInput: string, events: ClawEvents = {}): Promise<ClawTurnResult> {
    this.turns++;
    this.messages.push({ role: 'user', content: this.expandMentions(userInput) });

    const systemPrompt = buildSystemPrompt(this.mode);
    const tools = toolsForMode(this.mode);
    const budgetApplies = !isFreeOrLocal(this.provider, this.model);

    let iterations = 0;
    let toolCallCount = 0;
    let output = '';
    let cost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: ClawTurnResult['stopReason'] = 'max_iterations';

    while (iterations < this.maxIterations) {
      iterations++;
      events.onIteration?.(iterations);

      if (budgetApplies) {
        const budget = checkBudgetAlert();
        if (budget.exceeded) {
          output = `Budget exceeded: ${budget.message}`;
          stopReason = 'budget_exceeded';
          break;
        }
      }

      const violation = validateTurnSequence(this.messages);
      if (violation) {
        throw new Error(`Refusing to send a malformed conversation: ${violation}`);
      }

      const { response, toolCalls } = await this.provider.chatWithTools!(
        this.messages,
        this.model,
        tools,
        { systemPrompt, maxTokens: 4096 }
      );

      cost += response.cost;
      inputTokens += response.inputTokens;
      outputTokens += response.outputTokens;
      recordSpending(this.provider.name, this.model, response.cost, response.inputTokens, response.outputTokens);

      if (response.content) events.onThought?.(response.content);

      if (toolCalls.length === 0) {
        output = response.content;
        stopReason = 'completed';
        break;
      }

      this.messages.push({ role: 'assistant', content: response.content, tool_calls: toolCalls });

      let aborted = false;
      for (const call of toolCalls) {
        toolCallCount++;
        const result = await this.runCall(call, events);
        if (result === 'abort') {
          aborted = true;
          // The assistant is still owed an answer for every call it made, or
          // the next request is malformed.
          this.messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: 'The user stopped this turn.',
          });
          continue;
        }
      }

      if (aborted) {
        output = 'Stopped.';
        stopReason = 'aborted';
        break;
      }

      if (response.content.includes('TASK COMPLETE:')) {
        output = response.content;
        stopReason = 'completed';
        break;
      }
    }

    if (!output && stopReason === 'max_iterations') {
      output = `Stopped after ${iterations} steps without finishing.`;
    }

    this.totalCost += cost;
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;

    return { output, cost, inputTokens, outputTokens, iterations, toolCalls: toolCallCount, stopReason };
  }

  /** Runs one tool call, appending its result message. Returns 'abort' to stop. */
  private async runCall(call: ToolCall, events: ClawEvents): Promise<'done' | 'abort'> {
    events.onToolCall?.(call.name, call.arguments);

    const refusal = checkToolCall(this.mode, call.name, call.arguments);
    if (refusal) {
      events.onToolResult?.(call.name, false, refusal);
      this.messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: `ERROR: ${refusal}` });
      return 'done';
    }

    const decision = await this.approve(call.name, call.arguments, events);
    if (decision === 'abort') return 'abort';
    if (decision === 'no') {
      const message = 'The user declined this edit. Do not retry it; ask what to do differently.';
      events.onToolResult?.(call.name, false, 'declined');
      this.messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: `ERROR: ${message}` });
      return 'done';
    }

    recordCheckpoint(this.runId, `claw turn ${this.turns}`, call.name, call.arguments);
    const result = await executeTool(call.name, call.arguments);

    events.onToolResult?.(
      call.name,
      result.success,
      result.success ? result.output.split('\n')[0].slice(0, 120) : (result.error ?? 'failed')
    );

    this.messages.push({
      role: 'tool',
      tool_call_id: call.id,
      name: call.name,
      content: result.success
        ? truncateToolOutput(result.output, TOOL_RESULT_MAX_CHARS)
        : `ERROR: ${result.error}`,
    });

    return 'done';
  }
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}
