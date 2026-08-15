import Conf from 'conf';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { existsSync, renameSync, copyFileSync, readdirSync } from 'fs';

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
  /** Root that mutating file tools are confined to. Defaults to process.cwd(). */
  workspaceRoot?: string;
  budgetAlertThreshold?: number;
  theme?: 'default' | 'minimal';
  firstRun?: boolean;
  customProviders?: Record<string, {
    displayName: string;
    baseUrl: string;
    model: string;
    apiKeyEnv?: string;
    apiKey?: string;
    local?: boolean;
  }>;
}

const defaultConfig: AppConfig = {
  apiKeys: {},
  defaultProvider: undefined,
  defaultModel: undefined,
  ollamaBaseUrl: 'http://localhost:11434',
  budgetAlertThreshold: undefined,
  theme: 'default',
  firstRun: true,
  customProviders: {},
};

/**
 * Everything Cude persists lives here. `CUDE_HOME` redirects it, which is what
 * lets the test suite exercise config- and budget-backed behaviour without
 * writing to (or destroying) the real ~/.cude.
 */
export function getDataDir(): string {
  const override = process.env.CUDE_HOME;
  if (override && override.trim()) return resolve(override.trim());
  return join(homedir(), '.cude');
}

const LEGACY_DATA_DIR = join(homedir(), '.codiente');

// One-time migration from the legacy ~/.codiente directory to ~/.cude.
// Idempotent: if the legacy dir no longer exists, this is a no-op.
function migrateLegacyDataDir(): void {
  if (!existsSync(LEGACY_DATA_DIR)) return;
  const DATA_DIR = getDataDir();
  if (!existsSync(DATA_DIR)) {
    // Whole-sale rename is the simplest path when the new dir doesn't exist yet.
    try {
      renameSync(LEGACY_DATA_DIR, DATA_DIR);
      return;
    } catch {
      // Fall through to per-file copy if rename failed (e.g. cross-device on some systems).
    }
  }
  // Copy any individual files that don't already exist in the new location.
  try {
    const entries = readdirSync(LEGACY_DATA_DIR);
    for (const entry of entries) {
      const src = join(LEGACY_DATA_DIR, entry);
      const dest = join(DATA_DIR, entry);
      if (!existsSync(dest)) {
        try {
          copyFileSync(src, dest);
        } catch {
          // Best-effort: skip files that can't be copied.
        }
      }
    }
  } catch {
    // Best-effort migration; never block startup.
  }
}

let configInstance: Conf<AppConfig> | null = null;

export function getConfig(): Conf<AppConfig> {
  if (!configInstance) {
    migrateLegacyDataDir();
    configInstance = new Conf<AppConfig>({
      projectName: 'cude-code',
      defaults: defaultConfig,
      cwd: getDataDir(),
    });
  }
  return configInstance;
}

export function getApiKey(provider: string): string | undefined {
  // Environment fallback: CUDE_<PROVIDER>_KEY takes precedence, then provider-conventional names.
  const envCandidates = [
    `CUDE_${provider.toUpperCase()}_KEY`,
    `CUDE_${provider.toUpperCase()}_API_KEY`,
  ];
  for (const name of envCandidates) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  // Common provider-conventional env names as a last-resort fallback.
  const conventionalNames: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    google: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    together: 'TOGETHER_API_KEY',
    perplexity: 'PERPLEXITY_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    xai: 'XAI_API_KEY',
    cohere: 'COHERE_API_KEY',
    nvidia: 'NVIDIA_API_KEY',
    azure: 'AZURE_OPENAI_API_KEY',
    huggingface: 'HUGGINGFACE_API_KEY',
    replicate: 'REPLICATE_API_TOKEN',
  };
  const conventional = conventionalNames[provider];
  if (conventional) {
    const value = process.env[conventional];
    if (value && value.trim()) return value.trim();
  }
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

export function getWorkspaceRootSetting(): string | undefined {
  try {
    return getConfig().get('workspaceRoot') as string | undefined;
  } catch {
    // Never let an unreadable config block a tool call.
    return undefined;
  }
}

export function setWorkspaceRootSetting(root: string): void {
  getConfig().set('workspaceRoot', root);
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
  return getDataDir();
}

export interface CustomProviderConfig {
  name: string;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  apiKey?: string;
  local?: boolean;
}

export function getCustomProviders(): CustomProviderConfig[] {
  const entries = (getConfig().get('customProviders') ?? {}) as AppConfig['customProviders'];
  return Object.entries(entries ?? {}).map(([name, value]) => ({ name, ...value }));
}

export function saveCustomProvider(config: CustomProviderConfig): void {
  const providers = (getConfig().get('customProviders') ?? {}) as NonNullable<AppConfig['customProviders']>;
  const { name, ...value } = config;
  providers[name] = value;
  getConfig().set('customProviders', providers);
}

export function removeCustomProvider(name: string): boolean {
  const providers = (getConfig().get('customProviders') ?? {}) as NonNullable<AppConfig['customProviders']>;
  if (!providers[name]) return false;
  delete providers[name];
  getConfig().set('customProviders', providers);
  return true;
}
