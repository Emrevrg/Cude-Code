import Anthropic from '@anthropic-ai/sdk';
import { getApiKey } from '../config/index.js';
import { calculateCost, getModelsByProvider } from '../config/models.js';
import type {
  Provider,
  Message,
  ChatResponse,
  StreamChunk,
  ChatOptions,
  ModelInfo,
  ToolDefinition,
  ToolCall,
} from './types.js';
import { toAnthropicWireMessages } from './wire.js';

export class AnthropicProvider implements Provider {
  name = 'anthropic';
  displayName = 'Anthropic Claude';

  private getClient(): Anthropic {
    const apiKey = getApiKey('anthropic');
    if (!apiKey) throw new Error('Anthropic API key not configured. Run: cude config set-key anthropic <key>');
    return new Anthropic({ apiKey });
  }

  isConfigured(): boolean {
    return !!getApiKey('anthropic');
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const client = this.getClient();
      // Make a minimal API call to verify the key works
      await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return true;
    } catch (err) {
      // If it's an auth error, key is invalid; otherwise consider available
      if (err instanceof Error && err.message.includes('401')) return false;
      // Rate limits, etc. still mean the provider is configured
      return true;
    }
  }

  listModels(): ModelInfo[] {
    return getModelsByProvider('anthropic').map(m => ({
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
    const client = this.getClient();

    const systemMessage = options.systemPrompt ?? messages.find(m => m.role === 'system')?.content;
    // tool_use / tool_result blocks, not plain text — see providers/wire.ts.
    const chatMessages = toAnthropicWireMessages(messages) as Anthropic.MessageParam[];

    const response = await client.messages.create({
      model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      system: systemMessage,
      messages: chatMessages,
    });

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
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

    const systemMessage = options.systemPrompt ?? messages.find(m => m.role === 'system')?.content;
    // tool_use / tool_result blocks, not plain text — see providers/wire.ts.
    const chatMessages = toAnthropicWireMessages(messages) as Anthropic.MessageParam[];

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const stream = await client.messages.create({
      model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      system: systemMessage,
      messages: chatMessages,
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const text = event.delta.text;
        fullContent += text;
        onChunk({ text, done: false });
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage.output_tokens;
      } else if (event.type === 'message_start') {
        inputTokens = event.message.usage.input_tokens;
      }
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
    const client = this.getClient();

    const systemMessage = options.systemPrompt ?? messages.find(m => m.role === 'system')?.content;
    // tool_use / tool_result blocks, not plain text — see providers/wire.ts.
    const chatMessages = toAnthropicWireMessages(messages) as Anthropic.MessageParam[];

    const anthropicTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        ...(t.parameters as object),
      },
    }));

    const response = await client.messages.create({
      model,
      max_tokens: options.maxTokens ?? 4096,
      system: systemMessage,
      messages: chatMessages,
      tools: anthropicTools,
    });

    const textContent = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');

    const toolCalls: ToolCall[] = response.content
      .filter(b => b.type === 'tool_use')
      .map(b => {
        const toolUse = b as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
        return {
          id: toolUse.id,
          name: toolUse.name,
          arguments: toolUse.input,
        };
      });

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost = calculateCost(model, inputTokens, outputTokens);

    return {
      response: { content: textContent, inputTokens, outputTokens, cost, model },
      toolCalls,
    };
  }
}
