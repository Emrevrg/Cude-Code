import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// Type-only imports from src/ for compile-time checking.
// At runtime, dynamic imports load from dist/ (ESM, compiled CLI output).
import type { AppConfig } from '../src/config/index.js';
import type { Session } from '../src/storage/sessions.js';
import type { Message } from '../src/providers/types.js';

let mainWindow: BrowserWindow | null = null;
let abortController: AbortController | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#0d0d14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'hidden',
    show: false,
  });

  // __dirname is dist-electron/electron/, so go up two levels to project root
  const projectRoot = path.join(__dirname, '..', '..');
  const rendererDist = path.join(projectRoot, 'dist-renderer', 'index.html');
  const isDev = process.env.NODE_ENV === 'development' || !fs.existsSync(rendererDist);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(rendererDist);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  registerIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ── Window controls ──────────────────────────────────────────────────────────
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window:close', () => mainWindow?.close());

// Resolve the dist path relative to the project root at runtime
function distPath(rel: string): string {
  // __dirname = dist-electron/electron/
  const projectRoot = path.join(__dirname, '..', '..');
  return path.join(projectRoot, 'dist', rel);
}

function registerIpcHandlers(): void {
  registerConfigHandlers();
  registerSessionHandlers();
  registerBudgetHandlers();
  registerProviderHandlers();
  registerChatHandlers();
}

// ── Config handlers ──────────────────────────────────────────────────────────
function registerConfigHandlers(): void {
  ipcMain.handle('config:get', async () => {
    const { getConfig } = await import(distPath('config/index.js')) as typeof import('../src/config/index.js');
    const config = getConfig();
    return config.store;
  });

  ipcMain.handle('config:setKey', async (_event, provider: string, key: string) => {
    const { setApiKey } = await import(distPath('config/index.js')) as typeof import('../src/config/index.js');
    setApiKey(provider, key);
    return true;
  });

  ipcMain.handle('config:set', async (_event, key: keyof AppConfig, value: unknown) => {
    const { getConfig } = await import(distPath('config/index.js')) as typeof import('../src/config/index.js');
    const config = getConfig();
    config.set(key, value as never);
    return true;
  });
}

// ── Session handlers ─────────────────────────────────────────────────────────
function registerSessionHandlers(): void {
  ipcMain.handle('sessions:list', async () => {
    const { listSessions } = await import(distPath('storage/sessions.js')) as typeof import('../src/storage/sessions.js');
    return listSessions();
  });

  ipcMain.handle('sessions:create', async (_event, name?: string) => {
    const { createSession } = await import(distPath('storage/sessions.js')) as typeof import('../src/storage/sessions.js');
    const { getDefaultProvider, getDefaultModel } = await import(distPath('config/index.js')) as typeof import('../src/config/index.js');
    const provider = getDefaultProvider() ?? 'anthropic';
    const model = getDefaultModel() ?? 'claude-haiku-4-5';
    return createSession(name ?? `Chat ${new Date().toLocaleDateString()}`, provider, model);
  });

  ipcMain.handle('sessions:load', async (_event, id: string) => {
    const { loadSession } = await import(distPath('storage/sessions.js')) as typeof import('../src/storage/sessions.js');
    return loadSession(id);
  });

  ipcMain.handle('sessions:save', async (_event, session: Session) => {
    const { saveSession } = await import(distPath('storage/sessions.js')) as typeof import('../src/storage/sessions.js');
    saveSession(session);
    return true;
  });

  ipcMain.handle('sessions:delete', async (_event, id: string) => {
    const { deleteSession } = await import(distPath('storage/sessions.js')) as typeof import('../src/storage/sessions.js');
    return deleteSession(id);
  });

  ipcMain.handle('sessions:rename', async (_event, id: string, name: string) => {
    const { loadSession, saveSession } = await import(distPath('storage/sessions.js')) as typeof import('../src/storage/sessions.js');
    const session = loadSession(id);
    if (!session) return false;
    session.name = name;
    saveSession(session);
    return true;
  });
}

// ── Budget handlers ──────────────────────────────────────────────────────────
function registerBudgetHandlers(): void {
  ipcMain.handle('budget:status', async () => {
    const { loadBudget, getRemainingBudget } = await import(distPath('storage/budget.js')) as typeof import('../src/storage/budget.js');
    const budget = loadBudget();
    const remaining = getRemainingBudget();
    return { ...budget, remaining };
  });

  ipcMain.handle('budget:set', async (_event, amount: number, monthly?: boolean) => {
    const { setTotalLimit, setMonthlyLimit } = await import(distPath('storage/budget.js')) as typeof import('../src/storage/budget.js');
    if (monthly) {
      setMonthlyLimit(amount);
    } else {
      setTotalLimit(amount);
    }
    return true;
  });
}

// ── Provider handlers ────────────────────────────────────────────────────────
function registerProviderHandlers(): void {
  ipcMain.handle('providers:list', async () => {
    const { listProviders } = await import(distPath('providers/index.js')) as typeof import('../src/providers/index.js');
    const providers = listProviders();
    return providers.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      configured: p.isConfigured(),
      models: p.listModels(),
    }));
  });

  ipcMain.handle('providers:test', async (_event, name: string) => {
    const { getProvider } = await import(distPath('providers/index.js')) as typeof import('../src/providers/index.js');
    try {
      const provider = getProvider(name);
      const available = await provider.isAvailable();
      return { available };
    } catch (err) {
      return { available: false, error: String(err) };
    }
  });

  ipcMain.handle('providers:models', async (_event, name: string) => {
    const { getProvider } = await import(distPath('providers/index.js')) as typeof import('../src/providers/index.js');
    try {
      const provider = getProvider(name);
      return provider.listModels();
    } catch {
      return [];
    }
  });
}

// ── Chat handlers ────────────────────────────────────────────────────────────
function registerChatHandlers(): void {
  ipcMain.handle('chat:send', async (
    _event,
    sessionId: string,
    messages: Message[],
    options: { provider: string; model: string; systemPrompt?: string }
  ) => {
    const { getProvider } = await import(distPath('providers/index.js')) as typeof import('../src/providers/index.js');
    const { loadSession, saveSession, updateSessionCost } = await import(distPath('storage/sessions.js')) as typeof import('../src/storage/sessions.js');
    const { recordSpending } = await import(distPath('storage/budget.js')) as typeof import('../src/storage/budget.js');

    const provider = getProvider(options.provider);
    const response = await provider.chat(messages, options.model, {
      systemPrompt: options.systemPrompt,
    });

    const session = loadSession(sessionId);
    if (session) {
      updateSessionCost(session, response.cost, response.inputTokens, response.outputTokens);
      session.messages = messages.concat([{ role: 'assistant', content: response.content }]);
      saveSession(session);
      recordSpending(options.provider, options.model, response.cost, response.inputTokens, response.outputTokens, sessionId);
    }

    return response;
  });

  ipcMain.handle('chat:stream', async (
    event,
    channelId: string,
    sessionId: string,
    messages: Message[],
    options: { provider: string; model: string; systemPrompt?: string }
  ) => {
    const { getProvider } = await import(distPath('providers/index.js')) as typeof import('../src/providers/index.js');
    const { loadSession, saveSession, updateSessionCost } = await import(distPath('storage/sessions.js')) as typeof import('../src/storage/sessions.js');
    const { recordSpending } = await import(distPath('storage/budget.js')) as typeof import('../src/storage/budget.js');

    abortController = new AbortController();

    try {
      const provider = getProvider(options.provider);
      const response = await provider.streamChat(
        messages,
        options.model,
        { systemPrompt: options.systemPrompt },
        (chunk) => {
          if (abortController?.signal.aborted) return;
          event.sender.send(`chat:chunk:${channelId}`, chunk);
        }
      );

      const session = loadSession(sessionId);
      if (session) {
        updateSessionCost(session, response.cost, response.inputTokens, response.outputTokens);
        session.messages = messages.concat([{ role: 'assistant', content: response.content }]);
        saveSession(session);
        recordSpending(options.provider, options.model, response.cost, response.inputTokens, response.outputTokens, sessionId);
      }

      event.sender.send(`chat:done:${channelId}`, response);
      return response;
    } catch (err) {
      if (!abortController?.signal.aborted) {
        event.sender.send(`chat:error:${channelId}`, { message: String(err) });
      }
      throw err;
    } finally {
      abortController = null;
    }
  });

  ipcMain.handle('chat:stop', () => {
    abortController?.abort();
    return true;
  });
}
