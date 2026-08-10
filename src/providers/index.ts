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
import type { Provider } from './types.js';

const providers: Provider[] = [
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

export function getProvider(name: string): Provider {
  const provider = providers.find(p => p.name === name);
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${providers.map(p => p.name).join(', ')}`);
  }
  return provider;
}

export function listProviders(): Provider[] {
  return providers;
}

export function getConfiguredProviders(): Provider[] {
  return providers.filter(p => p.isConfigured());
}

export function getFreeProviders(): Provider[] {
  return providers.filter(
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
