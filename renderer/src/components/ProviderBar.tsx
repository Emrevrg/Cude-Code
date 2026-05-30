import React, { useState, useEffect, useRef } from 'react';
import type { ProviderInfo, Session } from '../types/ipc';
import BudgetIndicator from './BudgetIndicator';

interface ProviderBarProps {
  session: Session;
  providers: ProviderInfo[];
  selectedProvider: string;
  selectedModel: string;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
  onSessionRename: (name: string) => void;
}

export default function ProviderBar({
  session,
  providers,
  selectedProvider,
  selectedModel,
  onProviderChange,
  onModelChange,
  onSessionRename,
}: ProviderBarProps) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(session.name);
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNameValue(session.name);
  }, [session.name]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowProviderDropdown(false);
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentProvider = providers.find(p => p.name === selectedProvider);
  const availableModels = currentProvider?.models ?? [];

  const handleNameSubmit = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== session.name) {
      onSessionRename(trimmed);
    } else {
      setNameValue(session.name);
    }
    setEditingName(false);
  };

  const configuredProviders = providers.filter(p => p.configured);

  return (
    <div
      className="drag-region flex items-center justify-between px-4"
      style={{
        height: 48,
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        flexShrink: 0,
      }}
    >
      {/* Left: provider + model breadcrumb */}
      <div ref={dropdownRef} className="no-drag flex items-center gap-2 relative">
        {/* Provider selector */}
        <div className="relative">
          <button
            onClick={() => {
              setShowProviderDropdown(v => !v);
              setShowModelDropdown(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: 12,
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--border-light)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <ProviderDot configured={currentProvider?.configured ?? false} />
            {currentProvider?.displayName ?? selectedProvider}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {showProviderDropdown && (
            <div
              className="animate-scale-in"
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                zIndex: 100,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-md)',
                padding: '4px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                minWidth: 180,
              }}
            >
              {configuredProviders.length === 0 ? (
                <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
                  No providers configured
                </div>
              ) : (
                configuredProviders.map(p => (
                  <DropdownItem
                    key={p.name}
                    active={p.name === selectedProvider}
                    onClick={() => {
                      onProviderChange(p.name);
                      const firstModel = p.models[0]?.id;
                      if (firstModel) onModelChange(firstModel);
                      setShowProviderDropdown(false);
                    }}
                  >
                    <ProviderDot configured={p.configured} />
                    {p.displayName}
                  </DropdownItem>
                ))
              )}
            </div>
          )}
        </div>

        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>›</span>

        {/* Model selector */}
        <div className="relative">
          <button
            onClick={() => {
              setShowModelDropdown(v => !v);
              setShowProviderDropdown(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: 12,
              transition: 'all 0.12s',
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--border-light)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            {availableModels.find(m => m.id === selectedModel)?.name ?? selectedModel}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {showModelDropdown && availableModels.length > 0 && (
            <div
              className="animate-scale-in"
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                zIndex: 100,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-md)',
                padding: '4px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                minWidth: 240,
                maxHeight: 320,
                overflowY: 'auto',
              }}
            >
              {availableModels.map(m => (
                <DropdownItem
                  key={m.id}
                  active={m.id === selectedModel}
                  onClick={() => {
                    onModelChange(m.id);
                    setShowModelDropdown(false);
                  }}
                >
                  <span style={{ flex: 1 }}>{m.name}</span>
                  {m.free && (
                    <span style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      color: 'var(--success)',
                      fontSize: 10,
                      padding: '1px 5px',
                      borderRadius: 4,
                    }}>
                      free
                    </span>
                  )}
                </DropdownItem>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Center: session name */}
      <div className="no-drag flex-1 flex justify-center px-4">
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={e => {
              if (e.key === 'Enter') handleNameSubmit();
              if (e.key === 'Escape') { setNameValue(session.name); setEditingName(false); }
            }}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--accent-1)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 10px',
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
              textAlign: 'center',
              maxWidth: 280,
            }}
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: 500,
              padding: '3px 8px',
              borderRadius: 'var(--radius-sm)',
              transition: 'color 0.12s',
              maxWidth: 280,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
            title="Click to rename"
          >
            {session.name}
          </button>
        )}
      </div>

      {/* Right: budget indicator */}
      <div className="no-drag">
        <BudgetIndicator sessionCost={session.totalCost} />
      </div>
    </div>
  );
}

function ProviderDot({ configured }: { configured: boolean }) {
  return (
    <div
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: configured ? 'var(--success)' : 'var(--text-muted)',
        flexShrink: 0,
      }}
    />
  );
}

function DropdownItem({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        padding: '7px 10px',
        background: active ? 'rgba(124, 58, 237, 0.12)' : 'transparent',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        color: active ? 'var(--accent-1)' : 'var(--text-primary)',
        fontSize: 12,
        textAlign: 'left',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => {
        if (!active) e.currentTarget.style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={e => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}
