import { getOllamaBaseUrl } from '../config/index.js';
import { estimateTokens } from '../config/models.js';
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
const fetchOllama = (url: string, init?: RequestInit): Promise<Response> =>
  fetchProvider(url, init, 'Ollama', 'Start it with: ollama serve');

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements Provider {
  name = 'ollama';
  displayName = 'Ollama (Local)';
  costClass: CostClass = 'local';

  private getBaseUrl(): string {
    return getOllamaBaseUrl();
  }

  isConfigured(): boolean {
    return true; // Always configured (local)
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetchOllama(`${this.getBaseUrl()}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getInstalledModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetchOllama(`${this.getBaseUrl()}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json() as { models: OllamaModel[] };
      return data.models ?? [];
    } catch {
      return [];
    }
  }

  listModels(): ModelInfo[] {
    // Return a placeholder; actual models must be fetched async
    return [
      {
        id: 'ollama/llama3',
        name: 'Llama 3 (local)',
        provider: 'ollama',
        free: true,
        local: true,
      },
    ];
  }

  supportsTools(): boolean {
    return false;
  }

  private buildPrompt(messages: Message[], systemPrompt?: string): string {
    const parts: string[] = [];
    const sys = systemPrompt ?? messages.find(m => m.role === 'system')?.content;
    if (sys) parts.push(`System: ${sys}\n`);
    for (const m of messages.filter(msg => msg.role !== 'system')) {
      if (m.role === 'user') {
        parts.push(`User: ${m.content}`);
      } else {
        parts.push(`Assistant: ${m.content}`);
      }
    }
    parts.push('Assistant:');
    return parts.join('\n');
  }

  async chat(messages: Message[], model: string, options: ChatOptions = {}): Promise<ChatResponse> {
    const ollamaModel = model.replace('ollama/', '');
    const prompt = this.buildPrompt(messages, options.systemPrompt);

    const response = await fetchOllama(`${this.getBaseUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        prompt,
        stream: false,
        options: {
          num_predict: options.maxTokens ?? 4096,
          temperature: options.temperature ?? 0.7,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}. Make sure the model is pulled: ollama pull ${ollamaModel}`);
    }

    const data = await response.json() as OllamaGenerateResponse;
    const content = data.response;
    const inputTokens = data.prompt_eval_count ?? estimateTokens(prompt);
    const outputTokens = data.eval_count ?? estimateTokens(content);

    return { content, inputTokens, outputTokens, cost: 0, model };
  }

  async streamChat(
    messages: Message[],
    model: string,
    options: ChatOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    const ollamaModel = model.replace('ollama/', '');
    const prompt = this.buildPrompt(messages, options.systemPrompt);

    const response = await fetchOllama(`${this.getBaseUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        prompt,
        stream: true,
        options: {
          num_predict: options.maxTokens ?? 4096,
          temperature: options.temperature ?? 0.7,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}. Make sure the model is pulled: ollama pull ${ollamaModel}`);
    }

    if (!response.body) throw new Error('No response body from Ollama');

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line) as OllamaGenerateResponse;
          if (data.response) {
            fullContent += data.response;
            onChunk({ text: data.response, done: false });
          }
          if (data.done) {
            inputTokens = data.prompt_eval_count ?? estimateTokens(prompt);
            outputTokens = data.eval_count ?? estimateTokens(fullContent);
          }
        } catch {
          // skip invalid JSON lines
        }
      }
    }

    onChunk({ text: '', done: true, inputTokens, outputTokens });
    return { content: fullContent, inputTokens, outputTokens, cost: 0, model };
  }
}
