import chalk from 'chalk';
import { listProviders } from '../providers/index.js';
import { MODELS } from '../config/models.js';
import { showProviderTable, showModelTable, showBanner, printSeparator } from '../ui/display.js';
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

  showBanner();
  console.log(chalk.bold.hex('#06b6d4')('  ◈ AI Providers'));
  printSeparator();
  showProviderTable(results);

  const configuredCount = results.filter(r => r.provider.isConfigured() || r.available).length;
  const freeCount       = results.filter(r => r.provider.name === 'groq' || r.provider.name === 'ollama').length;

  console.log(
    chalk.dim('  ') +
    chalk.green(`${configuredCount} available`) +
    chalk.dim(` of ${providers.length} providers  ·  `) +
    chalk.green(`${freeCount} free`)
  );
  console.log();
  console.log(chalk.dim('  cude config set-key <provider> <key>') + chalk.dim('   add a key'));
  console.log(chalk.dim('  cude providers models               ') + chalk.dim('   list models'));
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
  let allModels = Object.values(MODELS).map(m => ({
    id: m.id, name: m.name, provider: m.provider,
    free: m.free, local: m.local, pricing: m.pricing,
  }));

  // Live OpenRouter model list — fetch if provider is openrouter or no filter
  if (!providerFilter || providerFilter === 'openrouter') {
    const { OpenRouterProvider } = await import('../providers/openrouter.js');
    const or = new OpenRouterProvider();
    if (or.isConfigured()) {
      const spinner = startSpinner('Fetching live OpenRouter model list…');
      try {
        await or.refreshModels();
        const liveModels = or.listModels();
        stopSpinner(true, `OpenRouter: ${liveModels.length} models`);
        // Replace static openrouter entries with live ones
        allModels = allModels.filter(m => m.provider !== 'openrouter');
        allModels.push(...liveModels as typeof allModels);
      } catch {
        stopSpinner(false, 'OpenRouter: could not fetch live list, using cached');
      }
    }
  }

  const filtered = providerFilter
    ? allModels.filter(m => m.provider === providerFilter)
    : allModels;

  if (filtered.length === 0) {
    console.log(chalk.yellow(`  No models found for provider: ${providerFilter}`));
    return;
  }

  // For openrouter, show free models first then group
  if (providerFilter === 'openrouter' || !providerFilter) {
    const freeOr  = filtered.filter(m => m.provider === 'openrouter' && m.free);
    const paidOr  = filtered.filter(m => m.provider === 'openrouter' && !m.free);
    const others  = filtered.filter(m => m.provider !== 'openrouter');
    const sorted  = [...others, ...freeOr, ...paidOr];
    showModelTable(sorted.slice(0, 120));
  } else {
    showModelTable(filtered);
  }

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
