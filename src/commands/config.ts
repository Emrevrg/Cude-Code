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

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'groq'];
const KEY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI GPT',
  gemini: 'Google Gemini',
  groq: 'Groq (Free)',
};

export async function runConfigSetKey(provider: string, key?: string): Promise<void> {
  if (!PROVIDERS.includes(provider)) {
    showError(`Unknown provider: ${provider}\nValid providers: ${PROVIDERS.join(', ')}`);
    process.exit(1);
  }

  let apiKey = key;
  if (!apiKey) {
    const answer = await inquirer.prompt([
      {
        type: 'password',
        name: 'key',
        message: `Enter ${KEY_NAMES[provider] ?? provider} API key:`,
        validate: (input: string) => input.trim().length > 0 || 'API key cannot be empty',
      },
    ]);
    apiKey = (answer as { key: string }).key;
  }

  setApiKey(provider, apiKey!.trim());
  showSuccess(`API key for ${KEY_NAMES[provider] ?? provider} saved successfully`);
}

export async function runConfigRemoveKey(provider: string): Promise<void> {
  if (!PROVIDERS.includes(provider)) {
    showError(`Unknown provider: ${provider}`);
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
      if (!PROVIDERS.includes(value) && value !== 'ollama') {
        showError(`Invalid provider: ${value}\nValid: ${[...PROVIDERS, 'ollama'].join(', ')}`);
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
  console.log(chalk.bold.cyan('  Welcome to Codiente CLI Setup Wizard!'));
  console.log(chalk.dim('  Let\'s configure your AI providers.'));
  console.log();
  console.log(chalk.dim('  Free options:'));
  console.log(chalk.dim('  - Groq: Get a free key at https://console.groq.com'));
  console.log(chalk.dim('  - Gemini: Get a free key at https://aistudio.google.com'));
  console.log(chalk.dim('  - Ollama: Install locally at https://ollama.ai'));
  console.log();

  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupGroq',
      message: 'Set up Groq (free, fast)?',
      default: true,
    },
    {
      type: 'password',
      name: 'groqKey',
      message: 'Enter Groq API key:',
      when: (ans: Record<string, unknown>) => Boolean(ans['setupGroq']),
      validate: (input: string) => input.trim().length > 0 || 'Key cannot be empty',
    },
    {
      type: 'confirm',
      name: 'setupGemini',
      message: 'Set up Google Gemini (free tier available)?',
      default: false,
    },
    {
      type: 'password',
      name: 'geminiKey',
      message: 'Enter Gemini API key:',
      when: (ans: Record<string, unknown>) => Boolean(ans['setupGemini']),
      validate: (input: string) => input.trim().length > 0 || 'Key cannot be empty',
    },
    {
      type: 'confirm',
      name: 'setupAnthropic',
      message: 'Set up Anthropic Claude (paid)?',
      default: false,
    },
    {
      type: 'password',
      name: 'anthropicKey',
      message: 'Enter Anthropic API key:',
      when: (ans: Record<string, unknown>) => Boolean(ans['setupAnthropic']),
      validate: (input: string) => input.trim().length > 0 || 'Key cannot be empty',
    },
    {
      type: 'confirm',
      name: 'setupOpenAI',
      message: 'Set up OpenAI GPT (paid)?',
      default: false,
    },
    {
      type: 'password',
      name: 'openaiKey',
      message: 'Enter OpenAI API key:',
      when: (ans: Record<string, unknown>) => Boolean(ans['setupOpenAI']),
      validate: (input: string) => input.trim().length > 0 || 'Key cannot be empty',
    },
  ]) as Record<string, string | boolean>;

  let configured = 0;

  if (answers['groqKey']) {
    setApiKey('groq', String(answers['groqKey']).trim());
    configured++;
  }
  if (answers['geminiKey']) {
    setApiKey('gemini', String(answers['geminiKey']).trim());
    configured++;
  }
  if (answers['anthropicKey']) {
    setApiKey('anthropic', String(answers['anthropicKey']).trim());
    configured++;
  }
  if (answers['openaiKey']) {
    setApiKey('openai', String(answers['openaiKey']).trim());
    configured++;
  }

  if (configured > 0) {
    showSuccess(`${configured} provider${configured !== 1 ? 's' : ''} configured successfully!`);
    console.log(chalk.dim('\n  Run "codiente chat" to start chatting.\n'));
  } else {
    console.log(chalk.dim('\n  No providers configured. You can add them later with:'));
    console.log(chalk.cyan('  codiente config set-key <provider> <key>'));
    console.log(chalk.dim('\n  For free options, try:'));
    console.log(chalk.cyan('  codiente chat --free  (uses Ollama local)'));
    console.log();
  }
}
