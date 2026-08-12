import { getApiKey } from '../config/index.js';
import { calculateCost, estimateTokens, getModelsByProvider } from '../config/models.js';
import type {
  Provider,
  Message,
  ChatResponse,
  StreamChunk,
  ChatOptions,
  ModelInfo,
  CostClass,
} from './types.js';

export class HuggingFaceProvider implements Provider {
  name = 'huggingface';
  displayName = 'HuggingFace Inference API';
  costClass: CostClass = 'mixed';

  private getClient() {
    const apiKey = getApiKey('huggingface');
    if (!apiKey) {
      throw new Error('HuggingFace API key not configured. Run: cude config set-key huggingface <key>');
    }
    return { apiKey };
  }

  isConfigured(): boolean {
    return !!getApiKey('huggingface');
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const { apiKey } = this.getClient();
      const response = await fetch('https://api-inference.huggingface.co/status', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  listModels(): ModelInfo[] {
    return getModelsByProvider('huggingface').map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      free: m.free,
      local: m.local,
    }));
  }

  supportsTools(): boolean {
    return false;
  }

  async chat(messages: Message[], model: string, options: ChatOptions = {}): Promise<ChatResponse> {
    const { apiKey } = this.getClient();

    // Format messages for HuggingFace Inference API
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const fullPrompt = options.systemPrompt 
      ? `system: ${options.systemPrompt}\n${prompt}` 
      : prompt;

    const body = {
      inputs: fullPrompt,
      parameters: {
        max_new_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
      },
    };

    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HuggingFace error: ${response.statusText}`);
    }

    const data = await response.json() as any;
    const content = Array.isArray(data) ? data[0]?.generated_text ?? '' : data.generated_text ?? '';
    
    const inputTokens = estimateTokens(fullPrompt);
    const outputTokens = estimateTokens(content);
    const cost = calculateCost(model, inputTokens, outputTokens);

    return { content, inputTokens, outputTokens, cost, model };
  }

  async streamChat(
    messages: Message[],
    model: string,
    options: ChatOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    const { apiKey } = this.getClient();

    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const fullPrompt = options.systemPrompt 
      ? `system: ${options.systemPrompt}\n${prompt}` 
      : prompt;

    const body = {
      inputs: fullPrompt,
      parameters: {
        max_new_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
      },
      stream: true,
    };

    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HuggingFace error: ${response.statusText}`);
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
          if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.slice(5)) as any;
              const token = data.token?.text ?? '';
              if (token) {
                fullContent += token;
                onChunk({ text: token, done: false });
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

    const inputTokens = estimateTokens(fullPrompt);
    const outputTokens = estimateTokens(fullContent);

    onChunk({ text: '', done: true, inputTokens, outputTokens });
    const cost = calculateCost(model, inputTokens, outputTokens);
    return { content: fullContent, inputTokens, outputTokens, cost, model };
  }
}
