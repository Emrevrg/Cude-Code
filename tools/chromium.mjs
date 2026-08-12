// Launches Chromium for the scripts in this directory.
//
// Normally Playwright resolves its own bundled browser and no path is needed.
// Some sandboxes (including the one these scripts were written in) ship a
// browser at a fixed location instead and set PLAYWRIGHT_BROWSERS_PATH, so this
// falls back to whatever it can find rather than hardcoding one machine's path.
//
// Resolution order: CUDE_CHROME_PATH, then a browser found under
// PLAYWRIGHT_BROWSERS_PATH, then Playwright's own.

import { statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const isExecutableFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** A pre-installed Chromium binary under PLAYWRIGHT_BROWSERS_PATH, if there is one. */
function preinstalledChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root) return undefined;

  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return undefined;
  }

  // Playwright's own layout is <root>/chromium-<rev>/chrome-linux/chrome; some
  // images flatten it to <root>/chromium/chrome. Both are directories here, so
  // only a real file counts — a directory named `chromium` is not a browser.
  const candidates = [];
  for (const entry of entries) {
    if (!entry.startsWith('chromium')) continue;
    candidates.push(
      join(root, entry, 'chrome-linux', 'chrome'),
      join(root, entry, 'chrome'),
      join(root, entry)
    );
  }
  return candidates.find(isExecutableFile);
}

export async function launchChromium(options = {}) {
  // An explicit CUDE_CHROME_PATH wins: if someone names a browser, use theirs.
  const executablePath = process.env.CUDE_CHROME_PATH || preinstalledChromium();
  const args = ['--no-sandbox', ...(options.args ?? [])];
  try {
    return await chromium.launch({ ...options, args, ...(executablePath ? { executablePath } : {}) });
  } catch (err) {
    if (!executablePath) {
      throw new Error(
        `Could not launch Chromium: ${err.message}\n` +
          'Install it with: npx playwright install chromium'
      );
    }
    // Falling back to a different browser than the one that was named is
    // surprising enough to say out loud — otherwise a typo in
    // CUDE_CHROME_PATH looks like it worked.
    console.warn(`Could not launch Chromium at ${executablePath} (${err.message.split('\n')[0]}); trying Playwright's own.`);
    // The pre-installed build may not match the installed Playwright version;
    // let Playwright try its own before giving up.
    return chromium.launch({ ...options, args });
  }
}
