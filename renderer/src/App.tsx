import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsModal from './components/SettingsModal';
import WelcomeScreen from './components/WelcomeScreen';
import { useConfig } from './hooks/useConfig';
import { useSessions } from './hooks/useSessions';
import type { Session } from './types/ipc';

export default function App() {
  const { config, loading: configLoading } = useConfig();
  const { sessions, activeSession, setActiveSession, createSession, deleteSession, renameSession, refreshSessions } = useSessions();
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Show welcome/setup screen if no provider is configured
  const hasProvider = config && (
    config.defaultProvider ||
    config.apiKeys?.anthropic ||
    config.apiKeys?.openai ||
    config.apiKeys?.gemini ||
    config.apiKeys?.groq
  );

  const handleNewChat = async (prompt?: string) => {
    const session = await createSession();
    if (session) {
      setActiveSession(session);
      // If a prompt was provided (from welcome screen), it will be handled by ChatArea
      if (prompt) {
        // Store the initial prompt so ChatArea can pick it up
        sessionStorage.setItem('initialPrompt', prompt);
      }
    }
  };

  const handleSessionSelect = (session: Session) => {
    setActiveSession(session);
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center w-full h-full" style={{ background: 'var(--bg-primary)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="gradient-text text-2xl font-bold">✦ Codiente</div>
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full h-full overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* Sidebar */}
      <Sidebar
        sessions={sessions}
        activeSession={activeSession}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(v => !v)}
        onNewChat={handleNewChat}
        onSessionSelect={handleSessionSelect}
        onSessionDelete={deleteSession}
        onSessionRename={renameSession}
        onSettingsOpen={() => setShowSettings(true)}
      />

      {/* Main area */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {!hasProvider ? (
          <WelcomeScreen onSetupClick={() => setShowSettings(true)} />
        ) : activeSession ? (
          <ChatArea
            session={activeSession}
            onSessionUpdate={(updated) => {
              setActiveSession(updated);
              refreshSessions();
            }}
          />
        ) : (
          <WelcomeScreen
            onNewChat={handleNewChat}
            onSetupClick={() => setShowSettings(true)}
          />
        )}
      </div>

      {/* Settings modal */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
