#!/usr/bin/env node
import { createCLI, checkFirstRun } from './cli.js';
import { showError } from './ui/display.js';

async function main(): Promise<void> {
  try {
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
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
