import { getApiKey } from '../config/index.js';
import { calculateCost, estimateTokens, getModelsByProvider } from '../config/models.js';
import type {
  Provider,
  Message,
  ChatResponse,
  StreamChunk,
  ChatOptions,
  ModelInfo,
} from './types.js';

export class AzureOpenAIProvider implements Provider {
  name = 'azure';
  displayName = 'Azure OpenAI';

  private getClient() {
    const endpoint = getApiKey('azure-endpoint');
    const apiKey = getApiKey('azure');
    if (!endpoint || !apiKey) {
      throw new Error(
        'Azure OpenAI not configured. Run: cude config set-key azure <key> and cude config set azure-endpoint <endpoint>'
      );
    }
    return { endpoint, apiKey };
  }

  isConfigured(): boolean {
    return !!getApiKey('azure') && !!getApiKey('azure-endpoint');
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const { endpoint, apiKey } = this.getClient();
      const response = await fetch(`${endpoint}/deployments?api-version=2023-05-15`, {
        headers: { 'api-key': apiKey },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  listModels(): ModelInfo[] {
    return getModelsByProvider('azure').map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      free: m.free,
      local: m.local,
    }));
  }

  supportsTools(): boolean {
    return true;
  }

  async chat(messages: Message[], model: string, options: ChatOptions = {}): Promise<ChatResponse> {
    const { endpoint, apiKey } = this.getClient();

    const body = {
      messages: [
        ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        ...messages,
      ],
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
    };

    const response = await fetch(`${endpoint}/deployments/${model}/chat/completions?api-version=2023-05-15`, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Azure OpenAI error: ${response.statusText}`);
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
    const { endpoint, apiKey } = this.getClient();

    const body = {
      messages: [
        ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        ...messages,
      ],
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      stream: true,
    };

    const response = await fetch(`${endpoint}/deployments/${model}/chat/completions?api-version=2023-05-15`, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Azure OpenAI error: ${response.statusText}`);
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
}
