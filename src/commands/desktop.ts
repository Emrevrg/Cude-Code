import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Desktop app stores electron + built renderer in ~/.cude/desktop/
const DESKTOP_DIR  = path.join(homedir(), '.cude', 'desktop');
const ELECTRON_PKG = path.join(DESKTOP_DIR, 'node_modules', '.bin', 'electron');
const MAIN_JS      = path.join(DESKTOP_DIR, 'dist-electron', 'electron', 'main.js');
const RENDERER_DIR = path.join(DESKTOP_DIR, 'dist-renderer');

export async function desktopCommand(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // dist/commands/desktop.js → dist → project root
  const root = path.resolve(__dirname, '..', '..');

  // ── 1. Try packaged binary in dist-packages/ (built with electron-builder) ──
  const packedDir = path.join(root, 'dist-packages');
  const packedApp = findPackagedApp(packedDir);
  if (packedApp) {
    launch([packedApp], [], root);
    printLaunched();
    return;
  }

  // ── 2. Check if electron is available in project root (source install) ──────
  const localElectron = findElectron(root);
  const localMain     = path.join(root, 'dist-electron', 'electron', 'main.js');
  const localRenderer = path.join(root, 'dist-renderer', 'index.html');

  if (localElectron && fs.existsSync(localMain) && fs.existsSync(localRenderer)) {
    launch([localElectron, localMain], [], root);
    printLaunched();
    return;
  }

  // ── 3. Source install but not built yet — auto-build ─────────────────────────
  if (localElectron && !fs.existsSync(localMain)) {
    console.log();
    console.log(chalk.hex('#7c3aed')('  ◈ Codiente Desktop') + chalk.dim(' — ilk kez derleniyor...'));
    console.log(chalk.dim('  (~30 saniye sürebilir, yalnızca bir kez yapılır)'));
    console.log();
    try {
      execSync('npm run build:electron', { stdio: 'inherit', cwd: root });
      if (!fs.existsSync(path.join(root, 'renderer', 'node_modules'))) {
        execSync('npm install', { stdio: 'inherit', cwd: path.join(root, 'renderer') });
      }
      execSync('npm run build:renderer', { stdio: 'inherit', cwd: root });
      console.log(chalk.green('\n  ✓ Desktop derlendi'));
    } catch {
      console.error(chalk.red('\n  ✗ Derleme başarısız — yukarıdaki çıktıyı kontrol edin.'));
      process.exit(1);
    }
    const builtElectron = findElectron(root);
    if (builtElectron) {
      launch([builtElectron, localMain], [], root);
      printLaunched();
    }
    return;
  }

  // ── 4. Global npm install — install desktop dependencies to ~/.cude/desktop ─
  await installDesktopDeps();
}

async function installDesktopDeps(): Promise<void> {
  console.log();
  console.log(chalk.hex('#7c3aed')('  ◈ Codiente Desktop'));
  console.log(chalk.dim('  Masaüstü uygulaması için bileşenler kuruluyor...'));
  console.log(chalk.dim('  (~2-3 dakika, yalnızca bir kez yapılır)'));
  console.log();

  // Ensure dir exists
  fs.mkdirSync(DESKTOP_DIR, { recursive: true });

  // Get the source directory for electron and renderer
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, '..', '..');

  // Step 1: Install electron locally to ~/.cude/desktop/
  const electronPkg = path.join(DESKTOP_DIR, 'package.json');
  if (!fs.existsSync(electronPkg)) {
    fs.writeFileSync(electronPkg, JSON.stringify({ name: 'cude-desktop', version: '1.0.0', private: true }));
  }

  process.stdout.write(chalk.dim('  [1/3] electron kurulumu... '));
  try {
    await execAsync('npm install electron --save-exact --no-audit --no-fund --loglevel error', {
      cwd: DESKTOP_DIR, timeout: 120_000,
    });
    process.stdout.write(chalk.green('✓\n'));
  } catch (err) {
    process.stdout.write(chalk.red('✗\n'));
    console.error(chalk.red(`\n  Electron kurulum hatası: ${err instanceof Error ? err.message : String(err)}`));
    console.error(chalk.dim('\n  Kaynak koddan kurulum için: git clone && npm install && cude desktop'));
    process.exit(1);
  }

  // Step 2: Copy electron source + dist from package root
  process.stdout.write(chalk.dim('  [2/3] Electron derlemesi...  '));
  try {
    const electronSrc  = path.join(root, 'electron');
    const tsconfig     = path.join(root, 'tsconfig.electron.json');
    const destElectron = path.join(DESKTOP_DIR, 'electron');
    const destTsc      = path.join(DESKTOP_DIR, 'tsconfig.electron.json');

    // Copy electron source
    copyDirSync(electronSrc, destElectron);
    if (fs.existsSync(tsconfig)) fs.copyFileSync(tsconfig, destTsc);

    // Copy src/ (needed by electron main's dynamic imports at runtime)
    // The electron main imports from dist/ at runtime — copy pre-built dist if available
    const distSrc  = path.join(root, 'dist');
    const distDest = path.join(DESKTOP_DIR, 'dist');
    if (fs.existsSync(distSrc)) {
      copyDirSync(distSrc, distDest);
    }

    // Install typescript locally to compile electron main
    await execAsync('npm install typescript --save-exact --no-audit --no-fund --loglevel error', {
      cwd: DESKTOP_DIR, timeout: 60_000,
    });

    // Compile electron main.ts
    const tscBin = path.join(DESKTOP_DIR, 'node_modules', '.bin', 'tsc');
    await execAsync(`"${tscBin}" -p "${destTsc}" --outDir "${path.join(DESKTOP_DIR, 'dist-electron')}"`, {
      cwd: DESKTOP_DIR, timeout: 30_000,
    });
    process.stdout.write(chalk.green('✓\n'));
  } catch (err) {
    process.stdout.write(chalk.red('✗\n'));
    console.error(chalk.red(`\n  Derleme hatası: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  // Step 3: Build renderer
  process.stdout.write(chalk.dim('  [3/3] Arayüz derleniyor...   '));
  try {
    const rendererSrc  = path.join(root, 'renderer');
    const rendererDest = path.join(DESKTOP_DIR, 'renderer');

    if (!fs.existsSync(rendererDest)) {
      copyDirSync(rendererSrc, rendererDest);
    }

    // Install renderer deps
    await execAsync('npm install --no-audit --no-fund --loglevel error', {
      cwd: rendererDest, timeout: 120_000,
    });

    // Build renderer
    await execAsync('npm run build', {
      cwd: rendererDest, timeout: 120_000,
      env: { ...process.env, VITE_OUT_DIR: path.join(DESKTOP_DIR, 'dist-renderer') },
    });

    // If vite output went to renderer/dist, move it
    const viteDist = path.join(rendererDest, 'dist');
    if (fs.existsSync(viteDist) && !fs.existsSync(RENDERER_DIR)) {
      copyDirSync(viteDist, RENDERER_DIR);
    }

    process.stdout.write(chalk.green('✓\n'));
  } catch (err) {
    process.stdout.write(chalk.red('✗\n'));
    console.error(chalk.red(`\n  Renderer hatası: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  console.log(chalk.green('\n  ✓ Masaüstü uygulaması hazır!'));

  // Launch
  const electronBin = findElectron(DESKTOP_DIR);
  const mainJs = path.join(DESKTOP_DIR, 'dist-electron', 'electron', 'main.js');

  if (!electronBin || !fs.existsSync(mainJs)) {
    console.error(chalk.red('\n  ✗ Başlatma başarısız.'));
    process.exit(1);
  }

  launch([electronBin, mainJs], [], DESKTOP_DIR);
  printLaunched();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findElectron(root: string): string | null {
  const candidates = [
    path.join(root, 'node_modules', '.bin', 'electron'),
    path.join(root, 'node_modules', '.bin', 'electron.cmd'),
  ];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

function findPackagedApp(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir);
  const match = entries.find(e => {
    if (e.endsWith('.AppImage') || e.endsWith('.exe') || e.endsWith('.app')) return true;
    const st = fs.statSync(path.join(dir, e));
    return !st.isDirectory() && (st.mode & 0o111) !== 0;
  });
  return match ? path.join(dir, match) : null;
}

function copyDirSync(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    if (fs.statSync(s).isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function launch(cmd: string[], args: string[], cwd: string): void {
  const [bin, ...rest] = cmd;
  spawn(bin, [...rest, ...args], { detached: true, stdio: 'ignore', cwd }).unref();
}

function printLaunched(): void {
  console.log();
  console.log(chalk.hex('#7c3aed')('  ◈ Codiente Desktop') + chalk.dim(' başlatılıyor...'));
  console.log(chalk.dim('  Uygulama birkaç saniye içinde açılacak.'));
  console.log(chalk.dim('  Config: ') + chalk.hex('#06b6d4')('~/.cude/'));
  console.log();
}
