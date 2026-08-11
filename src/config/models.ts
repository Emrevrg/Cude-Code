export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface ModelDefinition {
  id: string;
  name: string;
  provider: string;
  pricing: ModelPricing;
  free: boolean;
  local: boolean;
  capabilities: string[];
  contextWindow: number;
}

export const MODELS: Record<string, ModelDefinition> = {
  'claude-opus-5': {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    provider: 'anthropic',
    pricing: { inputPerMillion: 5, outputPerMillion: 25 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing', 'reasoning'],
    contextWindow: 1000000,
  },
  'claude-sonnet-5': {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    provider: 'anthropic',
    pricing: { inputPerMillion: 3, outputPerMillion: 15 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis', 'writing', 'general', 'reasoning'],
    contextWindow: 1000000,
  },
  'claude-fable-5': {
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    provider: 'anthropic',
    pricing: { inputPerMillion: 10, outputPerMillion: 50 },
    free: false,
    local: false,
    capabilities: ['complex', 'reasoning', 'analysis', 'code'],
    contextWindow: 1000000,
  },
  'claude-opus-4-8': {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    provider: 'anthropic',
    pricing: { inputPerMillion: 5, outputPerMillion: 25 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing'],
    contextWindow: 1000000,
  },
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    pricing: { inputPerMillion: 1, outputPerMillion: 5 },
    free: false,
    local: false,
    capabilities: ['quick', 'general', 'summarize'],
    contextWindow: 200000,
  },
  'gpt-4o': {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    pricing: { inputPerMillion: 5, outputPerMillion: 15 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing', 'vision'],
    contextWindow: 128000,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.60 },
    free: false,
    local: false,
    capabilities: ['quick', 'general', 'summarize'],
    contextWindow: 128000,
  },
  'gemini-1.5-pro': {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'gemini',
    pricing: { inputPerMillion: 3.5, outputPerMillion: 10.5 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing', 'vision'],
    contextWindow: 1000000,
  },
  'gemini-1.5-flash': {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'gemini',
    pricing: { inputPerMillion: 0.075, outputPerMillion: 0.30 },
    free: true,
    local: false,
    capabilities: ['quick', 'general', 'code', 'vision'],
    contextWindow: 1000000,
  },
  'llama-3.3-70b-versatile': {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B Versatile',
    provider: 'groq',
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    free: true,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing', 'general'],
    contextWindow: 128000,
  },
  'llama-3.1-8b-instant': {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant',
    provider: 'groq',
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    free: true,
    local: false,
    capabilities: ['quick', 'general', 'summarize'],
    contextWindow: 128000,
  },

  // OpenRouter models
  'openrouter/auto': {
    id: 'openrouter/auto',
    name: 'OpenRouter Auto',
    provider: 'openrouter',
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing', 'general'],
    contextWindow: 200000,
  },
  'meta-llama/llama-3.3-70b-instruct': {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct (OpenRouter)',
    provider: 'openrouter',
    pricing: { inputPerMillion: 0.12, outputPerMillion: 0.3 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis', 'writing', 'general'],
    contextWindow: 128000,
  },
  'google/gemini-2.0-flash-exp:free': {
    id: 'google/gemini-2.0-flash-exp:free',
    name: 'Gemini 2.0 Flash (Free via OpenRouter)',
    provider: 'openrouter',
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    free: true,
    local: false,
    capabilities: ['code', 'analysis', 'writing', 'general', 'vision'],
    contextWindow: 1000000,
  },
  'deepseek/deepseek-r1:free': {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1 (Free via OpenRouter)',
    provider: 'openrouter',
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    free: true,
    local: false,
    capabilities: ['complex', 'analysis', 'reasoning'],
    contextWindow: 64000,
  },
  'microsoft/phi-4': {
    id: 'microsoft/phi-4',
    name: 'Microsoft Phi-4 (OpenRouter)',
    provider: 'openrouter',
    pricing: { inputPerMillion: 0.07, outputPerMillion: 0.14 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis', 'general'],
    contextWindow: 16000,
  },
  'qwen/qwen-2.5-72b-instruct': {
    id: 'qwen/qwen-2.5-72b-instruct',
    name: 'Qwen 2.5 72B Instruct (OpenRouter)',
    provider: 'openrouter',
    pricing: { inputPerMillion: 0.13, outputPerMillion: 0.4 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis', 'writing', 'general'],
    contextWindow: 128000,
  },

  // NVIDIA NIM models
  'nvidia/llama-3.1-nemotron-70b-instruct': {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    name: 'Llama 3.1 Nemotron 70B Instruct',
    provider: 'nvidia',
    pricing: { inputPerMillion: 0.35, outputPerMillion: 0.4 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing', 'general'],
    contextWindow: 128000,
  },
  'meta/llama-3.3-70b-instruct': {
    id: 'meta/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct (NVIDIA)',
    provider: 'nvidia',
    pricing: { inputPerMillion: 0.35, outputPerMillion: 0.4 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis', 'writing', 'general'],
    contextWindow: 128000,
  },
  'mistralai/mixtral-8x7b-instruct-v0.1': {
    id: 'mistralai/mixtral-8x7b-instruct-v0.1',
    name: 'Mixtral 8x7B Instruct (NVIDIA)',
    provider: 'nvidia',
    pricing: { inputPerMillion: 0.6, outputPerMillion: 0.6 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis', 'writing', 'general'],
    contextWindow: 32000,
  },
  'nvidia/neva-22b': {
    id: 'nvidia/neva-22b',
    name: 'NEVA 22B (Vision)',
    provider: 'nvidia',
    pricing: { inputPerMillion: 1.8, outputPerMillion: 1.8 },
    free: false,
    local: false,
    capabilities: ['vision', 'analysis', 'general'],
    contextWindow: 4096,
  },

  // Mistral AI models
  'mistral-large-latest': {
    id: 'mistral-large-latest',
    name: 'Mistral Large',
    provider: 'mistral',
    pricing: { inputPerMillion: 2, outputPerMillion: 6 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing', 'general'],
    contextWindow: 128000,
  },
  'mistral-medium-latest': {
    id: 'mistral-medium-latest',
    name: 'Mistral Medium',
    provider: 'mistral',
    pricing: { inputPerMillion: 0.4, outputPerMillion: 2 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis', 'writing', 'general'],
    contextWindow: 128000,
  },
  'mistral-small-latest': {
    id: 'mistral-small-latest',
    name: 'Mistral Small',
    provider: 'mistral',
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.3 },
    free: false,
    local: false,
    capabilities: ['quick', 'general', 'summarize'],
    contextWindow: 128000,
  },
  'codestral-latest': {
    id: 'codestral-latest',
    name: 'Codestral (Coding Specialist)',
    provider: 'mistral',
    pricing: { inputPerMillion: 0.2, outputPerMillion: 0.6 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis'],
    contextWindow: 256000,
  },
  'open-mistral-nemo': {
    id: 'open-mistral-nemo',
    name: 'Mistral Nemo (Open)',
    provider: 'mistral',
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.15 },
    free: false,
    local: false,
    capabilities: ['general', 'writing', 'summarize'],
    contextWindow: 128000,
  },

  // Together AI models
  'meta-llama/Llama-3-70b-chat-hf': {
    id: 'meta-llama/Llama-3-70b-chat-hf',
    name: 'Llama 3 70B Chat (Together)',
    provider: 'together',
    pricing: { inputPerMillion: 0.9, outputPerMillion: 0.9 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis', 'writing', 'general'],
    contextWindow: 8000,
  },
  'mistralai/Mixtral-8x22B-Instruct-v0.1': {
    id: 'mistralai/Mixtral-8x22B-Instruct-v0.1',
    name: 'Mixtral 8x22B Instruct (Together)',
    provider: 'together',
    pricing: { inputPerMillion: 1.2, outputPerMillion: 1.2 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing', 'general'],
    contextWindow: 65536,
  },
  'deepseek-ai/deepseek-coder-33b-instruct': {
    id: 'deepseek-ai/deepseek-coder-33b-instruct',
    name: 'DeepSeek Coder 33B (Together)',
    provider: 'together',
    pricing: { inputPerMillion: 0.8, outputPerMillion: 0.8 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis'],
    contextWindow: 16384,
  },
  'Qwen/Qwen2.5-72B-Instruct-Turbo': {
    id: 'Qwen/Qwen2.5-72B-Instruct-Turbo',
    name: 'Qwen 2.5 72B Instruct Turbo (Together)',
    provider: 'together',
    pricing: { inputPerMillion: 1.2, outputPerMillion: 1.2 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis', 'writing', 'general'],
    contextWindow: 32768,
  },

  // Perplexity AI models
  'llama-3.1-sonar-huge-128k-online': {
    id: 'llama-3.1-sonar-huge-128k-online',
    name: 'Sonar Huge 128K (Web Search)',
    provider: 'perplexity',
    pricing: { inputPerMillion: 5, outputPerMillion: 15 },
    free: false,
    local: false,
    capabilities: ['research', 'analysis', 'general', 'web'],
    contextWindow: 127072,
  },
  'llama-3.1-sonar-large-128k-online': {
    id: 'llama-3.1-sonar-large-128k-online',
    name: 'Sonar Large 128K (Web Search)',
    provider: 'perplexity',
    pricing: { inputPerMillion: 1, outputPerMillion: 1 },
    free: false,
    local: false,
    capabilities: ['research', 'analysis', 'general', 'web'],
    contextWindow: 127072,
  },
  'llama-3.1-sonar-small-128k-online': {
    id: 'llama-3.1-sonar-small-128k-online',
    name: 'Sonar Small 128K (Web Search)',
    provider: 'perplexity',
    pricing: { inputPerMillion: 0.2, outputPerMillion: 0.2 },
    free: false,
    local: false,
    capabilities: ['research', 'general', 'web', 'quick'],
    contextWindow: 127072,
  },

  // DeepSeek models
  'deepseek-chat': {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat (V3)',
    provider: 'deepseek',
    pricing: { inputPerMillion: 0.14, outputPerMillion: 0.28 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis', 'writing', 'general'],
    contextWindow: 64000,
  },
  'deepseek-reasoner': {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner (R1)',
    provider: 'deepseek',
    pricing: { inputPerMillion: 0.55, outputPerMillion: 2.19 },
    free: false,
    local: false,
    capabilities: ['complex', 'analysis', 'reasoning', 'code'],
    contextWindow: 64000,
  },

  // xAI Grok models
  'grok-2-1212': {
    id: 'grok-2-1212',
    name: 'Grok 2',
    provider: 'xai',
    pricing: { inputPerMillion: 2, outputPerMillion: 10 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing', 'general'],
    contextWindow: 131072,
  },
  'grok-2-vision-1212': {
    id: 'grok-2-vision-1212',
    name: 'Grok 2 Vision',
    provider: 'xai',
    pricing: { inputPerMillion: 2, outputPerMillion: 10 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing', 'vision'],
    contextWindow: 32768,
  },
  'grok-beta': {
    id: 'grok-beta',
    name: 'Grok Beta',
    provider: 'xai',
    pricing: { inputPerMillion: 5, outputPerMillion: 15 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing', 'general'],
    contextWindow: 131072,
  },

  // Cohere models
  'command-r-plus': {
    id: 'command-r-plus',
    name: 'Command R+',
    provider: 'cohere',
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing', 'general'],
    contextWindow: 128000,
  },
  'command-r': {
    id: 'command-r',
    name: 'Command R',
    provider: 'cohere',
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    free: false,
    local: false,
    capabilities: ['analysis', 'writing', 'general'],
    contextWindow: 128000,
  },
  'command': {
    id: 'command',
    name: 'Command',
    provider: 'cohere',
    pricing: { inputPerMillion: 1, outputPerMillion: 2 },
    free: false,
    local: false,
    capabilities: ['general', 'writing', 'summarize'],
    contextWindow: 4096,
  },
};

export function getModelsByProvider(provider: string): ModelDefinition[] {
  return Object.values(MODELS).filter(m => m.provider === provider);
}

export function getFreeModels(): ModelDefinition[] {
  return Object.values(MODELS).filter(m => m.free || m.local);
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const modelDef = MODELS[model];
  if (!modelDef) return 0;

  const inputCost = (inputTokens / 1_000_000) * modelDef.pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * modelDef.pricing.outputPerMillion;
  return inputCost + outputCost;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
