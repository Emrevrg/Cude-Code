import { getApiKey } from '../config/index.js';
import { calculateCost, estimateTokens, getModelsByProvider } from '../config/models.js';
import type {
  Provider,
  Message,
  ChatResponse,
  StreamChunk,
  ChatOptions,
  ModelInfo,
  ToolDefinition,
  ToolCall,
} from './types.js';

export class VLLMProvider implements Provider {
  name = 'vllm';
  displayName = 'vLLM (Self-hosted)';

  private getConfig() {
    const endpoint = getApiKey('vllm-endpoint') || 'http://localhost:8000';
    return { endpoint };
  }

  isConfigured(): boolean {
    // vLLM can work with default localhost endpoint
    return true;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { endpoint } = this.getConfig();
      const response = await fetch(`${endpoint}/v1/models`);
      return response.ok;
    } catch {
      return false;
    }
  }

  listModels(): ModelInfo[] {
    return getModelsByProvider('vllm').map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      free: true,
      local: true,
    }));
  }

  supportsTools(): boolean {
    return true;
  }

  async chat(messages: Message[], model: string, options: ChatOptions = {}): Promise<ChatResponse> {
    const { endpoint } = this.getConfig();

    const body = {
      model,
      messages: [
        ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        ...messages,
      ],
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
    };

    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`vLLM error: ${response.statusText}`);
    }

    const data = await response.json() as any;
    const content = data.choices[0]?.message?.content ?? '';
    const inputTokens = data.usage?.prompt_tokens ?? estimateTokens(messages.map(m => m.content).join(' '));
    const outputTokens = data.usage?.completion_tokens ?? estimateTokens(content);
    const cost = 0; // Self-hosted, no cost

    return { content, inputTokens, outputTokens, cost, model };
  }

  async streamChat(
    messages: Message[],
    model: string,
    options: ChatOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    const { endpoint } = this.getConfig();

    const body = {
      model,
      messages: [
        ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        ...messages,
      ],
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      stream: true,
    };

    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`vLLM error: ${response.statusText}`);
    }

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data) as any;
              const delta = parsed.choices[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                onChunk({ text: delta, done: false });
              }
              if (parsed.usage) {
                inputTokens = parsed.usage.prompt_tokens;
                outputTokens = parsed.usage.completion_tokens;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (inputTokens === 0) {
      inputTokens = estimateTokens(messages.map(m => m.content).join(' '));
      outputTokens = estimateTokens(fullContent);
    }

    onChunk({ text: '', done: true, inputTokens, outputTokens });
    return { content: fullContent, inputTokens, outputTokens, cost: 0, model };
  }

  async chatWithTools(
    messages: Message[],
    model: string,
    tools: ToolDefinition[],
    options: ChatOptions = {}
  ): Promise<{ response: ChatResponse; toolCalls: ToolCall[] }> {
    const { endpoint } = this.getConfig();

    const body = {
      model,
      messages: [
        ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        ...messages,
      ],
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    };

    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`vLLM error: ${response.statusText}`);
    }

    const data = await response.json() as any;
    const content = data.choices[0]?.message?.content ?? '';
    const inputTokens = data.usage?.prompt_tokens ?? estimateTokens(messages.map(m => m.content).join(' '));
    const outputTokens = data.usage?.completion_tokens ?? estimateTokens(content);

    const toolCalls: ToolCall[] = [];
    const toolCallsData = data.choices[0]?.message?.tool_calls ?? [];
    for (const tc of toolCallsData) {
      toolCalls.push({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      });
    }

    return {
      response: { content, inputTokens, outputTokens, cost: 0, model },
      toolCalls,
    };
  }
}
