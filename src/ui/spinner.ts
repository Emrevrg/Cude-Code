import ora, { type Ora } from 'ora';
import chalk from 'chalk';

let activeSpinner: Ora | null = null;

/**
 * ora writes to stderr by default. Run through the cude.ps1 shim, PowerShell
 * wraps every stderr line in a NativeCommandError, so ordinary progress output
 * ("- Checking provider availability...") reads as a crash. Progress is not an
 * error: it belongs on stdout, and stderr stays for genuine failures.
 */
const SPINNER_STREAM = process.stdout;

export function startSpinner(text: string): Ora {
  if (activeSpinner) {
    activeSpinner.stop();
  }
  activeSpinner = ora({
    text,
    color: 'cyan',
    spinner: 'dots',
    stream: SPINNER_STREAM,
  }).start();
  return activeSpinner;
}

export function stopSpinner(success = true, message?: string): void {
  if (!activeSpinner) return;
  if (success) {
    activeSpinner.succeed(message ? chalk.green(message) : undefined);
  } else {
    activeSpinner.fail(message ? chalk.red(message) : undefined);
  }
  activeSpinner = null;
}

export function updateSpinner(text: string): void {
  if (activeSpinner) {
    activeSpinner.text = text;
  }
}

export function withSpinner<T>(
  text: string,
  fn: () => Promise<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const spinner = startSpinner(text);
    fn()
      .then(result => {
        spinner.succeed();
        activeSpinner = null;
        resolve(result);
      })
      .catch(err => {
        spinner.fail(err instanceof Error ? err.message : String(err));
        activeSpinner = null;
        reject(err);
      });
  });
}
