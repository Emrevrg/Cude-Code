export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamChunk {
  text: string;
  done: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  free: boolean;
  local: boolean;
}

export interface ProviderInfo {
  name: string;
  displayName: string;
  configured: boolean;
  models: ModelInfo[];
}

export interface Session {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  messages: Message[];
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface AppConfig {
  apiKeys: {
    anthropic?: string;
    openai?: string;
    gemini?: string;
    groq?: string;
  };
  defaultProvider?: string;
  defaultModel?: string;
  ollamaBaseUrl?: string;
  budgetAlertThreshold?: number;
  theme?: 'default' | 'minimal';
  firstRun?: boolean;
}

export interface BudgetStatus {
  totalLimit?: number;
  monthlyLimit?: number;
  alertThreshold?: number;
  totalSpent: number;
  monthlySpent: number;
  monthStart: string;
  sessionSpent: number;
  perProviderSpent: Record<string, number>;
  remaining: {
    total: number | undefined;
    monthly: number | undefined;
  };
}

export interface ChatOptions {
  provider: string;
  model: string;
  systemPrompt?: string;
}

declare global {
  interface Window {
    codiente: {
      chat: {
        send: (sessionId: string, messages: Message[], options: ChatOptions) => Promise<ChatResponse>;
        stream: (
          sessionId: string,
          messages: Message[],
          options: ChatOptions,
          onChunk: (chunk: StreamChunk) => void,
          onDone: (response: ChatResponse) => void,
          onError: (err: { message: string }) => void
        ) => string;
        stop: () => Promise<boolean>;
      };
      sessions: {
        list: () => Promise<Session[]>;
        create: (name?: string) => Promise<Session>;
        load: (id: string) => Promise<Session | null>;
        save: (session: Session) => Promise<boolean>;
        delete: (id: string) => Promise<boolean>;
        rename: (id: string, name: string) => Promise<boolean>;
      };
      config: {
        get: () => Promise<AppConfig>;
        setKey: (provider: string, key: string) => Promise<boolean>;
        set: (key: string, value: unknown) => Promise<boolean>;
      };
      providers: {
        list: () => Promise<ProviderInfo[]>;
        test: (name: string) => Promise<{ available: boolean; error?: string }>;
        models: (name: string) => Promise<ModelInfo[]>;
      };
      budget: {
        status: () => Promise<BudgetStatus>;
        set: (amount: number, monthly?: boolean) => Promise<boolean>;
      };
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
      };
    };
  }
}
