import Conf from 'conf';
import { homedir } from 'os';
import { join } from 'path';

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

const defaultConfig: AppConfig = {
  apiKeys: {},
  defaultProvider: undefined,
  defaultModel: undefined,
  ollamaBaseUrl: 'http://localhost:11434',
  budgetAlertThreshold: undefined,
  theme: 'default',
  firstRun: true,
};

let configInstance: Conf<AppConfig> | null = null;

export function getConfig(): Conf<AppConfig> {
  if (!configInstance) {
    configInstance = new Conf<AppConfig>({
      projectName: 'codiente-cli',
      defaults: defaultConfig,
      cwd: join(homedir(), '.codiente'),
    });
  }
  return configInstance;
}

export function getApiKey(provider: string): string | undefined {
  const config = getConfig();
  const keys = config.get('apiKeys') as AppConfig['apiKeys'];
  return keys[provider as keyof typeof keys];
}

export function setApiKey(provider: string, key: string): void {
  const config = getConfig();
  const keys = config.get('apiKeys') as AppConfig['apiKeys'];
  (keys as Record<string, string>)[provider] = key;
  config.set('apiKeys', keys);
}

export function removeApiKey(provider: string): void {
  const config = getConfig();
  const keys = config.get('apiKeys') as AppConfig['apiKeys'];
  delete (keys as Record<string, string | undefined>)[provider];
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

export function getOllamaBaseUrl(): string {
  return (getConfig().get('ollamaBaseUrl') as string | undefined) ?? 'http://localhost:11434';
}

export function isFirstRun(): boolean {
  return (getConfig().get('firstRun') as boolean | undefined) ?? true;
}

export function markFirstRunDone(): void {
  getConfig().set('firstRun', false);
}

export function getConfigPath(): string {
  return join(homedir(), '.codiente');
}
