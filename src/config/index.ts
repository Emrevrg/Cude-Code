import Conf from 'conf';
import { homedir } from 'os';
import { join } from 'path';

export interface AppConfig {
  apiKeys: {
    anthropic?: string;
    openai?: string;
    gemini?: string;
    groq?: string;
    openrouter?: string;
    nvidia?: string;
    mistral?: string;
    together?: string;
    perplexity?: string;
    deepseek?: string;
    xai?: string;
    cohere?: string;
    [key: string]: string | undefined;
  };
  defaultProvider?: string;
  defaultModel?: string;
  ollamaBaseUrl?: string;
  budgetAlertThreshold?: number;
  theme?: 'default' | 'minimal';
  firstRun?: boolean;
  language?: string;
}

// Standard env var names for each provider
const ENV_VAR_MAP: Record<string, string> = {
  anthropic:  'ANTHROPIC_API_KEY',
  openai:     'OPENAI_API_KEY',
  gemini:     'GEMINI_API_KEY',
  groq:       'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  nvidia:     'NVIDIA_API_KEY',
  mistral:    'MISTRAL_API_KEY',
  together:   'TOGETHER_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  deepseek:   'DEEPSEEK_API_KEY',
  xai:        'XAI_API_KEY',
  cohere:     'COHERE_API_KEY',
  brave:      'BRAVE_API_KEY',   // web search tool
  azure:      'AZURE_OPENAI_API_KEY',
  bedrock:    'AWS_ACCESS_KEY_ID',
  litellm:    'LITELLM_API_KEY',
  replicate:  'REPLICATE_API_TOKEN',
  huggingface:'HF_API_KEY',
  glm:        'GLM_API_KEY',
  lmstudio:   'LMSTUDIO_API_KEY',
  vllm:       'VLLM_API_KEY',
  sglang:     'SGLANG_API_KEY',
  'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY',
};

const defaultConfig: AppConfig = {
  apiKeys: {},
  defaultProvider: undefined,
  defaultModel: undefined,
  ollamaBaseUrl: 'http://localhost:11434',
  budgetAlertThreshold: undefined,
  theme: 'default',
  firstRun: true,
  language: 'auto',
};

let configInstance: Conf<AppConfig> | null = null;

export function getConfig(): Conf<AppConfig> {
  if (!configInstance) {
    configInstance = new Conf<AppConfig>({
      projectName: 'cude-code',
      defaults: defaultConfig,
      cwd: join(homedir(), '.cude'),
    });
  }
  return configInstance;
}

export function getApiKey(provider: string): string | undefined {
  // Check env var first — supports CI/CD and developer workflows
  const envVar = ENV_VAR_MAP[provider];
  if (envVar) {
    const envVal = process.env[envVar];
    if (envVal && envVal.trim()) return envVal.trim();
  }
  const config = getConfig();
  const keys = config.get('apiKeys') as Record<string, string | undefined>;
  return keys[provider];
}

export function setApiKey(provider: string, key: string): void {
  const config = getConfig();
  const keys = { ...(config.get('apiKeys') as Record<string, string | undefined>) };
  keys[provider] = key.trim();
  config.set('apiKeys', keys);
}

export function removeApiKey(provider: string): void {
  const config = getConfig();
  const keys = { ...(config.get('apiKeys') as Record<string, string | undefined>) };
  delete keys[provider];
  config.set('apiKeys', keys);
}

export function getDefaultProvider(): string | undefined {
  return getConfig().get('defaultProvider') as string | undefined;
}

export function setDefaultProvider(provider: string): void {
  getConfig().set('defaultProvider', provider);
}

export function getDefaultModel(): string | undefined {
  return getConfig().get('defaultModel') as string | undefined;
}

export function setDefaultModel(model: string): void {
  getConfig().set('defaultModel', model);
}

export function getLanguage(): string {
  return (getConfig().get('language') as string | undefined) ?? 'auto';
}

export function setLanguage(lang: string): void {
  getConfig().set('language', lang);
}

export function getOllamaBaseUrl(): string {
  // Support standard OLLAMA_HOST env var
  const envHost = process.env['OLLAMA_HOST'];
  if (envHost) return envHost.startsWith('http') ? envHost : `http://${envHost}`;
  return (getConfig().get('ollamaBaseUrl') as string | undefined) ?? 'http://localhost:11434';
}

export function isFirstRun(): boolean {
  return (getConfig().get('firstRun') as boolean | undefined) ?? true;
}

export function markFirstRunDone(): void {
  getConfig().set('firstRun', false);
}

export function getConfigPath(): string {
  return join(homedir(), '.cude');
}

export const KNOWN_PROVIDERS = Object.keys(ENV_VAR_MAP);
