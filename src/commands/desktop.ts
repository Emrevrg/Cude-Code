import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';

export async function desktopCommand(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, '..', '..');

  // Look for packaged app or dev electron
  const electronApp = path.join(root, 'dist-packages', 'Codiente');
  const electronBin = path.join(root, 'node_modules', '.bin', 'electron');
  const mainJs = path.join(root, 'dist-electron', 'main.js');

  if (fs.existsSync(electronApp)) {
    // Launch packaged app
    spawn(electronApp, [], { detached: true, stdio: 'ignore' }).unref();
    console.log(chalk.green('✓ Codiente Desktop launched'));
  } else if (fs.existsSync(electronBin) && fs.existsSync(mainJs)) {
    // Launch with electron binary
    spawn(electronBin, [mainJs], { detached: true, stdio: 'ignore' }).unref();
    console.log(chalk.green('✓ Codiente Desktop launched'));
  } else {
    console.log(chalk.yellow('Desktop app not built yet. Run: npm run build:desktop'));
    console.log(chalk.dim('  Then optionally: npm run package:linux (or :win / :mac)'));
  }
}
