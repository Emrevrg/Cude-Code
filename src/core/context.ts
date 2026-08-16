import type { Message } from '../providers/types.js';
import { MODELS } from '../config/models.js';

/**
 * Context management for long agent runs.
 *
 * The loop re-sends the entire conversation every turn. A run that reads a few
 * large files therefore does not degrade — it *stops*, with a provider error
 * about the context window, twenty iterations in. That is the ceiling on how
 * hard a task this agent can attempt, and it is the reason `maxIterations`
 * defaulted to a number small enough to hide the problem.
 *
 * Compaction removes the oldest evidence first, because it is the least likely
 * to matter: what the agent read at step 3 has usually been superseded by what
 * it did at step 20. Two passes, in order of how much they cost the run:
 *
 *   1. Shrink old tool *results* to a digest. The call that produced them stays
 *      visible, so the model still knows it looked.
 *   2. Drop the oldest call/result groups entirely, leaving a note saying how
 *      many were dropped.
 *
 * Both passes preserve the turn-sequence invariant — an assistant message and
 * the tool results answering it move together, always — because a conversation
 * that violates it is rejected before it is ever sent.
 */

/** Rough token estimate. Cheap, deterministic, and close enough to budget on. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ~3.6 chars/token for code-heavy English; the ceiling matters more than
  // precision, so this deliberately rounds up.
  return Math.ceil(text.length / 3.6);
}

export function estimateConversationTokens(messages: Message[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateTokens(message.content);
    for (const call of message.tool_calls ?? []) {
      total += estimateTokens(call.name) + estimateTokens(JSON.stringify(call.arguments ?? {}));
    }
    total += 4; // per-message role and framing overhead
  }
  return total;
}

/**
 * The share of a model's window the conversation may occupy before compaction
 * runs. The rest is headroom for the system prompt, the tool schemas and the
 * reply — all of which are sent on the same request.
 */
export const CONTEXT_USE_FRACTION = 0.6;

/** Assumed window for a model that is not in the catalog (most local ones). */
export const FALLBACK_CONTEXT_WINDOW = 32_000;

export function contextBudgetFor(model: string): number {
  const known = MODELS[model]?.contextWindow ?? FALLBACK_CONTEXT_WINDOW;
  return Math.floor(known * CONTEXT_USE_FRACTION);
}

/** How much of a tool result survives the first compaction pass. */
export const DIGEST_CHARS = 240;

function digest(content: string): string {
  if (content.length <= DIGEST_CHARS) return content;
  const head = content.slice(0, DIGEST_CHARS).trimEnd();
  return `${head}\n… [compacted: ${content.length} chars, ${content.split('\n').length} lines]`;
}

/**
 * One assistant turn and every tool result answering it. Groups are the unit
 * of compaction because splitting one produces an orphaned tool result.
 */
interface TurnGroup {
  start: number;
  end: number;
  toolCallCount: number;
}

function groupTurns(messages: Message[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue;
    let end = i;
    while (end + 1 < messages.length && messages[end + 1].role === 'tool') end++;
    groups.push({ start: i, end, toolCallCount: message.tool_calls.length });
  }
  return groups;
}

export interface CompactionOptions {
  /** Token ceiling for the conversation. Defaults to the model's budget. */
  budgetTokens: number;
  /** Recent groups left untouched, however tight the budget gets. */
  keepRecentGroups?: number;
}

export interface CompactionResult {
  messages: Message[];
  /** True when anything was changed. */
  compacted: boolean;
  digestedResults: number;
  droppedGroups: number;
  tokensBefore: number;
  tokensAfter: number;
}

export const DEFAULT_KEEP_RECENT_GROUPS = 3;

/**
 * Brings a conversation under `budgetTokens`, or as close as the recent-turn
 * floor allows. Returns a new array; the input is not modified.
 */
export function compactConversation(
  messages: Message[],
  options: CompactionOptions
): CompactionResult {
  const keepRecent = options.keepRecentGroups ?? DEFAULT_KEEP_RECENT_GROUPS;
  const tokensBefore = estimateConversationTokens(messages);

  if (tokensBefore <= options.budgetTokens) {
    return {
      messages,
      compacted: false,
      digestedResults: 0,
      droppedGroups: 0,
      tokensBefore,
      tokensAfter: tokensBefore,
    };
  }

  let working = messages.map(m => ({ ...m }));
  let digestedResults = 0;
  let droppedGroups = 0;

  // Pass 1 — digest old tool results, oldest first, stopping as soon as the
  // conversation fits. Recent groups are never touched.
  const groups = groupTurns(working);
  const compactable = Math.max(0, groups.length - keepRecent);
  for (let g = 0; g < compactable; g++) {
    if (estimateConversationTokens(working) <= options.budgetTokens) break;
    const group = groups[g];
    for (let i = group.start + 1; i <= group.end; i++) {
      const message = working[i];
      if (message.role !== 'tool') continue;
      const shortened = digest(message.content);
      if (shortened !== message.content) {
        working[i] = { ...message, content: shortened };
        digestedResults++;
      }
    }
  }

  // Pass 2 — drop whole groups from the front. The first user message (the
  // task) is never dropped: without it the model is working blind.
  while (estimateConversationTokens(working) > options.budgetTokens) {
    const remaining = groupTurns(working);
    if (remaining.length <= keepRecent) break;
    const oldest = remaining[0];
    working.splice(oldest.start, oldest.end - oldest.start + 1);
    droppedGroups++;
  }

  if (droppedGroups > 0) {
    // A note where the work used to be, so the model does not re-derive what it
    // already established — or repeat a tool call it has no memory of making.
    const note: Message = {
      role: 'user',
      content:
        `[cude-context] ${droppedGroups} earlier step(s) were dropped to stay inside the context ` +
        `window. Their file edits are already applied on disk — re-read a file rather than ` +
        `assuming what it contains, and do not redo work you have already done.`,
    };
    const insertAt = working.findIndex(m => m.role !== 'user') === -1 ? working.length : 1;
    working = [...working.slice(0, insertAt), note, ...working.slice(insertAt)];
  }

  const tokensAfter = estimateConversationTokens(working);
  return {
    messages: working,
    compacted: digestedResults > 0 || droppedGroups > 0,
    digestedResults,
    droppedGroups,
    tokensBefore,
    tokensAfter,
  };
}

/** One-line summary for verbose output and bench metrics. */
export function describeCompaction(result: CompactionResult): string {
  if (!result.compacted) return '';
  const parts: string[] = [];
  if (result.digestedResults) parts.push(`${result.digestedResults} result(s) digested`);
  if (result.droppedGroups) parts.push(`${result.droppedGroups} step(s) dropped`);
  return `context ${result.tokensBefore}→${result.tokensAfter} tokens (${parts.join(', ')})`;
}
