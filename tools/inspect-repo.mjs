// Loads the live GitHub repo page in Chromium and reports what a visitor sees:
// description, topics, the files GitHub surfaces, and whether the README
// rendered. Images are blocked by this sandbox's proxy, so it reports which
// README images failed to load separately from the page content itself.
//
// Description and topics come from the API, not the DOM. Scraping them was
// worse than useless: GitHub's sidebar markup changed, the old selectors
// matched nothing, and this reported "(not set)" for a description that was
// in fact set — a silent wrong answer rather than a visible failure.

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

// The API is authoritative for repository metadata; the rendered page is not.
const slug = new URL(url).pathname.replace(/^\/|\/$/g, '');
const api = await fetch(`https://api.github.com/repos/${slug}`, {
  headers: {
    accept: 'application/vnd.github+json',
    ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  },
}).then((r) => (r.ok ? r.json() : null)).catch(() => null);

if (api) {
  const desc = api.description?.trim();
  console.log('Description :', desc ? JSON.stringify(desc) : '(not set)');
  console.log('Topics      :', api.topics?.length ? api.topics.join(', ') : '(none set)');
} else {
  console.log('Description : (API unreachable — not scraping, it reports wrong answers)');
  console.log('Topics      : (API unreachable)');
}
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
