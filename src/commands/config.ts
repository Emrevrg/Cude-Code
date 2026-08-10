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
  getLanguage,
  setLanguage,
  getConfig,
} from '../config/index.js';
import { showSuccess, showError, printKeyValue, showInfo } from '../ui/display.js';

const PROVIDERS = [
  'anthropic', 'openai', 'gemini', 'groq', 'ollama',
  'openrouter', 'nvidia', 'mistral', 'together', 'perplexity', 'deepseek', 'xai', 'cohere',
];

// Non-AI tool integration keys (validated separately, no provider test)
const TOOL_KEYS = ['brave'];

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
  brave:       'Brave Search API',
};

// Human-readable key format hints
const KEY_HINTS: Record<string, string> = {
  anthropic:   'sk-ant-...',
  openai:      'sk-...',
  gemini:      'AIza...',
  groq:        'gsk_...',
  openrouter:  'sk-or-...',
  nvidia:      'nvapi-...',
  mistral:     'starts with letters/numbers',
  together:    'starts with letters/numbers',
  perplexity:  'pplx-...',
  deepseek:    'sk-...',
  xai:         'xai-...',
  cohere:      'starts with letters/numbers',
  brave:       'BSA...',
};

const KEY_URLS: Record<string, string> = {
  anthropic:   'console.anthropic.com → API Keys',
  openai:      'platform.openai.com → API keys',
  gemini:      'aistudio.google.com → Get API key',
  groq:        'console.groq.com → API Keys',
  openrouter:  'openrouter.ai/keys',
  nvidia:      'integrate.api.nvidia.com → API Key',
  mistral:     'console.mistral.ai → API Keys',
  together:    'api.together.xyz → Settings → API Keys',
  perplexity:  'www.perplexity.ai → Settings → API',
  deepseek:    'platform.deepseek.com → API Keys',
  xai:         'console.x.ai → API Keys',
  cohere:      'dashboard.cohere.com → API Keys',
  brave:       'search.brave.com/search/api → Plans (free tier available)',
};

const SUPPORTED_LANGUAGES: Record<string, string> = {
  auto: 'Auto (match user language)',
  tr:   'Türkçe',
  en:   'English',
  de:   'Deutsch',
  fr:   'Français',
  es:   'Español',
  it:   'Italiano',
  pt:   'Português',
  nl:   'Nederlands',
  pl:   'Polski',
  ru:   'Русский',
  ar:   'العربية',
  zh:   '中文',
  ja:   '日本語',
  ko:   '한국어',
  sv:   'Svenska',
};

async function testProviderKey(providerName: string, key: string): Promise<boolean> {
  const existingKey = getApiKey(providerName); // save before overwriting
  try {
    setApiKey(providerName, key);
    const { getProvider } = await import('../providers/index.js');
    const provider = getProvider(providerName);
    const ok = await provider.isAvailable();
    if (!ok) {
      // Restore original key (don't delete it — user may have had a working key)
      if (existingKey) setApiKey(providerName, existingKey);
      else removeApiKey(providerName);
    }
    return ok;
  } catch {
    if (existingKey) setApiKey(providerName, existingKey);
    else removeApiKey(providerName);
    return false;
  }
}

export async function runConfigSetKey(provider: string, key?: string): Promise<void> {
  const ALL_KEYS = [...PROVIDERS, ...TOOL_KEYS];
  if (!ALL_KEYS.includes(provider)) {
    showError(`Unknown key name: ${provider}\nAI providers: ${PROVIDERS.join(', ')}\nTool integrations: ${TOOL_KEYS.join(', ')}`);
    process.exit(1);
  }

  // Ollama doesn't use API keys — it runs locally
  if (provider === 'ollama') {
    showInfo('Ollama runs locally and does not require an API key.\nJust start Ollama with:  ollama serve');
    return;
  }

  // Tool integration keys — save directly, no provider test
  if (TOOL_KEYS.includes(provider)) {
    const name = KEY_NAMES[provider] ?? provider;
    const hint = KEY_HINTS[provider] ? chalk.dim(` (format: ${KEY_HINTS[provider]})`) : '';
    const url  = KEY_URLS[provider]  ? chalk.dim(`\n  Get key: ${KEY_URLS[provider]}`) : '';
    if (url) console.log(url);

    let apiKey = key;
    if (!apiKey) {
      const answer = await inquirer.prompt([
        {
          type: 'password',
          name: 'key',
          message: `Enter ${name} key${hint}:`,
          validate: (input: string) => input.trim().length > 0 || 'Key cannot be empty',
        },
      ]);
      apiKey = (answer as { key: string }).key;
    }

    setApiKey(provider, apiKey!.trim());
    showSuccess(`${name} key saved. Web search will now use Brave Search.`);
    return;
  }

  let apiKey = key;
  if (!apiKey) {
    const hint = KEY_HINTS[provider] ? chalk.dim(` (format: ${KEY_HINTS[provider]})`) : '';
    const url  = KEY_URLS[provider]  ? chalk.dim(`\n  Get key: ${KEY_URLS[provider]}`) : '';
    if (url) console.log(url);

    const answer = await inquirer.prompt([
      {
        type: 'password',
        name: 'key',
        message: `Enter ${KEY_NAMES[provider] ?? provider} API key${hint}:`,
        validate: (input: string) => input.trim().length > 0 || 'API key cannot be empty',
      },
    ]);
    apiKey = (answer as { key: string }).key;
  }

  setApiKey(provider, apiKey!.trim());
  showSuccess(`API key for ${KEY_NAMES[provider] ?? provider} saved.`);
}

export async function runConfigRemoveKey(provider: string): Promise<void> {
  if (![...PROVIDERS, ...TOOL_KEYS].includes(provider)) {
    showError(`Unknown key name: ${provider}`);
    process.exit(1);
  }

  const existing = getApiKey(provider);
  if (!existing) {
    showInfo(`No API key configured for ${KEY_NAMES[provider] ?? provider}`);
    return;
  }

  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Remove API key for ${KEY_NAMES[provider] ?? provider}?`,
      default: false,
    },
  ]);

  if ((answer as { confirm: boolean }).confirm) {
    removeApiKey(provider);
    showSuccess(`API key for ${KEY_NAMES[provider] ?? provider} removed`);
  } else {
    showInfo('Cancelled');
  }
}

export function runConfigListKeys(): void {
  console.log();
  console.log(chalk.bold.cyan('  AI Provider Keys:'));
  console.log(chalk.dim('  ─────────────────────────────────────'));

  for (const provider of PROVIDERS) {
    if (provider === 'ollama') continue;
    const key  = getApiKey(provider);
    const name = (KEY_NAMES[provider] ?? provider).padEnd(22);
    if (key) {
      const masked = key.substring(0, 6) + '••••••••' + key.substring(key.length - 4);
      console.log(`  ${chalk.white(name)} ${chalk.green('✓')} ${chalk.dim(masked)}`);
    } else {
      console.log(`  ${chalk.dim(name)} ${chalk.dim('○')} ${chalk.dim('Not configured')}`);
    }
  }

  console.log();
  console.log(chalk.bold.cyan('  Tool Integrations:'));
  console.log(chalk.dim('  ─────────────────────────────────────'));

  for (const tool of TOOL_KEYS) {
    const key  = getApiKey(tool);
    const name = (KEY_NAMES[tool] ?? tool).padEnd(22);
    if (key) {
      const masked = key.substring(0, 6) + '••••••••' + key.substring(key.length - 4);
      console.log(`  ${chalk.white(name)} ${chalk.green('✓')} ${chalk.dim(masked)}`);
    } else {
      console.log(`  ${chalk.dim(name)} ${chalk.dim('○')} ${chalk.dim('Not configured')} ${chalk.dim('(Jina.ai fallback active)')}`);
    }
  }

  const defaultProvider = getDefaultProvider();
  const defaultModel    = getDefaultModel();
  const language        = getLanguage();

  console.log();
  console.log(chalk.bold.cyan('  Settings:'));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  printKeyValue('Default Provider', defaultProvider ?? 'auto', defaultProvider ? 'cyan' : 'white');
  printKeyValue('Default Model',    defaultModel    ?? 'auto', defaultModel    ? 'cyan' : 'white');
  printKeyValue('Language',         `${language} (${SUPPORTED_LANGUAGES[language] ?? language})`);

  const configPath = getConfig().path;
  console.log();
  console.log(chalk.dim(`  Config file: ${configPath}`));
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
        showError(`Unknown model: ${value}\nRun "cude providers models" to see all models.`);
        process.exit(1);
      }
      setDefaultModel(value);
      showSuccess(`Default model set to: ${value}`);
      break;
    }

    case 'language': {
      const lang = value.toLowerCase();
      if (!SUPPORTED_LANGUAGES[lang]) {
        const list = Object.entries(SUPPORTED_LANGUAGES)
          .map(([code, name]) => `  ${code.padEnd(6)} ${name}`)
          .join('\n');
        showError(`Unknown language: ${value}\n\nSupported languages:\n${list}`);
        process.exit(1);
      }
      setLanguage(lang);
      showSuccess(`Language set to: ${lang} (${SUPPORTED_LANGUAGES[lang]})`);
      console.log(chalk.dim('  Chat responses will now be in this language.'));
      break;
    }

    default:
      showError(`Unknown setting: ${setting}\nValid: default-provider, default-model, language`);
      process.exit(1);
  }
}

export async function runConfigWizard(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan('  Codiente Setup Wizard'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────'));
  console.log();

  // ── Language ─────────────────────────────────────────────────────────────
  const langChoices = Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => ({
    name: `${code.padEnd(6)} ${name}`,
    value: code,
  }));

  const { chosenLang } = await inquirer.prompt([
    {
      type: 'list',
      name: 'chosenLang',
      message: 'Select response language / Yanıt dilini seçin:',
      choices: langChoices,
      default: 'tr',
    },
  ]) as { chosenLang: string };
  setLanguage(chosenLang);
  console.log(chalk.green(`  ✓ Language: ${SUPPORTED_LANGUAGES[chosenLang]}`));
  console.log();

  // ── Provider info ─────────────────────────────────────────────────────────
  console.log(chalk.bold('  🆓 Free options (no payment needed):'));
  console.log(chalk.dim('  • Groq       → console.groq.com          (Llama 3.3-70B, fast)'));
  console.log(chalk.dim('  • Gemini     → aistudio.google.com       (Flash free tier)'));
  console.log(chalk.dim('  • OpenRouter → openrouter.ai             (200+ models, some free)'));
  console.log(chalk.dim('  • DeepSeek   → platform.deepseek.com     (very cheap, $0.14/MTok)'));
  console.log(chalk.dim('  • Ollama     → ollama.ai                 (fully local, no key)'));
  console.log();
  console.log(chalk.bold('  💳 Paid options:'));
  console.log(chalk.dim('  • Anthropic  → console.anthropic.com     (Claude — best for coding)'));
  console.log(chalk.dim('  • OpenAI     → platform.openai.com       (GPT-4o)'));
  console.log(chalk.dim('  • Mistral    → console.mistral.ai        (Codestral for coding)'));
  console.log(chalk.dim('  • NVIDIA     → integrate.api.nvidia.com  (NIM models)'));
  console.log(chalk.dim('  • Together   → api.together.xyz'));
  console.log(chalk.dim('  • Perplexity → www.perplexity.ai         (internet-connected AI)'));
  console.log(chalk.dim('  • xAI        → console.x.ai              (Grok-2)'));
  console.log(chalk.dim('  • Cohere     → dashboard.cohere.com      (Command-R+)'));
  console.log();

  // ── Provider selection ────────────────────────────────────────────────────
  const providerChoices = [
    { name: 'Groq           — free, Llama 3.3-70B (recommended)', value: 'groq',        checked: true },
    { name: 'Google Gemini  — free flash tier available',          value: 'gemini',      checked: false },
    { name: 'OpenRouter     — 200+ models, some free',             value: 'openrouter',  checked: false },
    { name: 'DeepSeek       — cheapest ($0.14/MTok)',              value: 'deepseek',    checked: false },
    { name: 'Anthropic      — Claude Opus/Sonnet/Haiku',           value: 'anthropic',   checked: false },
    { name: 'OpenAI         — GPT-4o',                             value: 'openai',      checked: false },
    { name: 'Mistral AI     — Codestral coding specialist',        value: 'mistral',     checked: false },
    { name: 'NVIDIA NIM     — Nemotron 70B',                       value: 'nvidia',      checked: false },
    { name: 'Together AI    — open-source models',                 value: 'together',    checked: false },
    { name: 'Perplexity     — internet-connected AI',              value: 'perplexity',  checked: false },
    { name: 'xAI Grok       — Grok-2',                             value: 'xai',         checked: false },
    { name: 'Cohere         — Command-R+',                         value: 'cohere',      checked: false },
  ];

  const { selectedProviders } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedProviders',
      message: 'Which providers do you want to configure? (Space to select, Enter to confirm)',
      choices: providerChoices,
      validate: (ans: string[]) => ans.length > 0 || 'Please select at least one provider.',
    },
  ]) as { selectedProviders: string[] };

  console.log();

  // ── Key entry + live test ─────────────────────────────────────────────────
  const configured: string[] = [];

  for (const provider of selectedProviders) {
    const name = KEY_NAMES[provider] ?? provider;
    const hint = KEY_HINTS[provider] ? ` (${KEY_HINTS[provider]})` : '';
    const url  = KEY_URLS[provider]  ? chalk.dim(`  → ${KEY_URLS[provider]}`) : '';

    if (url) console.log(url);

    const { key } = await inquirer.prompt([
      {
        type: 'password',
        name: 'key',
        message: `${name} API key${hint} (Enter to skip):`,
      },
    ]) as { key: string };

    if (!key.trim()) {
      console.log(chalk.dim(`  Skipped ${name}`));
      console.log();
      continue;
    }

    // Test the key immediately
    const ora = (await import('ora')).default;
    const spinner = ora({ text: `Testing ${name} connection...`, color: 'cyan' }).start();

    const ok = await testProviderKey(provider, key.trim());

    if (ok) {
      spinner.succeed(chalk.green(`${name} — connected successfully ✓`));
      configured.push(provider);
    } else {
      spinner.fail(chalk.red(`${name} — key rejected (401)`));
      console.log(chalk.yellow(`  Key was NOT saved. Check your key at: ${KEY_URLS[provider] ?? 'provider dashboard'}`));

      const { retry } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'retry',
          message: 'Try a different key?',
          default: true,
        },
      ]) as { retry: boolean };

      if (retry) {
        if (url) console.log(url);
        const { key2 } = await inquirer.prompt([
          {
            type: 'password',
            name: 'key2',
            message: `${name} API key (retry):`,
            validate: (input: string) => input.trim().length > 0 || 'Cannot be empty',
          },
        ]) as { key2: string };

        const spinner2 = ora({ text: `Testing ${name}...`, color: 'cyan' }).start();
        const ok2 = await testProviderKey(provider, key2.trim());
        if (ok2) {
          spinner2.succeed(chalk.green(`${name} — connected ✓`));
          configured.push(provider);
        } else {
          spinner2.fail(chalk.red(`${name} — still rejected. Skipping.`));
        }
      }
    }
    console.log();
  }

  if (configured.length === 0) {
    console.log(chalk.yellow('  No providers configured.'));
    console.log(chalk.dim('  Add a key later with: cude config set-key <provider> <key>'));
    return;
  }

  // ── Default provider ──────────────────────────────────────────────────────
  let defaultProv = configured[0];
  if (configured.length > 1) {
    const { chosen } = await inquirer.prompt([
      {
        type: 'list',
        name: 'chosen',
        message: 'Which provider should be used by default?',
        choices: configured.map(p => ({ name: `${KEY_NAMES[p]}`, value: p })),
        default: configured[0],
      },
    ]) as { chosen: string };
    defaultProv = chosen;
  }

  setDefaultProvider(defaultProv);
  console.log(chalk.green(`  ✓ Default provider: ${KEY_NAMES[defaultProv]}`));
  console.log();

  showSuccess(`${configured.length} provider${configured.length !== 1 ? 's' : ''} configured!`);

  // ── Web Search ────────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.bold('  🔍 Web Search (optional)'));
  console.log(chalk.dim('  The agent can search the internet using Jina.ai (free, no key needed)'));
  console.log(chalk.dim('  or Brave Search API (faster, more reliable, free tier available).'));
  console.log(chalk.dim('  Get key: search.brave.com/search/api'));
  console.log();

  const { configureBrave } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureBrave',
      message: 'Add a Brave Search API key for better web search?',
      default: false,
    },
  ]) as { configureBrave: boolean };

  if (configureBrave) {
    const { braveKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'braveKey',
        message: 'Brave Search API key (BSA...):',
        validate: (input: string) => input.trim().length > 0 || 'Cannot be empty',
      },
    ]) as { braveKey: string };

    setApiKey('brave', braveKey.trim());
    console.log(chalk.green('  ✓ Brave Search API key saved'));
  } else {
    console.log(chalk.dim('  ○ Skipped — Jina.ai will be used as fallback'));
  }

  // ── Browser Automation ────────────────────────────────────────────────────
  console.log();
  console.log(chalk.bold('  🌐 Browser Automation (optional)'));
  console.log(chalk.dim('  The agent can open Chromium, click buttons, fill forms, take screenshots.'));
  console.log(chalk.dim('  Requires a one-time download of Playwright + Chromium (~150–200 MB).'));
  console.log(chalk.dim('  If skipped now, it will auto-install the first time you use a browser tool.'));
  console.log();

  const { installBrowser } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'installBrowser',
      message: 'Install Playwright + Chromium now?',
      default: false,
    },
  ]) as { installBrowser: boolean };

  if (installBrowser) {
    try {
      const { setupBrowserAutomation } = await import('../core/tools.js');
      await setupBrowserAutomation();
    } catch (err) {
      console.log(chalk.red(`  ✗ Install failed: ${err instanceof Error ? err.message : String(err)}`));
      console.log(chalk.dim('  You can retry later: cude config setup'));
    }
  } else {
    console.log(chalk.dim('  ○ Skipped — will auto-install on first browser tool use'));
  }

  console.log();
  console.log(chalk.bold('  You\'re ready! Try:'));
  console.log(`  ${chalk.cyan('cude chat')}              — start chatting`);
  console.log(`  ${chalk.cyan('cude chat --free')}       — use only free providers`);
  console.log(`  ${chalk.cyan('cude providers list')}    — see all provider status`);
  console.log(`  ${chalk.cyan('cude run "<task>"')}      — autonomous AI agent`);
  console.log();
}
