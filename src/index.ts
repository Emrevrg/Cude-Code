#!/usr/bin/env node
import { createCLI, checkFirstRun } from './cli.js';
import { showError } from './ui/display.js';

async function main(): Promise<void> {
  await checkFirstRun();

  const program = createCLI();

  // If no args, show help
  if (process.argv.length <= 2) {
    const { showBanner } = await import('./ui/display.js');
    showBanner();
    program.help();
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  showError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
