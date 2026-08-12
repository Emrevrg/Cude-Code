import type { Message } from './types.js';

/**
 * Conversion from Cude's provider-neutral `Message[]` to each vendor's wire
 * format, plus the invariant check that keeps the two in step.
 *
 * The agent used to fold tool output into the *assistant's own* message text.
 * That hid the arguments each tool was called with from the model, and it
 * produced runs of consecutive assistant messages that always ended on one —
 * which Anthropic reads as a prefill continuation rather than a fresh turn.
 */

export interface OpenAIWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}
export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicWireMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/**
 * OpenAI-compatible shape (OpenAI, vLLM, LiteLLM, and anything else speaking
 * /v1/chat/completions): assistant messages carry `tool_calls`, and each result
 * comes back as its own `role: 'tool'` message keyed by `tool_call_id`.
 */
export function toOpenAIWireMessages(
  messages: Message[],
  systemPrompt?: string
): OpenAIWireMessage[] {
  const out: OpenAIWireMessage[] = [];
  if (systemPrompt) {
    out.push({ role: 'system', content: systemPrompt });
  }

  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({
        role: 'tool',
        content: m.content,
        tool_call_id: m.tool_call_id ?? '',
      });
      continue;
    }

    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      out.push({
        role: 'assistant',
        // The API rejects an empty string alongside tool_calls; null is the
        // documented way to say "no prose this turn".
        content: m.content && m.content.length > 0 ? m.content : null,
        tool_calls: m.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
        })),
      });
      continue;
    }

    out.push({ role: m.role, content: m.content });
  }

  return out;
}

/**
 * Anthropic content-block shape. Tool use rides inside the assistant message as
 * `tool_use` blocks; results come back as `tool_result` blocks in a *user*
 * message, which is also what keeps assistant turns from running together.
 * Consecutive tool results are merged into one user message, as the API expects.
 */
export function toAnthropicWireMessages(messages: Message[]): AnthropicWireMessage[] {
  const out: AnthropicWireMessage[] = [];

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      const block: AnthropicToolResultBlock = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id ?? '',
        content: m.content,
      };
      const previous = out[out.length - 1];
      if (previous && previous.role === 'user' && Array.isArray(previous.content)) {
        previous.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (m.content && m.content.trim().length > 0) {
        blocks.push({ type: 'text', text: m.content });
      }
      for (const tc of m.tool_calls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments ?? {} });
      }
      // An assistant turn with neither text nor tool use has nothing to send.
      if (blocks.length === 0) continue;
      out.push({ role: 'assistant', content: blocks });
      continue;
    }

    out.push({ role: 'user', content: m.content });
  }

  return out;
}

/**
 * The invariant the agent must uphold before every request. Returns a
 * description of the first violation, or null when the sequence is well formed.
 */
export function validateTurnSequence(messages: Message[]): string | null {
  const announcedToolCallIds = new Set<string>();
  let previousRole: Message['role'] | null = null;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];

    if (m.role === 'assistant' && previousRole === 'assistant') {
      return `two consecutive assistant messages at index ${i}`;
    }

    if (m.role === 'assistant') {
      for (const tc of m.tool_calls ?? []) announcedToolCallIds.add(tc.id);
    }

    if (m.role === 'tool') {
      if (!m.tool_call_id) {
        return `tool message at index ${i} has no tool_call_id`;
      }
      if (!announcedToolCallIds.has(m.tool_call_id)) {
        return `tool message at index ${i} references unknown tool_call_id "${m.tool_call_id}"`;
      }
    }

    previousRole = m.role;
  }

  if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
    return 'the message array ends on an assistant message';
  }

  return null;
}
