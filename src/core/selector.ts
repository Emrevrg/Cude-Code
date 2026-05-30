import { getProvider, listProviders } from '../providers/index.js';
import { getDefaultProvider, getDefaultModel, getApiKey } from '../config/index.js';
import { getRemainingBudget } from '../storage/budget.js';
import { MODELS } from '../config/models.js';
import type { Provider } from '../providers/types.js';

export type TaskType = 'code' | 'quick' | 'complex' | 'general' | 'analysis' | 'writing';

export interface ProviderModelPair {
  provider: Provider;
  model: string;
  reason: string;
}

export function selectProviderAndModel(
  taskType: TaskType = 'general',
  options: {
    free?: boolean;
    preferredProvider?: string;
    preferredModel?: string;
  } = {}
): ProviderModelPair {
  const { free = false } = options;

  // If user specified both, use them
  if (options.preferredProvider && options.preferredModel) {
    const provider = getProvider(options.preferredProvider);
    return {
      provider,
      model: options.preferredModel,
      reason: 'User specified',
    };
  }

  // If user specified model only, find its provider
  if (options.preferredModel) {
    const modelDef = MODELS[options.preferredModel];
    if (modelDef) {
      const provider = getProvider(modelDef.provider);
      if (provider.isConfigured() || modelDef.free || modelDef.local) {
        return {
          provider,
          model: options.preferredModel,
          reason: 'User specified model',
        };
      }
    }
  }

  // Check budget constraints
  const remaining = getRemainingBudget();
  const lowBudget = (remaining.total !== undefined && remaining.total < 1) ||
                    (remaining.monthly !== undefined && remaining.monthly < 1);

  // If budget exceeded, force free
  const useFree = free || (remaining.total === 0) || (remaining.monthly === 0);

  // Free/low-budget path
  if (useFree || lowBudget) {
    return selectFreeProvider(taskType, lowBudget);
  }

  // Default provider from config
  const defaultProvider = options.preferredProvider ?? getDefaultProvider();
  const defaultModel = getDefaultModel();

  if (defaultProvider && defaultModel) {
    try {
      const provider = getProvider(defaultProvider);
      if (provider.isConfigured()) {
        return {
          provider,
          model: defaultModel,
          reason: 'Default configuration',
        };
      }
    } catch {
      // provider not found, continue
    }
  }

  // Smart selection based on task type
  return selectByTaskType(taskType);
}

function selectFreeProvider(taskType: TaskType, lowBudget: boolean): ProviderModelPair {
  const reason = lowBudget ? 'Low budget - using free provider' : 'Free mode';

  // Check Groq first (fast, powerful)
  if (getApiKey('groq')) {
    const provider = getProvider('groq');
    const model = taskType === 'quick'
      ? 'llama-3.1-8b-instant'
      : 'llama-3.3-70b-versatile';
    return { provider, model, reason };
  }

  // Check Gemini (has free tier)
  if (getApiKey('gemini')) {
    const provider = getProvider('gemini');
    return { provider, model: 'gemini-1.5-flash', reason };
  }

  // Try Ollama (always available locally)
  const ollamaProvider = getProvider('ollama');
  return { provider: ollamaProvider, model: 'ollama/llama3', reason: 'Local Ollama' };
}

function selectByTaskType(taskType: TaskType): ProviderModelPair {
  const anthropicKey = getApiKey('anthropic');
  const openaiKey = getApiKey('openai');
  const geminiKey = getApiKey('gemini');
  const groqKey = getApiKey('groq');

  switch (taskType) {
    case 'code':
      if (anthropicKey) {
        return {
          provider: getProvider('anthropic'),
          model: 'claude-sonnet-4-6',
          reason: 'Best for code tasks',
        };
      }
      if (openaiKey) {
        return {
          provider: getProvider('openai'),
          model: 'gpt-4o',
          reason: 'Good for code tasks',
        };
      }
      break;

    case 'complex':
    case 'analysis':
      if (anthropicKey) {
        return {
          provider: getProvider('anthropic'),
          model: 'claude-opus-4-8',
          reason: 'Best for complex tasks',
        };
      }
      if (openaiKey) {
        return {
          provider: getProvider('openai'),
          model: 'gpt-4o',
          reason: 'Good for complex tasks',
        };
      }
      break;

    case 'quick':
      if (anthropicKey) {
        return {
          provider: getProvider('anthropic'),
          model: 'claude-haiku-4-5',
          reason: 'Fast and cheap for quick tasks',
        };
      }
      if (openaiKey) {
        return {
          provider: getProvider('openai'),
          model: 'gpt-4o-mini',
          reason: 'Fast for quick tasks',
        };
      }
      break;
  }

  // Fallback: use whatever is configured
  const allProviders = listProviders();
  for (const provider of allProviders) {
    if (provider.isConfigured()) {
      const models = provider.listModels();
      if (models.length > 0) {
        return {
          provider,
          model: models[0].id,
          reason: 'First available provider',
        };
      }
    }
  }

  // Last resort: Groq with key
  if (groqKey) {
    return {
      provider: getProvider('groq'),
      model: 'llama-3.3-70b-versatile',
      reason: 'Free fallback',
    };
  }

  // Gemini
  if (geminiKey) {
    return {
      provider: getProvider('gemini'),
      model: 'gemini-1.5-flash',
      reason: 'Free fallback',
    };
  }

  // Ollama as absolute last resort
  return {
    provider: getProvider('ollama'),
    model: 'ollama/llama3',
    reason: 'Local Ollama (last resort)',
  };
}

export function getAvailableTaskTypes(): TaskType[] {
  return ['code', 'quick', 'complex', 'general', 'analysis', 'writing'];
}
