export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface StreamChunk {
  text: string;
  done: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  free: boolean;
  local: boolean;
}

export interface ChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Provider {
  name: string;
  displayName: string;
  isConfigured(): boolean;
  isAvailable(): Promise<boolean>;
  chat(messages: Message[], model: string, options?: ChatOptions): Promise<ChatResponse>;
  streamChat(
    messages: Message[],
    model: string,
    options: ChatOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ChatResponse>;
  listModels(): ModelInfo[];
  supportsTools(): boolean;
  chatWithTools?(
    messages: Message[],
    model: string,
    tools: ToolDefinition[],
    options?: ChatOptions
  ): Promise<{ response: ChatResponse; toolCalls: ToolCall[] }>;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  stream?: boolean;
}
