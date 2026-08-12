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

// `<provider>-endpoint` keys configure the base URL for self-hosted /
// deployment providers (vllm-endpoint, litellm-endpoint, gguf-endpoint,
// azure-endpoint). They are stored through the same key-store as API keys
// (getApiKey('vllm-endpoint') etc.), so they must validate against the provider
// list rather than being rejected as "Unknown provider". See F4.
const VALID_PROVIDERS = PROVIDERS;
const ENDPOINT_SUFFIX = '-endpoint';

function resolveKeyNameInfo(provider: string): { valid: boolean; isEndpoint: boolean; baseProvider: string } {
  if (VALID_PROVIDERS.includes(provider)) {
    return { valid: true, isEndpoint: false, baseProvider: provider };
  }
  if (provider.endsWith(ENDPOINT_SUFFIX)) {
    const base = provider.slice(0, -ENDPOINT_SUFFIX.length);
    if (VALID_PROVIDERS.includes(base)) {
      return { valid: true, isEndpoint: true, baseProvider: base };
    }
  }
  return { valid: false, isEndpoint: false, baseProvider: provider };
}

export async function runConfigSetKey(provider: string, key?: string): Promise<void> {
  const info = resolveKeyNameInfo(provider);
  if (!info.valid) {
    showError(`Unknown provider: ${provider}\nValid providers: ${PROVIDERS.join(', ')}`);
    process.exit(1);
  }

  let apiKey = key;
  if (!apiKey) {
    const labelPart = info.isEndpoint ? `${info.baseProvider} endpoint URL` : `${KEY_NAMES[info.baseProvider] ?? info.baseProvider} API key`;
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'key',
        message: `Enter ${labelPart}:`,
        validate: (input: string) => input.trim().length > 0 || 'Value cannot be empty',
      },
    ]);
    apiKey = (answer as { key: string }).key;
  }

  setApiKey(provider, apiKey!.trim());
  if (info.isEndpoint) {
    showSuccess(`Endpoint for ${KEY_NAMES[info.baseProvider] ?? info.baseProvider} saved successfully`);
  } else {
    showSuccess(`API key for ${KEY_NAMES[info.baseProvider] ?? info.baseProvider} saved successfully`);
  }
}

export async function runConfigRemoveKey(provider: string): Promise<void> {
  const info = resolveKeyNameInfo(provider);
  if (!info.valid) {
    showError(`Unknown provider: ${provider}`);
    process.exit(1);
  }

  const label = info.isEndpoint
    ? `${KEY_NAMES[info.baseProvider] ?? info.baseProvider} endpoint`
    : `${KEY_NAMES[info.baseProvider] ?? info.baseProvider} API key`;
  const existing = getApiKey(provider);
  if (!existing) {
    showInfo(`No ${label} configured`);
    return;
  }

  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Remove ${label}?`,
      default: false,
    },
  ]);

  if ((answer as { confirm: boolean }).confirm) {
    removeApiKey(provider);
    showSuccess(`${label} removed`);
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

  // Providers that read a `<provider>-endpoint` base URL alongside a key.
  // These are stored in the same key store; surface them so users can see what
  // they configured rather than only guessing via `cude providers list`.
  const ENDPOINT_PROVIDERS = ['azure', 'vllm', 'litellm', 'gguf'];
  console.log();
  console.log(chalk.bold.cyan('  Endpoints:'));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  let anyEndpoint = false;
  for (const provider of ENDPOINT_PROVIDERS) {
    const endpoint = getApiKey(`${provider}-endpoint`);
    if (endpoint) {
      anyEndpoint = true;
      const name = (KEY_NAMES[provider] ?? provider).padEnd(20);
      console.log(`  ${chalk.white(name)} ${chalk.green('✓')} ${chalk.cyan(endpoint)}`);
    }
  }
  if (!anyEndpoint) {
    console.log(chalk.dim('  No endpoint URLs configured.'));
    console.log(chalk.dim('  Set with: cude config set-key <provider>-endpoint <url>'));
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

    default:
      showError(`Unknown setting: ${setting}\nValid settings: default-provider, default-model`);
      process.exit(1);
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
