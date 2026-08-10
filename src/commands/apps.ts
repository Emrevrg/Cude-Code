import chalk from 'chalk';
import boxen from 'boxen';
import inquirer from 'inquirer';
import {
  getInstalledApps,
  getApp,
  installApp,
  uninstallApp,
  searchApps,
  type App,
} from '../apps/registry.js';
import { showError, showInfo, showSuccess } from '../ui/display.js';
import { showAppTable } from '../ui/display.js';

export async function runAppsList(query?: string): Promise<void> {
  const apps = query ? searchApps(query) : getInstalledApps();
  if (apps.length === 0) {
    console.log(chalk.dim('  No apps found.'));
    return;
  }
  showAppTable(apps);
}

export async function runAppsInfo(id: string): Promise<void> {
  const app = getApp(id);
  if (!app) {
    showError(`App not found: ${id}\nRun: cude apps list`);
    return;
  }

  const lines: string[] = [
    `${app.icon}  ${chalk.bold.white(app.name)}  ${chalk.dim(`v${app.version}`)}`,
    '',
    chalk.dim('ID:          ') + chalk.cyan(app.id),
    chalk.dim('Author:      ') + chalk.white(app.author),
    chalk.dim('Tags:        ') + app.tags.map(t => chalk.hex('#7c3aed')(t)).join(chalk.dim(', ')),
    chalk.dim('Builtin:     ') + (app.builtin ? chalk.green('Yes') : chalk.yellow('No')),
    '',
    chalk.bold('Description:'),
    chalk.white(app.description),
    '',
    chalk.bold('System Prompt Preview:'),
    chalk.dim(app.systemPrompt.substring(0, 300) + (app.systemPrompt.length > 300 ? '...' : '')),
  ];

  if (app.examplePrompts && app.examplePrompts.length > 0) {
    lines.push('');
    lines.push(chalk.bold('Example Prompts:'));
    for (const ep of app.examplePrompts) {
      lines.push(chalk.dim('  • ') + chalk.white(ep));
    }
  }

  console.log(
    boxen(lines.join('\n'), {
      padding: 1,
      margin: { top: 1, bottom: 1, left: 1, right: 0 },
      borderStyle: 'round',
      borderColor: 'cyan',
      title: chalk.cyan.bold(' App Details '),
      titleAlignment: 'left',
    })
  );
}

export async function runAppsInstall(id: string): Promise<void> {
  // For future remote app installs; currently only supports builtin apps
  const app = getApp(id);
  if (!app) {
    showError(`App not found: ${id}\nBuiltin apps are pre-installed. Remote app installation coming soon.`);
    return;
  }
  if (app.builtin) {
    showInfo(`${app.icon} ${app.name} is a builtin app and is always available.`);
    return;
  }
  showSuccess(`${app.icon} ${app.name} installed successfully.`);
}

export async function runAppsUninstall(id: string): Promise<void> {
  const app = getApp(id);
  if (!app) {
    showError(`App not found: ${id}`);
    return;
  }
  if (app.builtin) {
    showError(`Cannot uninstall builtin app: ${app.name}`);
    return;
  }
  const removed = uninstallApp(id);
  if (removed) {
    showSuccess(`${app.icon} ${app.name} uninstalled.`);
  } else {
    showError(`Failed to uninstall: ${id}`);
  }
}

export async function runAppsUse(id: string, chatOptions?: Record<string, unknown>): Promise<void> {
  const app = getApp(id);
  if (!app) {
    showError(`App not found: ${id}\nRun: cude apps list`);
    return;
  }

  showInfo(`Activating ${app.icon} ${chalk.cyan(app.name)}...`);
  console.log(chalk.dim(`  ${app.description}`));
  console.log();

  const { runChat } = await import('./chat.js');
  await runChat({
    ...(chatOptions as Record<string, unknown>),
    system: app.systemPrompt,
    session: `app-${app.id}-${Date.now()}`,
  } as Parameters<typeof runChat>[0]);
}

export async function runAppsCreate(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan('  ◈ Create Custom App'));
  console.log(chalk.dim('  Build your own specialized AI assistant'));
  console.log();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'id',
      message: 'App ID (e.g. my-code-helper):',
      validate: (input: string) => {
        if (!input.trim()) return 'App ID is required';
        if (!/^[a-z0-9-]+$/.test(input)) return 'ID must be lowercase letters, numbers, and hyphens only';
        if (getApp(input)) return `App ID "${input}" already exists`;
        return true;
      },
    },
    {
      type: 'input',
      name: 'name',
      message: 'App Name:',
      validate: (input: string) => input.trim().length > 0 || 'Name is required',
    },
    {
      type: 'input',
      name: 'description',
      message: 'Short description:',
      validate: (input: string) => input.trim().length > 0 || 'Description is required',
    },
    {
      type: 'input',
      name: 'icon',
      message: 'Icon (emoji):',
      default: '🤖',
    },
    {
      type: 'input',
      name: 'tags',
      message: 'Tags (comma-separated, e.g. coding,review):',
      default: 'custom',
      filter: (input: string) => input.split(',').map((t: string) => t.trim()).filter(Boolean),
    },
    {
      type: 'editor',
      name: 'systemPrompt',
      message: 'System Prompt (opens in editor):',
      validate: (input: string) => {
        if (!input.trim()) return 'System prompt is required';
        if (input.trim().length < 50) return 'System prompt should be at least 50 characters';
        return true;
      },
    },
  ]);

  const newApp: App = {
    id: answers.id as string,
    name: answers.name as string,
    description: answers.description as string,
    icon: answers.icon as string,
    version: '1.0.0',
    author: 'Custom',
    tags: answers.tags as string[],
    systemPrompt: answers.systemPrompt as string,
    builtin: false,
  };

  installApp(newApp);
  showSuccess(`${newApp.icon} App "${newApp.name}" created successfully!\n\nActivate it with: cude apps use ${newApp.id}`);
}
