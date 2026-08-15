import OpenAI from 'openai';
import { calculateCost, estimateTokens } from '../config/models.js';
import { getCustomProviders } from '../config/index.js';
import type { Provider, Message, ChatResponse, StreamChunk, ChatOptions, ModelInfo, ToolDefinition, ToolCall, CostClass } from './types.js';
import { toOpenAIWireMessages } from './wire.js';

export class CustomOpenAIProvider implements Provider {
  name: string;
  displayName: string;
  costClass: CostClass;
  private readonly config;

  constructor(config: ReturnType<typeof getCustomProviders>[number]) {
    this.config = config;
    this.name = config.name;
    this.displayName = config.displayName;
    this.costClass = config.local ? 'local' : 'mixed';
  }

  private key(): string {
    const value = this.config.apiKeyEnv ? process.env[this.config.apiKeyEnv] : this.config.apiKey;
    return value ?? 'cude-local-no-key';
  }

  private client(): OpenAI {
    return new OpenAI({ apiKey: this.key(), baseURL: this.config.baseUrl.replace(/\/$/, '') });
  }

  isConfigured(): boolean { return Boolean(this.config.baseUrl && this.config.model); }
  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try { await this.client().models.list(); return true; } catch { return false; }
  }
  listModels(): ModelInfo[] {
    return [{ id: this.config.model, name: this.config.model, provider: this.name, free: Boolean(this.config.local), local: Boolean(this.config.local) }];
  }
  supportsTools(): boolean { return true; }

  async chat(messages: Message[], model: string, options: ChatOptions = {}): Promise<ChatResponse> {
    const response = await this.client().chat.completions.create({ model, max_tokens: options.maxTokens ?? 4096, temperature: options.temperature, messages: toOpenAIWireMessages(messages, options.systemPrompt) as OpenAI.Chat.ChatCompletionMessageParam[] });
    const content = response.choices[0]?.message?.content ?? '';
    const inputTokens = response.usage?.prompt_tokens ?? estimateTokens(messages.map(m => m.content).join(' '));
    const outputTokens = response.usage?.completion_tokens ?? estimateTokens(content);
    return { content, inputTokens, outputTokens, cost: this.config.local ? 0 : calculateCost(model, inputTokens, outputTokens), model };
  }

  async streamChat(messages: Message[], model: string, options: ChatOptions, onChunk: (chunk: StreamChunk) => void): Promise<ChatResponse> {
    const stream = await this.client().chat.completions.create({ model, max_tokens: options.maxTokens ?? 4096, temperature: options.temperature, messages: toOpenAIWireMessages(messages, options.systemPrompt) as OpenAI.Chat.ChatCompletionMessageParam[], stream: true, stream_options: { include_usage: true } });
    let content = ''; let inputTokens = 0; let outputTokens = 0;
    for await (const event of stream) { const text = event.choices[0]?.delta?.content; if (text) { content += text; onChunk({ text, done: false }); } if (event.usage) { inputTokens = event.usage.prompt_tokens; outputTokens = event.usage.completion_tokens; } }
    if (!inputTokens) { inputTokens = estimateTokens(messages.map(m => m.content).join(' ')); outputTokens = estimateTokens(content); }
    onChunk({ text: '', done: true, inputTokens, outputTokens });
    return { content, inputTokens, outputTokens, cost: this.config.local ? 0 : calculateCost(model, inputTokens, outputTokens), model };
  }

  async chatWithTools(messages: Message[], model: string, tools: ToolDefinition[], options: ChatOptions = {}): Promise<{ response: ChatResponse; toolCalls: ToolCall[] }> {
    const wireTools = tools.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
    const response = await this.client().chat.completions.create({ model, max_tokens: options.maxTokens ?? 4096, messages: toOpenAIWireMessages(messages, options.systemPrompt) as OpenAI.Chat.ChatCompletionMessageParam[], tools: wireTools, tool_choice: 'auto' });
    const choice = response.choices[0]; const content = choice?.message?.content ?? '';
    const toolCalls = (choice?.message?.tool_calls ?? []).map(tc => ({ id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments) as Record<string, unknown> }));
    const inputTokens = response.usage?.prompt_tokens ?? estimateTokens(messages.map(m => m.content).join(' '));
    const outputTokens = response.usage?.completion_tokens ?? estimateTokens(content);
    return { response: { content, inputTokens, outputTokens, cost: this.config.local ? 0 : calculateCost(model, inputTokens, outputTokens), model }, toolCalls };
  }
}
