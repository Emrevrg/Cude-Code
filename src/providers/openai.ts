import OpenAI from 'openai';
import { getApiKey } from '../config/index.js';
import { calculateCost, estimateTokens, getModelsByProvider } from '../config/models.js';
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
import { toOpenAIWireMessages } from './wire.js';

export class OpenAIProvider implements Provider {
  name = 'openai';
  displayName = 'OpenAI GPT';

  private getClient(): OpenAI {
    const apiKey = getApiKey('openai');
    if (!apiKey) throw new Error('OpenAI API key not configured. Run: cude config set-key openai <key>');
    return new OpenAI({ apiKey });
  }

  isConfigured(): boolean {
    return !!getApiKey('openai');
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
    return getModelsByProvider('openai').map(m => ({
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

    // Tool calls and tool results travel in the protocol's own fields — see
    // providers/wire.ts.
    const openaiMessages = toOpenAIWireMessages(
      messages,
      options.systemPrompt
    ) as unknown as OpenAI.Chat.ChatCompletionMessageParam[];

    const response = await client.chat.completions.create({
      model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      messages: openaiMessages,
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

    // Tool calls and tool results travel in the protocol's own fields — see
    // providers/wire.ts.
    const openaiMessages = toOpenAIWireMessages(
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
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true },
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

    // Tool calls and tool results travel in the protocol's own fields — see
    // providers/wire.ts.
    const openaiMessages = toOpenAIWireMessages(
      messages,
      options.systemPrompt
    ) as unknown as OpenAI.Chat.ChatCompletionMessageParam[];

    const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      },
    }));

    const response = await client.chat.completions.create({
      model,
      max_tokens: options.maxTokens ?? 4096,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: 'auto',
    });

    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    const inputTokens = response.usage?.prompt_tokens ?? estimateTokens(messages.map(m => m.content).join(' '));
    const outputTokens = response.usage?.completion_tokens ?? estimateTokens(content);
    const cost = calculateCost(model, inputTokens, outputTokens);

    return {
      response: { content, inputTokens, outputTokens, cost, model },
      toolCalls,
    };
  }
}
