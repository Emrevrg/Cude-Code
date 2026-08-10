import { GoogleGenerativeAI, type Content } from '@google/generative-ai';
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

export class GeminiProvider implements Provider {
  name = 'gemini';
  displayName = 'Google Gemini';

  private getClient(): GoogleGenerativeAI {
    const apiKey = getApiKey('gemini');
    if (!apiKey) throw new Error('Gemini API key not configured. Run: cude config set-key gemini <key>');
    return new GoogleGenerativeAI(apiKey);
  }

  isConfigured(): boolean {
    return !!getApiKey('gemini');
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const client = this.getClient();
      const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });
      await model.generateContent('test');
      return true;
    } catch {
      return false;
    }
  }

  listModels(): ModelInfo[] {
    return getModelsByProvider('gemini').map(m => ({
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

  private convertMessages(messages: Message[]): Content[] {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
  }

  async chat(messages: Message[], model: string, options: ChatOptions = {}): Promise<ChatResponse> {
    const client = this.getClient();
    const genModel = client.getGenerativeModel({
      model,
      systemInstruction: options.systemPrompt ?? messages.find(m => m.role === 'system')?.content,
    });

    const history = this.convertMessages(messages.slice(0, -1));
    const lastMessage = messages.filter(m => m.role !== 'system').at(-1);
    if (!lastMessage) throw new Error('No messages to send');

    const chat = genModel.startChat({
      history,
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
      },
    });

    const result = await chat.sendMessage(lastMessage.content);
    const content = result.response.text();

    const inputTokens = result.response.usageMetadata?.promptTokenCount
      ?? estimateTokens(messages.map(m => m.content).join(' '));
    const outputTokens = result.response.usageMetadata?.candidatesTokenCount
      ?? estimateTokens(content);

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
    const genModel = client.getGenerativeModel({
      model,
      systemInstruction: options.systemPrompt ?? messages.find(m => m.role === 'system')?.content,
    });

    const history = this.convertMessages(messages.slice(0, -1));
    const lastMessage = messages.filter(m => m.role !== 'system').at(-1);
    if (!lastMessage) throw new Error('No messages to send');

    const chat = genModel.startChat({
      history,
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
      },
    });

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const result = await chat.sendMessageStream(lastMessage.content);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        fullContent += text;
        onChunk({ text, done: false });
      }
    }

    const finalResponse = await result.response;
    inputTokens = finalResponse.usageMetadata?.promptTokenCount
      ?? estimateTokens(messages.map(m => m.content).join(' '));
    outputTokens = finalResponse.usageMetadata?.candidatesTokenCount
      ?? estimateTokens(fullContent);

    onChunk({ text: '', done: true, inputTokens, outputTokens });
    const cost = calculateCost(model, inputTokens, outputTokens);
    return { content: fullContent, inputTokens, outputTokens, cost, model };
  }
}
