import type OpenAI from 'openai';
import type { Message } from './types.js';

// Maps our internal Message[] (which now carries role:'tool' and tool_calls)
// onto OpenAI's discriminated-union ChatCompletionMessageParam type.
//
// The previous code pushed every message as { role, content }, which dropped
// tool_calls on assistant messages and produced a role:'tool' without the
// required tool_call_id — and before role:'tool' existed it jammed tool
// results into the assistant's own content. This keeps the tool-call protocol
// intact for OpenAI-compatible providers (openai, groq, together, xai, ...).
export function toOpenAIMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content });
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      if (m.tool_calls && m.tool_calls.length > 0) {
        out.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
      } else {
        out.push({ role: 'assistant', content: m.content });
      }
    } else if (m.role === 'tool') {
      out.push({
        role: 'tool',
        content: m.content,
        tool_call_id: m.tool_call_id ?? '',
      });
    }
  }
  return out;
}
