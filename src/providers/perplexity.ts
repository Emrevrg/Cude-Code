import OpenAI from 'openai';
import { getApiKey } from '../config/index.js';
import { calculateCost, estimateTokens, getModelsByProvider } from '../config/models.js';
import { toOpenAIMessages } from './openai-mapping.js';
import type {
  Provider,
  Message,
  ChatResponse,
  StreamChunk,
  ChatOptions,
  ModelInfo,
} from './types.js';

/**
 * Perplexity AI provider â€” models have live internet access for real-time web search.
 */
export class PerplexityProvider implements Provider {
  name = 'perplexity';
  displayName = 'Perplexity AI (Web Search)';

  private getClient(): OpenAI {
    const apiKey = getApiKey('perplexity');
    if (!apiKey) throw new Error('Perplexity API key not configured. Run: cude config set-key perplexity <key>');
    return new OpenAI({
      apiKey,
      baseURL: 'https://api.perplexity.ai',
    });
  }

  isConfigured(): boolean {
    return !!getApiKey('perplexity');
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      // Perplexity doesn't expose a models list endpoint via OpenAI SDK;
      // treat configured as available.
      return true;
    } catch {
      return false;
    }
  }

  listModels(): ModelInfo[] {
    return getModelsByProvider('perplexity').map(m => ({
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
    const client = this.getClient();

    const pxMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options.systemPrompt) {
      pxMessages.push({ role: 'system', content: options.systemPrompt });
    }
    pxMessages.push(...toOpenAIMessages(messages));

    const response = await client.chat.completions.create({
      model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      messages: pxMessages,
    });

    const content = response.choices[0]?.message?.content ?? '';
    const inputTokens = response.usage?.prompt_tokens ?? estimateTokens(messages.map(m => m.content).join(' '));
    const outputTokens = response.usage?.completion_tokens ?? estimateTokens(content);
    const cost = calculateCost(model, inputTokens, outputTokens);

    return { content, inputTokens, outputTokens, cost, model };
  }

  async streamChat(
    messages: Message[],
    model: string,
    options: ChatOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    const client = this.getClient();

    const pxMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options.systemPrompt) {
      pxMessages.push({ role: 'system', content: options.systemPrompt });
    }
    pxMessages.push(...toOpenAIMessages(messages));

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const stream = await client.chat.completions.create({
      model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      messages: pxMessages,
      stream: true,
    });

    for await (const event of stream) {
      const delta = event.choices[0]?.delta?.content;
      if (delta) {
        fullContent += delta;
        onChunk({ text: delta, done: false });
      }
      if (event.usage) {
        inputTokens = event.usage.prompt_tokens;
        outputTokens = event.usage.completion_tokens;
      }
    }

    if (inputTokens === 0) {
      inputTokens = estimateTokens(messages.map(m => m.content).join(' '));
      outputTokens = estimateTokens(fullContent);
    }

    const cost = calculateCost(model, inputTokens, outputTokens);
    onChunk({ text: '', done: true, inputTokens, outputTokens });
    return { content: fullContent, inputTokens, outputTokens, cost, model };
  }
}
