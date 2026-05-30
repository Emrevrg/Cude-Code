import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { GroqProvider } from './groq.js';
import { OllamaProvider } from './ollama.js';
import type { Provider } from './types.js';

const providers: Provider[] = [
  new AnthropicProvider(),
  new OpenAIProvider(),
  new GeminiProvider(),
  new GroqProvider(),
  new OllamaProvider(),
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
  return providers.filter(p => p.name === 'groq' || p.name === 'ollama' || p.name === 'gemini');
}

export type { Provider };
export { AnthropicProvider, OpenAIProvider, GeminiProvider, GroqProvider, OllamaProvider };
