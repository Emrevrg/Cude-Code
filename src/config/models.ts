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
  'claude-opus-4-8': {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    provider: 'anthropic',
    pricing: { inputPerMillion: 15, outputPerMillion: 75 },
    free: false,
    local: false,
    capabilities: ['code', 'complex', 'analysis', 'writing'],
    contextWindow: 200000,
  },
  'claude-sonnet-4-6': {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    pricing: { inputPerMillion: 3, outputPerMillion: 15 },
    free: false,
    local: false,
    capabilities: ['code', 'analysis', 'writing', 'general'],
    contextWindow: 200000,
  },
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    pricing: { inputPerMillion: 0.25, outputPerMillion: 1.25 },
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
