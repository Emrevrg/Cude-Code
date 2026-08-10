import chalk from 'chalk';
import { listProviders } from '../providers/index.js';
import { MODELS } from '../config/models.js';
import { showProviderTable, showModelTable } from '../ui/display.js';
import { startSpinner, stopSpinner } from '../ui/spinner.js';
import { OllamaProvider } from '../providers/ollama.js';

export async function runProvidersList(): Promise<void> {
  const providers = listProviders();
  const spinner = startSpinner('Checking provider availability...');

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
    const spinner = startSpinner(`Testing ${provider.displayName}...`);
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
    const spinner = startSpinner('Checking Ollama models...');
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
