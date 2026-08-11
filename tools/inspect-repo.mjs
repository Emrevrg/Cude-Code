// Loads the live GitHub repo page in Chromium and reports what a visitor sees:
// description, topics, the files GitHub surfaces, and whether the README
// rendered. Images are blocked by this sandbox's proxy, so it reports which
// README images failed to load separately from the page content itself.

import { launchChromium } from './chromium.mjs';

const url = process.argv[2] ?? 'https://github.com/Emrevrg/Cude-Code';

const browser = await launchChromium({ args: ['--ignore-certificate-errors'] });
const page = await browser.newPage({
  viewport: { width: 1280, height: 1600 },
  ignoreHTTPSErrors: true,
});

const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('HTTP', resp?.status(), '\n');
await page.waitForTimeout(3000);

const info = await page.evaluate(`
  (() => {
    const t = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const readme = document.querySelector('article.markdown-body');
    return {
      description: t('[data-testid="repository-description"], .f4.my-3'),
      topics: Array.from(document.querySelectorAll('a.topic-tag')).map(a => a.textContent.trim()),
      files: Array.from(document.querySelectorAll('a[href*="/blob/"], a[href*="/tree/"]'))
        .map(a => a.textContent.trim()).filter(Boolean),
      readmeHeadings: readme
        ? Array.from(readme.querySelectorAll('h1,h2')).map(h => h.textContent.replace(/^\\s*/, '').trim())
        : [],
      readmeImages: readme
        ? Array.from(readme.querySelectorAll('img')).map(i => ({
            alt: i.alt, loaded: i.complete && i.naturalWidth > 0,
          }))
        : [],
      about: t('.BorderGrid-cell h2')
        ? Array.from(document.querySelectorAll('.BorderGrid-cell')).map(c => c.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120))
        : [],
    };
  })()
`);

console.log('Description :', info.description ?? '(not set)');
console.log('Topics      :', info.topics.length ? info.topics.join(', ') : '(none set)');
console.log('\nFiles GitHub lists:');
console.log(' ', [...new Set(info.files)].filter(f => !f.includes('\n')).join('  '));
console.log('\nREADME headings rendered:', info.readmeHeadings.length);
info.readmeHeadings.slice(0, 12).forEach((h) => console.log('  -', h));
console.log('\nREADME images:');
for (const i of info.readmeImages) {
  console.log(`  ${i.loaded ? 'loaded' : 'blocked'}  ${i.alt || '(no alt)'}`);
}

await page.screenshot({ path: process.argv[3] ?? '/tmp/repo.png', fullPage: false });
await browser.close();
