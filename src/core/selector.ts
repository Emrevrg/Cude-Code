import { getProvider, listProviders } from '../providers/index.js';
import { getDefaultProvider, getDefaultModel, getApiKey } from '../config/index.js';
import { getRemainingBudget } from '../storage/budget.js';
import { MODELS } from '../config/models.js';
import type { Provider } from '../providers/types.js';

export type TaskType = 'code' | 'quick' | 'complex' | 'general' | 'analysis' | 'writing' | 'research' | 'reasoning' | 'cheap';

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
  const perplexityKey = getApiKey('perplexity');
  const deepseekKey = getApiKey('deepseek');
  const mistralKey = getApiKey('mistral');

  switch (taskType) {
    case 'research':
      // Perplexity has live internet access — best for web research tasks
      if (perplexityKey) {
        return {
          provider: getProvider('perplexity'),
          model: 'llama-3.1-sonar-large-128k-online',
          reason: 'Perplexity has live web search for research tasks',
        };
      }
      // Fallback to large capable model
      if (anthropicKey) {
        return {
          provider: getProvider('anthropic'),
          model: 'claude-opus-4-8',
          reason: 'Powerful model for research (no live web)',
        };
      }
      break;

    case 'reasoning':
      // DeepSeek Reasoner (R1) is specialized for deep reasoning at low cost
      if (deepseekKey) {
        return {
          provider: getProvider('deepseek'),
          model: 'deepseek-reasoner',
          reason: 'DeepSeek R1 specializes in deep reasoning',
        };
      }
      // Claude Opus is a strong fallback for reasoning
      if (anthropicKey) {
        return {
          provider: getProvider('anthropic'),
          model: 'claude-opus-4-8',
          reason: 'Best available reasoning model',
        };
      }
      break;

    case 'cheap':
      // DeepSeek Chat is among the cheapest capable models ($0.14/$0.28 per MTok)
      if (deepseekKey) {
        return {
          provider: getProvider('deepseek'),
          model: 'deepseek-chat',
          reason: 'DeepSeek Chat is the cheapest capable model',
        };
      }
      // Mistral Small is a good cheap alternative
      if (mistralKey) {
        return {
          provider: getProvider('mistral'),
          model: 'mistral-small-latest',
          reason: 'Mistral Small is affordable',
        };
      }
      // Fall through to free providers
      if (groqKey) {
        return {
          provider: getProvider('groq'),
          model: 'llama-3.3-70b-versatile',
          reason: 'Groq is free',
        };
      }
      break;

    case 'code':
      if (anthropicKey) {
        return {
          provider: getProvider('anthropic'),
          model: 'claude-sonnet-4-6',
          reason: 'Best for code tasks',
        };
      }
      // Codestral is Mistral's coding specialist
      if (mistralKey) {
        return {
          provider: getProvider('mistral'),
          model: 'codestral-latest',
          reason: 'Codestral is a coding specialist model',
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

    case 'general':
      // General-purpose: prefer a balanced capable model. Gemini Pro is strong and cheap.
      if (geminiKey) {
        return {
          provider: getProvider('gemini'),
          model: 'gemini-1.5-pro',
          reason: 'Balanced general-purpose model with large context',
        };
      }
      if (anthropicKey) {
        return {
          provider: getProvider('anthropic'),
          model: 'claude-sonnet-4-6',
          reason: 'Versatile general-purpose model',
        };
      }
      if (openaiKey) {
        return {
          provider: getProvider('openai'),
          model: 'gpt-4o',
          reason: 'General-purpose model',
        };
      }
      if (groqKey) {
        return {
          provider: getProvider('groq'),
          model: 'llama-3.3-70b-versatile',
          reason: 'Free general-purpose model',
        };
      }
      break;

    case 'writing':
      // Writing tasks: value nuance and coherence. Prefer models known for prose quality.
      if (anthropicKey) {
        return {
          provider: getProvider('anthropic'),
          model: 'claude-sonnet-4-6',
          reason: 'Strong writing quality',
        };
      }
      if (openaiKey) {
        return {
          provider: getProvider('openai'),
          model: 'gpt-4o',
          reason: 'Good writing quality',
        };
      }
      if (mistralKey) {
        return {
          provider: getProvider('mistral'),
          model: 'mistral-large-latest',
          reason: 'Good writing quality',
        };
      }
      if (geminiKey) {
        return {
          provider: getProvider('gemini'),
          model: 'gemini-1.5-pro',
          reason: 'Free-tier writing model',
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
  return ['code', 'quick', 'complex', 'general', 'analysis', 'writing', 'research', 'reasoning', 'cheap'];
}
