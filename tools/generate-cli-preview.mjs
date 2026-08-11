import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SP = process.argv[2] ?? fileURLToPath(new URL('../assets', import.meta.url));
const DISPLAY = fileURLToPath(new URL('../dist/ui/display.js', import.meta.url));

// Capture the real banner through a PTY so chalk/gradient-string emit 24-bit
// colour — i.e. exactly the bytes a user's terminal receives.
const raw = execSync(
  `script -qec "node -e \\"import('${DISPLAY}').then(m => m.showBanner())\\"" /dev/null`,
  { encoding: 'utf8', env: { ...process.env, COLORTERM: 'truecolor', TERM: 'xterm-256color' } }
).replace(/\r/g, '');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Minimal ANSI -> HTML, honouring 24-bit foreground colour, bold and dim.
function ansiToHtml(input) {
  let out = '';
  let open = false;
  let color = null;
  let bold = false;
  let dim = false;

  const flush = () => {
    if (open) { out += '</span>'; open = false; }
  };
  const start = () => {
    const styles = [];
    if (color) styles.push(`color:${color}`);
    if (bold) styles.push('font-weight:700');
    if (dim) styles.push('opacity:.55');
    if (styles.length) { out += `<span style="${styles.join(';')}">`; open = true; }
  };

  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) { flush(); start(); out += esc(input.slice(last, m.index)); }
    last = re.lastIndex;

    const parts = m[1].split(';').map(Number);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p === 0) { color = null; bold = false; dim = false; }
      else if (p === 1) bold = true;
      else if (p === 2) dim = true;
      else if (p === 22) { bold = false; dim = false; }
      else if (p === 39) color = null;
      else if (p === 38 && parts[i + 1] === 2) {
        const [r, g, b] = [parts[i + 2], parts[i + 3], parts[i + 4]];
        color = `rgb(${r},${g},${b})`;
        i += 4;
      }
    }
  }
  flush();
  if (last < input.length) { start(); out += esc(input.slice(last)); flush(); }
  return out;
}

const body = ansiToHtml(raw).replace(/\n$/, '');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:44px;background:#12121c;display:flex;justify-content:center;
 font-family:'DejaVu Sans Mono','JetBrains Mono','Fira Code',monospace}
.term{background:#0a0a0f;border-radius:12px;width:660px;overflow:hidden;
 box-shadow:0 24px 70px rgba(0,0,0,.7),0 0 60px rgba(99,102,241,.10);
 border:1px solid #1d1d2a}
.bar{background:#16161f;padding:12px 16px;display:flex;align-items:center;gap:8px;
 border-bottom:1px solid #1d1d2a}
.d{width:12px;height:12px;border-radius:50%}
.t{flex:1;text-align:center;color:#5a5a6a;font-size:12.5px;margin-right:52px;
 font-family:Inter,system-ui,sans-serif}
.body{padding:18px 24px 22px;font-size:14px;line-height:1.36;letter-spacing:.2px;color:#c9c9d6}
.p{margin-bottom:8px}
pre{margin:0;font:inherit;white-space:pre}
</style></head><body>
<div class="term">
 <div class="bar">
  <div class="d" style="background:#ff5f56"></div>
  <div class="d" style="background:#ffbd2e"></div>
  <div class="d" style="background:#27c93f"></div>
  <div class="t">cude-code — zsh</div>
 </div>
 <div class="body">
  <div class="p"><span style="color:#6366f1;font-weight:700">❯</span> <span style="color:#e6e6f0">cude chat</span></div>
  <pre>${body}</pre>
 </div>
</div>
</body></html>`;

writeFileSync(`${SP}/preview.html`, html);
console.log('wrote preview.html');
