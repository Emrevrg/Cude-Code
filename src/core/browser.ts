import { resolve } from 'path';
import type { ToolDefinition } from '../providers/types.js';
import type { ToolResult } from './tools.js';
import { getWorkspaceRoot, isInsideWorkspace } from './tools.js';
import { denyUrlReason } from './security.js';

export const BROWSER_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL in a headless browser and return the page content as text',
    parameters: {
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to',
        },
        wait_for: {
          type: 'string',
          description: 'Optional CSS selector to wait for before extracting content',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of a webpage and save it to a file',
    parameters: {
      properties: {
        url: {
          type: 'string',
          description: 'The URL to screenshot',
        },
        output: {
          type: 'string',
          description: 'Output file path for the screenshot (PNG)',
        },
        full_page: {
          type: 'boolean',
          description: 'Capture the full page (default: false)',
        },
      },
      required: ['url', 'output'],
    },
  },
  {
    name: 'browser_extract',
    description: 'Extract specific content from a webpage using CSS selectors',
    parameters: {
      properties: {
        url: {
          type: 'string',
          description: 'The URL to extract from',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to extract content from',
        },
        attribute: {
          type: 'string',
          description: 'Optional attribute to extract instead of text content (e.g. "href", "src")',
        },
      },
      required: ['url', 'selector'],
    },
  },
];

let browserModule: typeof import('playwright') | null = null;

async function getBrowser() {
  if (!browserModule) {
    try {
      browserModule = await import('playwright');
    } catch {
      throw new Error('Playwright is not installed. Run: npm install playwright');
    }
  }

  try {
    return await browserModule.chromium.launch({ headless: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Playwright ships as a dependency, but the browser binaries are a separate
    // ~150 MB download that can be skipped or fail behind a proxy. Without this
    // the user just gets Playwright's raw stack trace.
    if (/Executable doesn't exist|please run the following command/i.test(message)) {
      throw new Error(
        'Chromium is not installed for Playwright. Run:\n' +
        '  npx playwright install chromium\n' +
        'Browser tools (browser_navigate, browser_screenshot, browser_extract) ' +
        'need it; the rest of Cude Code works without it.'
      );
    }
    throw err;
  }
}

/**
 * The browser is the agent's connection to content nobody vetted, and the
 * shortest path from a hostile page to a stolen cloud role is a request to a
 * metadata endpoint. Every entry point checks its URL before a page is opened.
 */
function guardUrl(url: string): ToolResult | null {
  const reason = denyUrlReason(url);
  if (!reason) return null;
  return { success: false, output: '', error: reason };
}

export async function executeBrowserTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const url = args.url;
  if (typeof url === 'string') {
    const denied = guardUrl(url);
    if (denied) return denied;
  }

  switch (name) {
    case 'browser_navigate':
      return browserNavigate(
        args.url as string,
        args.wait_for as string | undefined,
        args.timeout as number | undefined
      );
    case 'browser_screenshot':
      return browserScreenshot(
        args.url as string,
        args.output as string,
        args.full_page as boolean | undefined
      );
    case 'browser_extract':
      return browserExtract(
        args.url as string,
        args.selector as string,
        args.attribute as string | undefined
      );
    default:
      return { success: false, output: '', error: `Unknown browser tool: ${name}` };
  }
}

async function browserNavigate(
  url: string,
  waitFor?: string,
  timeout?: number
): Promise<ToolResult> {
  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(url, { timeout: timeout ?? 30000, waitUntil: 'domcontentloaded' });

    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: timeout ?? 30000 });
    }

    const title = await page.title();
    const text = await page.evaluate(`
      (() => {
        const body = document.body;
        if (!body) return '';
        const scripts = body.querySelectorAll('script, style, noscript');
        scripts.forEach(s => s.remove());
        return body.innerText.substring(0, 8000);
      })()
    `) as string;

    await browser.close();
    return {
      success: true,
      output: `Title: ${title}\n\n${text}`,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return {
      success: false,
      output: '',
      error: `Browser navigation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function browserScreenshot(
  url: string,
  output: string,
  fullPage?: boolean
): Promise<ToolResult> {
  // browser_screenshot writes a file, and was the one write path in the tool
  // set that never went past the workspace boundary.
  const outputPath = resolve(output);
  if (!isInsideWorkspace(outputPath)) {
    return {
      success: false,
      output: '',
      error:
        `Refusing to save a screenshot outside the workspace root.\n` +
        `  output: ${outputPath}\n  workspace root: ${getWorkspaceRoot()}`,
    };
  }

  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });

    await page.screenshot({ path: outputPath, fullPage: fullPage ?? false });

    await browser.close();
    return {
      success: true,
      output: `Screenshot saved to ${outputPath}`,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return {
      success: false,
      output: '',
      error: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function browserExtract(
  url: string,
  selector: string,
  attribute?: string
): Promise<ToolResult> {
  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });

    const elements = await page.$$(selector);
    if (elements.length === 0) {
      await browser.close();
      return { success: true, output: `No elements found matching selector: ${selector}` };
    }

    const results: string[] = [];
    for (const el of elements.slice(0, 50)) {
      if (attribute) {
        const val = await el.getAttribute(attribute);
        if (val) results.push(val);
      } else {
        const text = await el.textContent();
        if (text?.trim()) results.push(text.trim());
      }
    }

    await browser.close();
    return {
      success: true,
      output: `Found ${elements.length} element(s):\n${results.join('\n')}`,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return {
      success: false,
      output: '',
      error: `Extract failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
