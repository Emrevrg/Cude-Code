import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Session, ProviderInfo } from '../types/ipc';
import { useChat } from '../hooks/useChat';
import MessageBubble from './MessageBubble';
import StreamingMessage from './StreamingMessage';
import InputBar from './InputBar';
import ProviderBar from './ProviderBar';

interface ChatAreaProps {
  session: Session;
  onSessionUpdate: (session: Session) => void;
}

export default function ChatArea({ session, onSessionUpdate }: ChatAreaProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState(session.provider || '');
  const [selectedModel, setSelectedModel] = useState(session.model || '');
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevSessionIdRef = useRef<string>(session.id);

  const {
    messages,
    streaming,
    streamingContent,
    error,
    sendMessage,
    stopStreaming,
    clearError,
    syncMessages,
  } = useChat({ session, onSessionUpdate });

  // Load providers
  useEffect(() => {
    window.codiente.providers.list().then(list => {
      setProviders(list);
      // Set defaults if not set
      if (!selectedProvider || !list.find(p => p.name === selectedProvider)) {
        const configured = list.find(p => p.configured);
        if (configured) {
          setSelectedProvider(configured.name);
          const firstModel = configured.models[0]?.id;
          if (firstModel) setSelectedModel(firstModel);
        }
      }
    }).catch(() => {});
  }, []);

  // Sync messages when session changes
  useEffect(() => {
    if (session.id !== prevSessionIdRef.current) {
      prevSessionIdRef.current = session.id;
      syncMessages(session);
      setSelectedProvider(session.provider || selectedProvider);
      setSelectedModel(session.model || selectedModel);
    }
  }, [session.id, session, syncMessages, selectedProvider, selectedModel]);

  // Check for initial prompt from session storage (from welcome screen)
  useEffect(() => {
    const initialPrompt = sessionStorage.getItem('initialPrompt');
    if (initialPrompt) {
      sessionStorage.removeItem('initialPrompt');
      setInputValue(initialPrompt);
    }
  }, [session.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || streaming) return;
    const content = inputValue;
    setInputValue('');

    // Determine provider and model
    const provider = selectedProvider || session.provider;
    const model = selectedModel || session.model;

    if (!provider || !model) {
      return;
    }

    await sendMessage(content, provider, model);
  }, [inputValue, streaming, selectedProvider, selectedModel, session, sendMessage]);

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    const p = providers.find(pp => pp.name === provider);
    if (p && p.models.length > 0) {
      setSelectedModel(p.models[0].id);
    }
  };

  const handleSessionRename = async (name: string) => {
    await window.codiente.sessions.rename(session.id, name);
    onSessionUpdate({ ...session, name });
  };

  const isSetup = providers.some(p => p.configured);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* Provider bar */}
      <ProviderBar
        session={session}
        providers={providers}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onProviderChange={handleProviderChange}
        onModelChange={setSelectedModel}
        onSessionRename={handleSessionRename}
      />

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 24px 8px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ maxWidth: 800, width: '100%', margin: '0 auto', flex: 1 }}>
          {messages.length === 0 && !streaming ? (
            <EmptySessionState
              provider={selectedProvider}
              model={selectedModel}
              hasProviders={isSetup}
            />
          ) : (
            messages.map((msg, i) => (
              <MessageBubble key={i} message={msg} />
            ))
          )}

          {/* Streaming message */}
          {streaming && streamingContent && (
            <StreamingMessage content={streamingContent} />
          )}

          {/* Thinking indicator (streaming with no content yet) */}
          {streaming && !streamingContent && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 16 }}>
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '18px 18px 18px 4px',
                  padding: '12px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--text-muted)',
                      animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div
              className="animate-slide-up"
              style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--error)', fontSize: 13, fontWeight: 500, marginBottom: 2 }}>Error</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{error}</div>
              </div>
              <button
                onClick={clearError}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: 18,
                  lineHeight: 1,
                  padding: '0 4px',
                }}
              >
                ×
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input bar */}
      <div style={{ maxWidth: 800, width: '100%', margin: '0 auto', alignSelf: 'stretch' }}>
        <InputBar
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          onStop={stopStreaming}
          streaming={streaming}
          disabled={!isSetup}
          placeholder={
            !isSetup
              ? 'Configure a provider in Settings to start chatting...'
              : `Message ${providers.find(p => p.name === selectedProvider)?.displayName ?? 'AI'}...`
          }
        />
      </div>
    </div>
  );
}

function EmptySessionState({
  provider,
  model,
  hasProviders,
}: {
  provider: string;
  model: string;
  hasProviders: boolean;
}) {
  if (!hasProviders) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔑</div>
        <div style={{ fontSize: 15, color: 'var(--text-secondary)', marginBottom: 8 }}>No provider configured</div>
        <div style={{ fontSize: 13 }}>Open Settings to add your API keys</div>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div className="gradient-text" style={{ fontSize: 36, fontWeight: 700, marginBottom: 8 }}>✦</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 15, marginBottom: 4 }}>Start a conversation</div>
      {provider && model && (
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Using {provider} · {model}
        </div>
      )}
    </div>
  );
}
