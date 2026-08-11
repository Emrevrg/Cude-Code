import { chromium } from 'playwright';

const [, , url, out, w, h] = process.argv;
const EXE = process.env.CUDE_CHROME_PATH || undefined;

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 2,
});
await page.goto(url);
await page.waitForTimeout(400);
await page.screenshot({ path: out });
await browser.close();
console.log('saved ' + out);
