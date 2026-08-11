import { chromium } from 'playwright';

const [, , url, out, w, h] = process.argv;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
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
