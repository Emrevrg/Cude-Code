import { useState, useEffect, useCallback } from 'react';
import type { Session } from '../types/ipc';

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSessionState] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true);
      const list = await window.codiente.sessions.list();
      setSessions(list);
      // If active session exists, refresh it from the list
      setActiveSessionState(prev => {
        if (!prev) return prev;
        const updated = list.find(s => s.id === prev.id);
        return updated ?? prev;
      });
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const createSession = useCallback(async (name?: string): Promise<Session | null> => {
    try {
      const session = await window.codiente.sessions.create(name);
      await fetchSessions();
      return session;
    } catch (err) {
      console.error('Failed to create session:', err);
      return null;
    }
  }, [fetchSessions]);

  const deleteSession = useCallback(async (id: string) => {
    try {
      await window.codiente.sessions.delete(id);
      setActiveSessionState(prev => prev?.id === id ? null : prev);
      await fetchSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }, [fetchSessions]);

  const renameSession = useCallback(async (id: string, name: string) => {
    try {
      await window.codiente.sessions.rename(id, name);
      setActiveSessionState(prev => prev?.id === id ? { ...prev, name } : prev);
      await fetchSessions();
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
  }, [fetchSessions]);

  const setActiveSession = useCallback((session: Session | null) => {
    setActiveSessionState(session);
  }, []);

  return {
    sessions,
    activeSession,
    loading,
    setActiveSession,
    createSession,
    deleteSession,
    renameSession,
    refreshSessions: fetchSessions,
  };
}
