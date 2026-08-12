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

export class ReplicateProvider implements Provider {
  name = 'replicate';
  displayName = 'Replicate';
  costClass: CostClass = 'paid';

  private getClient() {
    const apiKey = getApiKey('replicate');
    if (!apiKey) {
      throw new Error('Replicate API key not configured. Run: cude config set-key replicate <key>');
    }
    return { apiKey };
  }

  isConfigured(): boolean {
    return !!getApiKey('replicate');
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const { apiKey } = this.getClient();
      const response = await fetch('https://api.replicate.com/v1/account', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  listModels(): ModelInfo[] {
    return getModelsByProvider('replicate').map(m => ({
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

    // Format messages for Replicate
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const fullPrompt = options.systemPrompt 
      ? `system: ${options.systemPrompt}\n${prompt}` 
      : prompt;

    const body = {
      input: {
        prompt: fullPrompt,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature,
      },
    };

    const response = await fetch(`https://api.replicate.com/v1/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Replicate error: ${response.statusText}`);
    }

    const prediction = await response.json() as any;
    const predictionId = prediction.id;

    // Poll for completion
    while (prediction.status === 'processing') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      Object.assign(prediction, await statusResponse.json());
    }

    const content = Array.isArray(prediction.output) 
      ? prediction.output.join('') 
      : prediction.output ?? '';

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
    // Replicate doesn't support streaming in the traditional sense
    // So we just use chat and return it
    const response = await this.chat(messages, model, options);
    
    // Emit the full response as a single chunk
    onChunk({ text: response.content, done: false });
    onChunk({ 
      text: '', 
      done: true, 
      inputTokens: response.inputTokens, 
      outputTokens: response.outputTokens 
    });

    return response;
  }
}
