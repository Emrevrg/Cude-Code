import { useState, useEffect, useCallback } from 'react';
import type { AppConfig } from '../types/ipc';

export function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const cfg = await window.codiente.config.get();
      setConfig(cfg);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const setApiKey = useCallback(async (provider: string, key: string) => {
    await window.codiente.config.setKey(provider, key);
    await fetchConfig();
  }, [fetchConfig]);

  const setSetting = useCallback(async (key: string, value: unknown) => {
    await window.codiente.config.set(key, value);
    await fetchConfig();
  }, [fetchConfig]);

  return { config, loading, error, setApiKey, setSetting, refresh: fetchConfig };
}
