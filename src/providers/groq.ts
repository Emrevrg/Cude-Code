import OpenAI from 'openai';
import { getApiKey } from '../config/index.js';
import { estimateTokens, getModelsByProvider } from '../config/models.js';
import type {
  Provider,
  Message,
  ChatResponse,
  StreamChunk,
  ChatOptions,
  ModelInfo,
} from './types.js';
import { toOpenAIWireMessages } from './wire.js';

export class GroqProvider implements Provider {
  name = 'groq';
  displayName = 'Groq (Free)';

  private getClient(): OpenAI {
    const apiKey = getApiKey('groq');
    if (!apiKey) throw new Error('Groq API key not configured. Run: cude config set-key groq <key>');
    return new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }

  isConfigured(): boolean {
    return !!getApiKey('groq');
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const client = this.getClient();
      await client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  listModels(): ModelInfo[] {
    return getModelsByProvider('groq').map(m => ({
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

    const groqMessages = toOpenAIWireMessages(
      messages,
      options.systemPrompt
    ) as unknown as OpenAI.Chat.ChatCompletionMessageParam[];

    const response = await client.chat.completions.create({
      model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      messages: groqMessages,
    });

    const content = response.choices[0]?.message?.content ?? '';
    const inputTokens = response.usage?.prompt_tokens ?? estimateTokens(messages.map(m => m.content).join(' '));
    const outputTokens = response.usage?.completion_tokens ?? estimateTokens(content);

    return { content, inputTokens, outputTokens, cost: 0, model };
  }

  async streamChat(
    messages: Message[],
    model: string,
    options: ChatOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    const client = this.getClient();

    const groqMessages = toOpenAIWireMessages(
      messages,
      options.systemPrompt
    ) as unknown as OpenAI.Chat.ChatCompletionMessageParam[];

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const stream = await client.chat.completions.create({
      model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      messages: groqMessages,
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

    onChunk({ text: '', done: true, inputTokens, outputTokens });
    return { content: fullContent, inputTokens, outputTokens, cost: 0, model };
  }
}
