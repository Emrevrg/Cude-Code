import chalk from 'chalk';
import { listProviders, getProvider, isSelfHosted } from '../providers/index.js';
import { MODELS } from '../config/models.js';
import { showProviderTable, showModelTable } from '../ui/display.js';
import { startSpinner, stopSpinner } from '../ui/spinner.js';
import { OllamaProvider } from '../providers/ollama.js';
import { getCustomProviders, saveCustomProvider, removeCustomProvider } from '../config/index.js';

export function runCustomProvidersList(): void {
  const providers = getCustomProviders();
  console.log();
  console.log(chalk.bold.cyan('  Custom OpenAI-compatible providers'));
  if (!providers.length) console.log(chalk.dim('  None configured. Add one with: cude providers add <name> --base-url <url> --model <id>'));
  for (const provider of providers) console.log('  ' + chalk.cyan(provider.name) + '  ' + provider.baseUrl + '  ' + chalk.dim(provider.model) + (provider.local ? chalk.green('  [local]') : ''));
  console.log();
}

export function runCustomProviderAdd(name: string, options: { baseUrl: string; model: string; displayName?: string; apiKeyEnv?: string; apiKey?: string; local?: boolean }): void {
  saveCustomProvider({ name, displayName: options.displayName ?? name, baseUrl: options.baseUrl, model: options.model, apiKeyEnv: options.apiKeyEnv, apiKey: options.apiKey, local: options.local });
  console.log(chalk.green('  Custom provider saved: ' + name));
  console.log(chalk.dim('  Use: cude run "task" -p ' + name + ' -m ' + options.model + ' --yes'));
}

export function runCustomProviderRemove(name: string): void {
  console.log(removeCustomProvider(name) ? chalk.green('  Removed custom provider: ' + name) : chalk.yellow('  Custom provider not found: ' + name));
}

export async function runProvidersList(): Promise<void> {
  const providers = listProviders();
  startSpinner('Checking provider availability...');

  const results = await Promise.all(
    providers.map(async (provider) => {
      const available = await provider.isAvailable();
      return { provider, available };
    })
  );

  stopSpinner(true);

  console.log();
  console.log(chalk.bold.cyan('  AI Providers'));
  showProviderTable(results);

  // Show available models for configured providers
  const configuredCount = results.filter(r => r.provider.isConfigured() || r.available).length;
  console.log(chalk.dim(`  ${configuredCount} of ${providers.length} providers available`));
  console.log();
  console.log(chalk.dim('  Add API keys: cude config set-key <provider> <key>'));
  console.log(chalk.dim('  List models:  cude providers models'));
  console.log();
}

export async function runProvidersTest(): Promise<void> {
  const providers = listProviders();
  console.log();
  console.log(chalk.bold.cyan('  Testing Providers...'));
  console.log();

  for (const provider of providers) {
    startSpinner(`Testing ${provider.displayName}...`);
    try {
      const available = await provider.isAvailable();
      if (available) {
        stopSpinner(true, `${provider.displayName}: OK`);
      } else if (!provider.isConfigured() && provider.name !== 'ollama') {
        stopSpinner(false, `${provider.displayName}: Not configured`);
      } else {
        stopSpinner(false, `${provider.displayName}: Unavailable`);
      }
    } catch (err) {
      stopSpinner(false, `${provider.displayName}: Error - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Test Ollama models if available
  const ollamaProvider = providers.find(p => p.name === 'ollama') as OllamaProvider | undefined;
  if (ollamaProvider) {
    startSpinner('Checking Ollama models...');
    try {
      const available = await ollamaProvider.isAvailable();
      if (available) {
        const models = await ollamaProvider.getInstalledModels();
        stopSpinner(true, `Ollama: ${models.length} model${models.length !== 1 ? 's' : ''} installed`);
        if (models.length > 0) {
          for (const m of models) {
            console.log(chalk.dim(`    - ${m.name}`));
          }
        }
      } else {
        stopSpinner(false, 'Ollama: Not running');
      }
    } catch {
      stopSpinner(false, 'Ollama: Error checking models');
    }
  }

  console.log();
}

/**
 * Prints what a self-hosted provider serves: the live model list when the
 * server is reachable, and how to find it otherwise. Returns false when the
 * provider is not self-hosted, so the caller can fall back.
 */
export async function showSelfHostedModels(providerName: string): Promise<boolean> {
  let provider;
  try {
    provider = getProvider(providerName);
  } catch {
    return false;
  }
  if (!isSelfHosted(provider)) return false;

  console.log();
  console.log(chalk.bold.cyan(`  ${provider.displayName}`));
  console.log(chalk.dim('  ─'.repeat(40)));
  console.log(
    chalk.dim('  This provider has no fixed model catalog — the model name is\n') +
    chalk.dim('  whatever the running server has loaded.')
  );
  console.log();

  try {
    const models = await provider.listRemoteModels!();
    if (models.length > 0) {
      console.log(chalk.bold.white('  Served right now:'));
      for (const id of models) {
        console.log(`    ${chalk.white(id.padEnd(40))} ${chalk.cyan('[local free]')}`);
      }
      console.log();
      console.log(chalk.dim('  Use: ') + chalk.cyan(`cude run "task" -p ${provider.name} -m ${models[0]}`));
      console.log();
      return true;
    }
    console.log(chalk.yellow('  The server is reachable but reports no models.'));
  } catch {
    console.log(chalk.yellow('  The server is not reachable right now.'));
  }

  console.log();
  console.log(chalk.dim('  Point Cude at it, then ask it what it serves:'));
  console.log(chalk.cyan(`    cude config set-endpoint ${provider.name} <url>`));
  console.log(chalk.cyan(`    cude providers models ${provider.name}`));
  console.log();
  console.log(chalk.dim('  Then pass the id with -m:'));
  console.log(chalk.cyan(`    cude run "task" -p ${provider.name} -m <model-id>`));
  console.log();
  return true;
}

export async function runProvidersModels(providerFilter?: string): Promise<void> {
  const allModels = Object.values(MODELS).map(m => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    free: m.free,
    local: m.local,
    pricing: m.pricing,
  }));

  const filtered = providerFilter
    ? allModels.filter(m => m.provider === providerFilter)
    : allModels;

  if (filtered.length === 0) {
    // Self-hosted providers have no fixed catalog: the model name is whatever
    // the running server has loaded. "No models found" made -m mandatory but
    // undiscoverable.
    if (providerFilter && (await showSelfHostedModels(providerFilter))) return;
    console.log(chalk.yellow(`  No models found for provider: ${providerFilter}`));
    return;
  }

  showModelTable(filtered);

  // Show Ollama models if available
  const providers = listProviders();
  const ollamaProvider = providers.find(p => p.name === 'ollama') as OllamaProvider | undefined;
  if (ollamaProvider && (!providerFilter || providerFilter === 'ollama')) {
    try {
      const available = await ollamaProvider.isAvailable();
      if (available) {
        const ollamaModels = await ollamaProvider.getInstalledModels();
        if (ollamaModels.length > 0) {
          console.log(chalk.bold.cyan('  Installed Ollama Models:'));
          console.log(chalk.dim('  ─'.repeat(40)));
          for (const m of ollamaModels) {
            const sizeMB = Math.round(m.size / (1024 * 1024));
            console.log(`  ${chalk.white(m.name.padEnd(35))} ${chalk.cyan('[local free]')} ${chalk.dim(`${sizeMB} MB`)}`);
          }
          console.log();
          console.log(chalk.dim('  Use: cude chat --model ollama/<name>'));
          console.log();
        } else {
          console.log(chalk.dim('  No Ollama models installed. Run: ollama pull llama3'));
          console.log();
        }
      }
    } catch {
      // Ollama not available, skip
    }
  }
}
