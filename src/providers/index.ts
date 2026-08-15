import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { GroqProvider } from './groq.js';
import { OllamaProvider } from './ollama.js';
import { OpenRouterProvider } from './openrouter.js';
import { NvidiaProvider } from './nvidia.js';
import { MistralProvider } from './mistral.js';
import { TogetherProvider } from './together.js';
import { PerplexityProvider } from './perplexity.js';
import { DeepSeekProvider } from './deepseek.js';
import { XAIProvider } from './xai.js';
import { CohereProvider } from './cohere.js';
import { AzureOpenAIProvider } from './azure.js';
import { LiteLLMProvider } from './litellm.js';
import { HuggingFaceProvider } from './huggingface.js';
import { VLLMProvider } from './vllm.js';
import { ReplicateProvider } from './replicate.js';
import { LocalGGUFProvider } from './gguf.js';
import type { Provider, CostClass } from './types.js';
import { getCustomProviders } from '../config/index.js';
import { CustomOpenAIProvider } from './custom.js';

const builtInProviders: Provider[] = [
  new AnthropicProvider(),
  new OpenAIProvider(),
  new GeminiProvider(),
  new GroqProvider(),
  new OllamaProvider(),
  new OpenRouterProvider(),
  new NvidiaProvider(),
  new MistralProvider(),
  new TogetherProvider(),
  new PerplexityProvider(),
  new DeepSeekProvider(),
  new XAIProvider(),
  new CohereProvider(),
  new AzureOpenAIProvider(),
  new LiteLLMProvider(),
  new HuggingFaceProvider(),
  new VLLMProvider(),
  new ReplicateProvider(),
  new LocalGGUFProvider(),
];

function allProviders(): Provider[] {
  return [...builtInProviders, ...getCustomProviders().map(config => new CustomOpenAIProvider(config))];
}

/**
 * The Free/Local label, read from provider and model metadata rather than the
 * hardcoded `name === 'groq' || name === 'ollama'` table the UI used to carry —
 * which reported vLLM as "Paid" while vLLM hardcodes cost = 0.
 */
export function classifyProvider(provider: Provider): CostClass {
  if (provider.costClass) return provider.costClass;

  const models = provider.listModels();
  if (models.length === 0) return 'paid';
  if (models.every(m => m.local)) return 'local';
  if (models.every(m => m.free || m.local)) return 'free';
  if (models.some(m => m.free || m.local)) return 'mixed';
  return 'paid';
}

/** Providers whose model list comes from a running server, not the catalog. */
export function isSelfHosted(provider: Provider): boolean {
  return typeof provider.listRemoteModels === 'function';
}

export function getProvider(name: string): Provider {
  const providers = allProviders();
  const provider = providers.find(p => p.name === name);
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${providers.map(p => p.name).join(', ')}`);
  }
  return provider;
}

export function listProviders(): Provider[] {
  return allProviders();
}

export function getConfiguredProviders(): Provider[] {
  return allProviders().filter(p => p.isConfigured());
}

export function getFreeProviders(): Provider[] {
  return allProviders().filter(
    p => p.name === 'groq' || 
         p.name === 'ollama' || 
         p.name === 'gemini' || 
         p.name === 'openrouter' ||
         p.name === 'litellm' ||
         p.name === 'vllm' ||
         p.name === 'gguf'
  );
}

export type { Provider };
export {
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  GroqProvider,
  OllamaProvider,
  OpenRouterProvider,
  NvidiaProvider,
  MistralProvider,
  TogetherProvider,
  PerplexityProvider,
  DeepSeekProvider,
  XAIProvider,
  CohereProvider,
  AzureOpenAIProvider,
  LiteLLMProvider,
  HuggingFaceProvider,
  VLLMProvider,
  ReplicateProvider,
  LocalGGUFProvider,
};
