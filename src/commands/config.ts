import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  getApiKey,
  setApiKey,
  removeApiKey,
  setDefaultProvider,
  setDefaultModel,
  getDefaultProvider,
  getDefaultModel,
  getConfig,
} from '../config/index.js';
import { showSuccess, showError, printKeyValue, showInfo } from '../ui/display.js';

const PROVIDERS = [
  'anthropic', 'openai', 'gemini', 'groq', 'ollama',
  'openrouter', 'nvidia', 'mistral', 'together', 'perplexity', 'deepseek', 'xai', 'cohere',
  'azure', 'litellm', 'huggingface', 'vllm', 'replicate', 'gguf',
];
const KEY_NAMES: Record<string, string> = {
  anthropic:   'Anthropic Claude',
  openai:      'OpenAI GPT',
  gemini:      'Google Gemini',
  groq:        'Groq (Free)',
  ollama:      'Ollama (Local/Free)',
  openrouter:  'OpenRouter',
  nvidia:      'NVIDIA NIM',
  mistral:     'Mistral AI',
  together:    'Together AI',
  perplexity:  'Perplexity AI',
  deepseek:    'DeepSeek',
  xai:         'xAI Grok',
  cohere:      'Cohere',
  azure:       'Azure OpenAI',
  litellm:     'LiteLLM Proxy',
  huggingface: 'HuggingFace Inference API',
  vllm:        'vLLM (Self-hosted)',
  replicate:   'Replicate',
  gguf:        'Local GGUF (llama.cpp)',
};

/**
 * Providers that read a `<name>-endpoint` setting. These were unreachable:
 * `config set-key` validated the whole key name against PROVIDERS, so
 * `azure-endpoint` came back as "Unknown provider" — and since Azure's
 * isConfigured() requires it, Azure could never become configured at all.
 */
export const ENDPOINT_SUFFIX = '-endpoint';
export const ENDPOINT_PROVIDERS = ['azure', 'litellm', 'vllm', 'gguf'];

/** Shown in `config list` when no endpoint is set, so the default is visible. */
const DEFAULT_ENDPOINT_HINTS: Record<string, string> = {
  azure: 'Required — Azure cannot be used without it',
  litellm: 'Defaults to http://localhost:8000',
  vllm: 'Defaults to http://localhost:8000',
  gguf: 'Defaults to http://localhost:8080',
};

export interface ParsedConfigKey {
  kind: 'api-key' | 'endpoint';
  provider: string;
}

/**
 * Resolves a `config set-key` name. Returns null for names that are genuinely
 * unknown, so those keep reporting an error.
 */
export function parseConfigKeyName(name: string): ParsedConfigKey | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(ENDPOINT_SUFFIX)) {
    const provider = lower.slice(0, -ENDPOINT_SUFFIX.length);
    return ENDPOINT_PROVIDERS.includes(provider) ? { kind: 'endpoint', provider } : null;
  }
  return PROVIDERS.includes(lower) ? { kind: 'api-key', provider: lower } : null;
}

function describeUnknownKey(name: string): string {
  if (name.toLowerCase().endsWith(ENDPOINT_SUFFIX)) {
    return (
      `Unknown endpoint setting: ${name}\n` +
      `Providers that take an endpoint: ${ENDPOINT_PROVIDERS.map(p => p + ENDPOINT_SUFFIX).join(', ')}`
    );
  }
  return (
    `Unknown provider: ${name}\n` +
    `Valid providers: ${PROVIDERS.join(', ')}\n` +
    `Endpoints: ${ENDPOINT_PROVIDERS.map(p => p + ENDPOINT_SUFFIX).join(', ')}`
  );
}

function isValidEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function runConfigSetKey(provider: string, key?: string): Promise<void> {
  const parsed = parseConfigKeyName(provider);
  if (!parsed) {
    showError(describeUnknownKey(provider));
    process.exit(1);
  }

  if (parsed.kind === 'endpoint') {
    await runConfigSetEndpoint(parsed.provider, key);
    return;
  }

  let apiKey = key;
  if (!apiKey) {
    const answer = await inquirer.prompt([
      {
        type: 'password',
        name: 'key',
        message: `Enter ${KEY_NAMES[parsed.provider] ?? parsed.provider} API key:`,
        validate: (input: string) => input.trim().length > 0 || 'API key cannot be empty',
      },
    ]);
    apiKey = (answer as { key: string }).key;
  }

  setApiKey(parsed.provider, apiKey!.trim());
  showSuccess(`API key for ${KEY_NAMES[parsed.provider] ?? parsed.provider} saved successfully`);
}

export async function runConfigSetEndpoint(provider: string, url?: string): Promise<void> {
  const name = provider.toLowerCase().endsWith(ENDPOINT_SUFFIX)
    ? provider.toLowerCase().slice(0, -ENDPOINT_SUFFIX.length)
    : provider.toLowerCase();

  if (!ENDPOINT_PROVIDERS.includes(name)) {
    showError(
      `${provider} does not take an endpoint.\n` +
      `Providers that do: ${ENDPOINT_PROVIDERS.join(', ')}`
    );
    process.exit(1);
  }

  let endpoint = url;
  if (!endpoint) {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'endpoint',
        message: `Enter the ${KEY_NAMES[name] ?? name} endpoint URL:`,
        validate: (input: string) => isValidEndpoint(input.trim()) || 'Enter a valid http(s) URL',
      },
    ]);
    endpoint = (answer as { endpoint: string }).endpoint;
  }

  endpoint = endpoint.trim().replace(/\/+$/, '');
  if (!isValidEndpoint(endpoint)) {
    showError(`Not a valid endpoint URL: ${endpoint}\nExample: https://example.openai.azure.com`);
    process.exit(1);
  }

  setApiKey(`${name}${ENDPOINT_SUFFIX}`, endpoint);
  showSuccess(`Endpoint for ${KEY_NAMES[name] ?? name} set to ${endpoint}`);
}

export async function runConfigRemoveKey(provider: string): Promise<void> {
  const parsed = parseConfigKeyName(provider);
  if (!parsed) {
    showError(describeUnknownKey(provider));
    process.exit(1);
  }

  const storedName = parsed.kind === 'endpoint' ? `${parsed.provider}${ENDPOINT_SUFFIX}` : parsed.provider;
  const label = KEY_NAMES[parsed.provider] ?? parsed.provider;
  const what = parsed.kind === 'endpoint' ? 'endpoint' : 'API key';

  const existing = getApiKey(storedName);
  if (!existing) {
    showInfo(`No ${what} configured for ${label}`);
    return;
  }

  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Remove ${what} for ${label}?`,
      default: false,
    },
  ]);

  if ((answer as { confirm: boolean }).confirm) {
    removeApiKey(storedName);
    showSuccess(`${what[0].toUpperCase()}${what.slice(1)} for ${label} removed`);
  } else {
    showInfo('Cancelled');
  }
}

export function runConfigListKeys(): void {
  console.log();
  console.log(chalk.bold.cyan('  Configured API Keys:'));
  console.log(chalk.dim('  ─────────────────────────────────────'));

  for (const provider of PROVIDERS) {
    const key = getApiKey(provider);
    const name = (KEY_NAMES[provider] ?? provider).padEnd(20);
    if (key) {
      const masked = key.substring(0, 8) + '••••••••' + key.substring(key.length - 4);
      console.log(`  ${chalk.white(name)} ${chalk.green('✓')} ${chalk.dim(masked)}`);
    } else {
      console.log(`  ${chalk.dim(name)} ${chalk.dim('○')} ${chalk.dim('Not configured')}`);
    }
  }

  console.log();
  console.log(chalk.bold.cyan('  Endpoints:'));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  for (const provider of ENDPOINT_PROVIDERS) {
    const endpoint = getApiKey(`${provider}${ENDPOINT_SUFFIX}`);
    const name = (KEY_NAMES[provider] ?? provider).padEnd(20);
    if (endpoint) {
      // A URL is not a secret, so show it — a wrong endpoint is otherwise
      // invisible and looks like an unreachable server.
      console.log(`  ${chalk.white(name)} ${chalk.green('✓')} ${chalk.dim(endpoint)}`);
    } else {
      console.log(`  ${chalk.dim(name)} ${chalk.dim('○')} ${chalk.dim(DEFAULT_ENDPOINT_HINTS[provider] ?? 'Not set')}`);
    }
  }

  const defaultProvider = getDefaultProvider();
  const defaultModel = getDefaultModel();

  console.log();
  console.log(chalk.bold.cyan('  Default Settings:'));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  printKeyValue('Default Provider', defaultProvider ?? 'auto', defaultProvider ? 'cyan' : 'white');
  printKeyValue('Default Model', defaultModel ?? 'auto', defaultModel ? 'cyan' : 'white');

  const configPath = getConfig().path;
  console.log();
  console.log(chalk.dim(`  Config stored at: ${configPath}`));
  console.log();
}

export async function runConfigSet(setting: string, value: string): Promise<void> {
  switch (setting.toLowerCase()) {
    case 'default-provider':
      if (!PROVIDERS.includes(value)) {
        showError(`Invalid provider: ${value}\nValid: ${PROVIDERS.join(', ')}`);
        process.exit(1);
      }
      setDefaultProvider(value);
      showSuccess(`Default provider set to: ${value}`);
      break;

    case 'default-model': {
      const { MODELS } = await import('../config/models.js');
      if (!MODELS[value]) {
        showError(`Unknown model: ${value}\nValid models: ${Object.keys(MODELS).join(', ')}`);
        process.exit(1);
      }
      setDefaultModel(value);
      showSuccess(`Default model set to: ${value}`);
      break;
    }

    case 'workspace-root': {
      const { setWorkspaceRootSetting } = await import('../config/index.js');
      const { resolve } = await import('path');
      const { existsSync } = await import('fs');
      const root = resolve(value);
      if (!existsSync(root)) {
        showError(`Directory does not exist: ${root}`);
        process.exit(1);
      }
      setWorkspaceRootSetting(root);
      showSuccess(`Workspace root set to: ${root}`);
      break;
    }

    default: {
      // `cude config set <provider>-endpoint <url>` — the wording Azure's own
      // error message tells people to use.
      const parsed = parseConfigKeyName(setting);
      if (parsed?.kind === 'endpoint') {
        await runConfigSetEndpoint(parsed.provider, value);
        break;
      }
      showError(
        `Unknown setting: ${setting}\n` +
        `Valid settings: default-provider, default-model, workspace-root, ` +
        ENDPOINT_PROVIDERS.map(p => p + ENDPOINT_SUFFIX).join(', ')
      );
      process.exit(1);
    }
  }
}

export async function runConfigWizard(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan('  Welcome to Cude Code Setup Wizard!'));
  console.log(chalk.dim('  Let\'s configure your AI providers.'));
  console.log();
  console.log(chalk.bold('  🆓 Free options (no payment needed):'));
  console.log(chalk.dim('  • Groq       → console.groq.com (Llama 3.3-70B, fast)'));
  console.log(chalk.dim('  • Gemini     → aistudio.google.com (Flash free tier)'));
  console.log(chalk.dim('  • OpenRouter → openrouter.ai (many free :free models)'));
  console.log(chalk.dim('  • DeepSeek   → platform.deepseek.com (very cheap)'));
  console.log(chalk.dim('  • Ollama     → ollama.ai (fully local, no key needed)'));
  console.log();
  console.log(chalk.bold('  💳 Paid options:'));
  console.log(chalk.dim('  • Anthropic  → console.anthropic.com (Claude)'));
  console.log(chalk.dim('  • OpenAI     → platform.openai.com (GPT-4o)'));
  console.log(chalk.dim('  • Mistral    → console.mistral.ai (Codestral for coding)'));
  console.log(chalk.dim('  • NVIDIA     → integrate.api.nvidia.com (NIM models)'));
  console.log(chalk.dim('  • Together   → api.together.xyz'));
  console.log(chalk.dim('  • Perplexity → www.perplexity.ai (web search AI)'));
  console.log(chalk.dim('  • xAI        → console.x.ai (Grok)'));
  console.log(chalk.dim('  • Cohere     → dashboard.cohere.com (Command-R+)'));
  console.log();
  console.log(chalk.bold('  🖥️ Self-hosted / advanced:'));
  console.log(chalk.dim('  • Azure OpenAI → your Azure deployment'));
  console.log(chalk.dim('  • LiteLLM      → local proxy gateway'));
  console.log(chalk.dim('  • HuggingFace  → huggingface.co (inference API)'));
  console.log(chalk.dim('  • vLLM         → self-hosted inference server'));
  console.log(chalk.dim('  • Replicate    → replicate.com'));
  console.log(chalk.dim('  • Local GGUF   → llama.cpp server (no key needed)'));
  console.log();

  // Ask which providers to configure
  const providerChoices = [
    { name: 'Groq           (free, fast — Llama 3.3-70B)', value: 'groq', checked: true },
    { name: 'Google Gemini  (free flash tier available)',   value: 'gemini' },
    { name: 'OpenRouter     (200+ models, some free)',      value: 'openrouter' },
    { name: 'DeepSeek       (very cheap — $0.14/MTok)',     value: 'deepseek' },
    { name: 'Anthropic      (Claude Opus/Sonnet/Haiku)',    value: 'anthropic' },
    { name: 'OpenAI         (GPT-4o)',                      value: 'openai' },
    { name: 'Mistral AI     (Codestral for coding)',        value: 'mistral' },
    { name: 'NVIDIA NIM     (Nemotron, Mixtral)',           value: 'nvidia' },
    { name: 'Together AI    (open-source models)',          value: 'together' },
    { name: 'Perplexity     (internet-connected AI)',       value: 'perplexity' },
    { name: 'xAI Grok       (Grok-2)',                      value: 'xai' },
    { name: 'Cohere         (Command-R+)',                  value: 'cohere' },
    { name: 'Azure OpenAI   (your deployment)',             value: 'azure' },
    { name: 'LiteLLM Proxy   (local gateway)',              value: 'litellm' },
    { name: 'HuggingFace     (inference API)',               value: 'huggingface' },
    { name: 'vLLM           (self-hosted)',                 value: 'vllm' },
    { name: 'Replicate       (hosted models)',              value: 'replicate' },
  ];

  const { selectedProviders } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedProviders',
      message: 'Which providers do you want to configure?',
      choices: providerChoices,
    },
  ]) as { selectedProviders: string[] };

  let configured = 0;

  for (const provider of selectedProviders) {
    if (provider === 'ollama') continue; // no key needed
    const { key } = await inquirer.prompt([
      {
        type: 'password',
        name: 'key',
        message: `Enter ${KEY_NAMES[provider] ?? provider} API key (leave empty to skip):`,
      },
    ]) as { key: string };

    if (key.trim()) {
      setApiKey(provider, key.trim());
      configured++;
    }
  }

  if (configured > 0) {
    showSuccess(`${configured} provider${configured !== 1 ? 's' : ''} configured successfully!`);
    console.log(chalk.dim('\n  Run "cude chat" to start chatting.'));
    console.log(chalk.dim('  Run "cude providers list" to see all provider status.\n'));
  } else {
    console.log(chalk.dim('\n  No providers configured. Add them anytime:'));
    console.log(chalk.cyan('  cude config set-key <provider> <key>'));
    console.log(chalk.dim('\n  For free chat right now:'));
    console.log(chalk.cyan('  cude chat --free'));
    console.log();
  }
}
