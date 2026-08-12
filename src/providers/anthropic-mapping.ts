import type { Message } from './types.js';

// Maps our internal Message[] (which may carry role:'tool', assistant tool_calls,
// and tool_call_id) onto Anthropic's content-block shape.
//
// Anthropic does not have a 'tool' role. A tool result is a user message whose
// content is a tool_result block keyed by the tool_use_id; an assistant tool
// call is an assistant message whose content is a tool_use block. Continuing
// an assistant turn (role:'assistant') immediately before a request is a
// prefill, which skews the conversation — so consecutive assistants would be
// wrong here too.
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type AnthropicMessage = { role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] };

export function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.tool_call_id ?? '', content: m.content }],
      });
    } else if (m.role === 'assistant') {
      if (m.tool_calls && m.tool_calls.length > 0) {
        const blocks: AnthropicContentBlock[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.tool_calls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        }
        out.push({ role: 'assistant', content: blocks });
      } else {
        out.push({ role: 'assistant', content: m.content });
      }
    } else {
      out.push({ role: 'user', content: m.content });
    }
  }
  return out;
}
