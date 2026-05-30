import { contextBridge, ipcRenderer } from 'electron';

let streamCounter = 0;

contextBridge.exposeInMainWorld('codiente', {
  chat: {
    send: (
      sessionId: string,
      messages: unknown[],
      options: { provider: string; model: string; systemPrompt?: string }
    ) => ipcRenderer.invoke('chat:send', sessionId, messages, options),

    stream: (
      sessionId: string,
      messages: unknown[],
      options: { provider: string; model: string; systemPrompt?: string },
      onChunk: (chunk: { text: string; done: boolean; inputTokens?: number; outputTokens?: number }) => void,
      onDone: (response: unknown) => void,
      onError: (err: { message: string }) => void
    ): string => {
      const channelId = `stream_${++streamCounter}_${Date.now()}`;

      const chunkHandler = (_: Electron.IpcRendererEvent, chunk: unknown) => onChunk(chunk as { text: string; done: boolean });
      const doneHandler = (_: Electron.IpcRendererEvent, response: unknown) => {
        cleanup();
        onDone(response);
      };
      const errorHandler = (_: Electron.IpcRendererEvent, err: unknown) => {
        cleanup();
        onError(err as { message: string });
      };

      const cleanup = () => {
        ipcRenderer.removeListener(`chat:chunk:${channelId}`, chunkHandler);
        ipcRenderer.removeListener(`chat:done:${channelId}`, doneHandler);
        ipcRenderer.removeListener(`chat:error:${channelId}`, errorHandler);
      };

      ipcRenderer.on(`chat:chunk:${channelId}`, chunkHandler);
      ipcRenderer.on(`chat:done:${channelId}`, doneHandler);
      ipcRenderer.on(`chat:error:${channelId}`, errorHandler);

      ipcRenderer.invoke('chat:stream', channelId, sessionId, messages, options);

      return channelId;
    },

    stop: () => ipcRenderer.invoke('chat:stop'),
  },

  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    create: (name?: string) => ipcRenderer.invoke('sessions:create', name),
    load: (id: string) => ipcRenderer.invoke('sessions:load', id),
    save: (session: unknown) => ipcRenderer.invoke('sessions:save', session),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    rename: (id: string, name: string) => ipcRenderer.invoke('sessions:rename', id, name),
  },

  config: {
    get: () => ipcRenderer.invoke('config:get'),
    setKey: (provider: string, key: string) => ipcRenderer.invoke('config:setKey', provider, key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('config:set', key, value),
  },

  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    test: (name: string) => ipcRenderer.invoke('providers:test', name),
    models: (name: string) => ipcRenderer.invoke('providers:models', name),
  },

  budget: {
    status: () => ipcRenderer.invoke('budget:status'),
    set: (amount: number, monthly?: boolean) => ipcRenderer.invoke('budget:set', amount, monthly),
  },

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
});
