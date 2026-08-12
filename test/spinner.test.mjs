// Spinner output stream (F10).
//
// ora writes to stderr by default. Through the cude.ps1 shim, PowerShell wraps
// every stderr line in a NativeCommandError, so normal progress output looked
// like a crash:
//
//   node.exe : - Checking provider availability...
//       + CategoryInfo : NotSpecified: (...) [], RemoteException

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

/** Runs `script` in a child process so the two streams stay separable. */
function runScript(script) {
  return execFileAsync(process.execPath, ['--input-type=module', '-e', script], { cwd: root });
}

describe('F10: progress output does not go to stderr', () => {
  test('F10: the spinner writes to stdout and leaves stderr clean', async () => {
    const { stdout, stderr } = await runScript(`
      const { startSpinner, stopSpinner } = await import('./dist/ui/spinner.js');
      startSpinner('checking-provider-availability');
      stopSpinner(true, 'done-checking');
    `);

    assert.match(stdout, /checking-provider-availability/, 'spinner text must reach stdout');
    assert.equal(stderr, '', `stderr must stay clean, got: ${stderr}`);
  });

  test('F10: a failed spinner also stays on stdout', async () => {
    const { stdout, stderr } = await runScript(`
      const { startSpinner, stopSpinner } = await import('./dist/ui/spinner.js');
      startSpinner('working');
      stopSpinner(false, 'task-failed-message');
    `);

    assert.match(stdout, /task-failed-message/);
    assert.equal(stderr, '', `stderr must stay clean, got: ${stderr}`);
  });

  test('F10: warnings are not errors and stay on stdout', async () => {
    const { stdout, stderr } = await runScript(`
      const { showWarning } = await import('./dist/ui/display.js');
      showWarning('careful-now');
    `);

    assert.match(stdout, /careful-now/);
    assert.equal(stderr, '');
  });

  test('F10: genuine errors still go to stderr', async () => {
    const { stdout, stderr } = await runScript(`
      const { showError } = await import('./dist/ui/display.js');
      showError('something-broke');
    `);

    assert.match(stderr, /something-broke/, 'errors belong on stderr');
    assert.doesNotMatch(stdout, /something-broke/);
  });
});
