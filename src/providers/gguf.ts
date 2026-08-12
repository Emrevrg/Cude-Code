import { getApiKey } from '../config/index.js';
import { estimateTokens, getModelsByProvider } from '../config/models.js';
import type {
  Provider,
  Message,
  ChatResponse,
  StreamChunk,
  ChatOptions,
  ModelInfo,
  CostClass,
} from './types.js';

import { fetchProvider } from './net.js';

// Reports an unreachable endpoint instead of a bare "fetch failed".
const fetchGguf = (url: string, init?: RequestInit): Promise<Response> =>
  fetchProvider(url, init, 'the llama.cpp server', 'Start it with: llama-server -m <model.gguf>');

export class LocalGGUFProvider implements Provider {
  name = 'gguf';
  displayName = 'Local GGUF (llama.cpp)';
  costClass: CostClass = 'local';

  private getConfig() {
    const endpoint = getApiKey('gguf-endpoint') || 'http://localhost:8080';
    return { endpoint };
  }

  isConfigured(): boolean {
    // GGUF can work with default localhost endpoint
    return true;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { endpoint } = this.getConfig();
      const response = await fetchGguf(`${endpoint}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  listModels(): ModelInfo[] {
    return getModelsByProvider('gguf').map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      free: true,
      local: true,
    }));
  }

  async listRemoteModels(): Promise<string[]> {
    const { endpoint } = this.getConfig();
    const response = await fetchGguf(`${endpoint}/v1/models`);
    if (!response.ok) throw new Error(`llama.cpp server error: ${response.statusText}`);
    const data = await response.json() as { data?: Array<{ id: string }> };
    return (data.data ?? []).map(m => m.id);
  }

  supportsTools(): boolean {
    return false;
  }

  async chat(messages: Message[], model: string, options: ChatOptions = {}): Promise<ChatResponse> {
    const { endpoint } = this.getConfig();

    const body = {
      prompt: this.formatPrompt(messages, options.systemPrompt),
      n_predict: options.maxTokens ?? 512,
      temperature: options.temperature ?? 0.7,
    };

    const response = await fetchGguf(`${endpoint}/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`GGUF error: ${response.statusText}`);
    }

    const data = await response.json() as any;
    const content = data.content ?? '';
    
    const inputTokens = estimateTokens(body.prompt);
    const outputTokens = estimateTokens(content);

    return { content, inputTokens, outputTokens, cost: 0, model };
  }

  async streamChat(
    messages: Message[],
    model: string,
    options: ChatOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    const { endpoint } = this.getConfig();

    const body = {
      prompt: this.formatPrompt(messages, options.systemPrompt),
      n_predict: options.maxTokens ?? 512,
      temperature: options.temperature ?? 0.7,
      stream: true,
    };

    const response = await fetchGguf(`${endpoint}/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`GGUF error: ${response.statusText}`);
    }

    let fullContent = '';
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
            try {
              const data = JSON.parse(line.slice(6)) as any;
              const text = data.content ?? '';
              if (text) {
                fullContent += text;
                onChunk({ text, done: false });
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

    const inputTokens = estimateTokens(body.prompt);
    const outputTokens = estimateTokens(fullContent);

    onChunk({ text: '', done: true, inputTokens, outputTokens });
    return { content: fullContent, inputTokens, outputTokens, cost: 0, model };
  }

  private formatPrompt(messages: Message[], systemPrompt?: string): string {
    let prompt = '';
    
    if (systemPrompt) {
      prompt += `System: ${systemPrompt}\n\n`;
    }

    for (const msg of messages) {
      const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
      prompt += `${role}: ${msg.content}\n`;
    }

    prompt += 'Assistant: ';
    return prompt;
  }
}
