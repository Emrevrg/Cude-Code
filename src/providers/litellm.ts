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
  CostClass,
} from './types.js';

import { fetchProvider } from './net.js';
import { toOpenAIWireMessages } from './wire.js';

// Reports an unreachable endpoint instead of a bare "fetch failed".
const fetchLiteLLM = (url: string, init?: RequestInit): Promise<Response> =>
  fetchProvider(url, init, 'the LiteLLM proxy', 'Start it with: litellm --model <model>');

export class LiteLLMProvider implements Provider {
  name = 'litellm';
  displayName = 'LiteLLM Proxy';
  costClass: CostClass = 'mixed';

  private getConfig() {
    const endpoint = getApiKey('litellm-endpoint') || 'http://localhost:8000';
    // `cude config set-key litellm <key>` stores it under "litellm"; this read
    // "litellm-key", a name the CLI rejects, so setting a LiteLLM key silently
    // did nothing. The old name stays as a fallback for hand-edited configs.
    const apiKey = getApiKey('litellm') || getApiKey('litellm-key');
    return { endpoint, apiKey };
  }

  isConfigured(): boolean {
    // LiteLLM can work without API key if running locally
    return true;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { endpoint } = this.getConfig();
      const response = await fetchLiteLLM(`${endpoint}/models`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  listModels(): ModelInfo[] {
    return getModelsByProvider('litellm').map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      free: m.free,
      local: m.local,
    }));
  }

  async listRemoteModels(): Promise<string[]> {
    const { endpoint, apiKey } = this.getConfig();
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const response = await fetchLiteLLM(`${endpoint}/models`, { headers });
    if (!response.ok) throw new Error(`LiteLLM error: ${response.statusText}`);
    const data = await response.json() as { data?: Array<{ id: string }> };
    return (data.data ?? []).map(m => m.id);
  }

  supportsTools(): boolean {
    return true;
  }

  async chat(messages: Message[], model: string, options: ChatOptions = {}): Promise<ChatResponse> {
    const { endpoint, apiKey } = this.getConfig();

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = {
      model,
      messages: toOpenAIWireMessages(messages, options.systemPrompt),
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
    };

    const response = await fetchLiteLLM(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`LiteLLM error: ${response.statusText}`);
    }

    const data = await response.json() as any;
    const content = data.choices[0]?.message?.content ?? '';
    const inputTokens = data.usage?.prompt_tokens ?? estimateTokens(messages.map(m => m.content).join(' '));
    const outputTokens = data.usage?.completion_tokens ?? estimateTokens(content);
    const cost = calculateCost(model, inputTokens, outputTokens);

    return { content, inputTokens, outputTokens, cost, model };
  }

  async streamChat(
    messages: Message[],
    model: string,
    options: ChatOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    const { endpoint, apiKey } = this.getConfig();

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = {
      model,
      messages: toOpenAIWireMessages(messages, options.systemPrompt),
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      stream: true,
    };

    const response = await fetchLiteLLM(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`LiteLLM error: ${response.statusText}`);
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
    const cost = calculateCost(model, inputTokens, outputTokens);
    return { content: fullContent, inputTokens, outputTokens, cost, model };
  }

  async chatWithTools(
    messages: Message[],
    model: string,
    tools: ToolDefinition[],
    options: ChatOptions = {}
  ): Promise<{ response: ChatResponse; toolCalls: ToolCall[] }> {
    const { endpoint, apiKey } = this.getConfig();

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = {
      model,
      messages: toOpenAIWireMessages(messages, options.systemPrompt),
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

    const response = await fetchLiteLLM(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`LiteLLM error: ${response.statusText}`);
    }

    const data = await response.json() as any;
    const content = data.choices[0]?.message?.content ?? '';
    const inputTokens = data.usage?.prompt_tokens ?? estimateTokens(messages.map(m => m.content).join(' '));
    const outputTokens = data.usage?.completion_tokens ?? estimateTokens(content);
    const cost = calculateCost(model, inputTokens, outputTokens);

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
      response: { content, inputTokens, outputTokens, cost, model },
      toolCalls,
    };
  }
}
