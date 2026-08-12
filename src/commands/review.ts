import { execFile } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import { selectProviderAndModel } from '../core/selector.js';
import { loadProjectContext, formatProjectContext, loadProjectSkills, formatProjectSkills } from '../core/context.js';
import { renderMarkdown, showError } from '../ui/display.js';
import type { Message } from '../providers/types.js';

const execFileAsync = promisify(execFile);

export async function runReview(options: { provider?: string; model?: string; free?: boolean; json?: boolean } = {}): Promise<void> {
  const selected = selectProviderAndModel('code', {
    free: options.free ?? false,
    preferredProvider: options.provider,
    preferredModel: options.model,
  });
  let diff = '';
  try {
    const result = await execFileAsync('git', ['diff', '--no-ext-diff', '--unified=80', 'HEAD'], {
      cwd: process.cwd(), windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    diff = result.stdout;
  } catch (error) {
    showError(`Cannot read git diff: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  if (!diff.trim()) {
    if (options.json) process.stdout.write(JSON.stringify({ verdict: 'clean', findings: [] }) + '\n');
    else console.log(chalk.dim('\n  No uncommitted changes to review.\n'));
    return;
  }
  const systemPrompt = `You are Cude Code Review. Review only the supplied diff.\n` +
    `Return a release verdict and findings ranked P0, P1, P2, or P3 with file/line references.\n` +
    `Do not modify files and do not invent issues not supported by the diff.\n` +
    formatProjectContext(loadProjectContext()) + formatProjectSkills(loadProjectSkills());
  const messages: Message[] = [{ role: 'user', content: `Review this change:\n\n${diff}` }];
  try {
    const response = await selected.provider.chat(messages, selected.model, { systemPrompt, maxTokens: 4096 });
    if (options.json) {
      process.stdout.write(JSON.stringify({ provider: selected.provider.name, model: selected.model, verdict: response.content }) + '\n');
      return;
    }
    console.log(chalk.bold.cyan(`\n  Cude Review · ${selected.provider.displayName} / ${selected.model}\n`));
    console.log(renderMarkdown(response.content));
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
