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

  if (options.preferredProvider && options.preferredModel) {
    const provider = getProvider(options.preferredProvider);
    return { provider, model: options.preferredModel, reason: 'User specified' };
  }

  if (options.preferredModel) {
    const modelDef = MODELS[options.preferredModel];
    if (modelDef) {
      const provider = getProvider(modelDef.provider);
      if (provider.isConfigured() || modelDef.free || modelDef.local) {
        return { provider, model: options.preferredModel, reason: 'User specified model' };
      }
    }
  }

  const remaining = getRemainingBudget();
  const lowBudget = (remaining.total !== undefined && remaining.total < 1) ||
                    (remaining.monthly !== undefined && remaining.monthly < 1);
  const useFree = free || (remaining.total === 0) || (remaining.monthly === 0);

  if (useFree || lowBudget) {
    return selectFreeProvider(taskType, lowBudget);
  }

  const defaultProvider = options.preferredProvider ?? getDefaultProvider();
  const defaultModel = getDefaultModel();

  if (defaultProvider) {
    try {
      const provider = getProvider(defaultProvider);
      if (provider.isConfigured()) {
        const models = provider.listModels();
        const model = defaultModel ?? (models[0]?.id ?? 'default');
        return { provider, model, reason: 'Default provider from settings' };
      }
    } catch { /* provider not found, continue */ }
  }

  return selectByTaskType(taskType);
}

function selectFreeProvider(taskType: TaskType, lowBudget: boolean): ProviderModelPair {
  const reason = lowBudget ? 'Low budget - using free provider' : 'Free mode';

  if (getApiKey('groq')) {
    const provider = getProvider('groq');
    const model = taskType === 'quick' ? 'llama-3.1-8b-instant' : 'llama-3.3-70b-versatile';
    return { provider, model, reason };
  }

  if (getApiKey('gemini')) {
    const provider = getProvider('gemini');
    return { provider, model: 'gemini-1.5-flash', reason };
  }

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
      if (perplexityKey) return { provider: getProvider('perplexity'), model: 'sonar-pro', reason: 'Perplexity has live web search for research tasks' };
      if (anthropicKey) return { provider: getProvider('anthropic'), model: 'claude-opus-4-8', reason: 'Powerful model for research (no live web)' };
      break;
    case 'reasoning':
      if (deepseekKey) return { provider: getProvider('deepseek'), model: 'deepseek-reasoner', reason: 'DeepSeek R1 specializes in deep reasoning' };
      if (anthropicKey) return { provider: getProvider('anthropic'), model: 'claude-opus-4-8', reason: 'Best available reasoning model' };
      break;
    case 'cheap':
      if (deepseekKey) return { provider: getProvider('deepseek'), model: 'deepseek-chat', reason: 'DeepSeek Chat is the cheapest capable model' };
      if (mistralKey) return { provider: getProvider('mistral'), model: 'mistral-small-latest', reason: 'Mistral Small is affordable' };
      if (groqKey) return { provider: getProvider('groq'), model: 'llama-3.3-70b-versatile', reason: 'Groq is free' };
      break;
    case 'code':
      if (anthropicKey) return { provider: getProvider('anthropic'), model: 'claude-sonnet-4-6', reason: 'Best for code tasks' };
      if (mistralKey) return { provider: getProvider('mistral'), model: 'codestral-latest', reason: 'Codestral is a coding specialist model' };
      if (openaiKey) return { provider: getProvider('openai'), model: 'gpt-4o', reason: 'Good for code tasks' };
      break;
    case 'complex':
    case 'analysis':
      if (anthropicKey) return { provider: getProvider('anthropic'), model: 'claude-opus-4-8', reason: 'Best for complex tasks' };
      if (openaiKey) return { provider: getProvider('openai'), model: 'gpt-4o', reason: 'Good for complex tasks' };
      break;
    case 'writing':
      if (anthropicKey) return { provider: getProvider('anthropic'), model: 'claude-sonnet-4-6', reason: 'Excellent at structured writing' };
      if (openaiKey) return { provider: getProvider('openai'), model: 'gpt-4o', reason: 'Good for writing tasks' };
      break;
    case 'general':
      if (anthropicKey) return { provider: getProvider('anthropic'), model: 'claude-sonnet-4-6', reason: 'Balanced general-purpose model' };
      if (openaiKey) return { provider: getProvider('openai'), model: 'gpt-4o', reason: 'Good all-round model' };
      break;
    case 'quick':
      if (anthropicKey) return { provider: getProvider('anthropic'), model: 'claude-haiku-4-5', reason: 'Fast and cheap for quick tasks' };
      if (openaiKey) return { provider: getProvider('openai'), model: 'gpt-4o-mini', reason: 'Fast for quick tasks' };
      break;
  }

  const allProviders = listProviders();
  for (const provider of allProviders) {
    if (provider.isConfigured()) {
      const models = provider.listModels();
      if (models.length > 0) return { provider, model: models[0].id, reason: 'First available provider' };
    }
  }

  throw new Error(
    'No AI provider configured.\n\n' +
    'Run the setup wizard:   cude setup\n' +
    'Or add a key directly:  cude config set-key groq <key>\n\n' +
    'Free options (no payment needed):\n' +
    '  • Groq     → console.groq.com   (Llama 3.3-70B, fast)\n' +
    '  • Gemini   → aistudio.google.com (Flash free tier)\n' +
    '  • Ollama   → ollama.ai           (local, no key needed)'
  );
}

export function getAvailableTaskTypes(): TaskType[] {
  return ['code', 'quick', 'complex', 'general', 'analysis', 'writing', 'research', 'reasoning', 'cheap'];
}
