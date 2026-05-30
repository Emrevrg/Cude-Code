import React, { useState } from 'react';
import type { Session } from '../types/ipc';

interface SidebarProps {
  sessions: Session[];
  activeSession: Session | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNewChat: () => void;
  onSessionSelect: (session: Session) => void;
  onSessionDelete: (id: string) => void;
  onSessionRename: (id: string, name: string) => void;
  onSettingsOpen: () => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Sidebar({
  sessions,
  activeSession,
  collapsed,
  onToggleCollapse,
  onNewChat,
  onSessionSelect,
  onSessionDelete,
  onSessionRename,
  onSettingsOpen,
}: SidebarProps) {
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  const handleRenameStart = (session: Session) => {
    setRenamingId(session.id);
    setRenameValue(session.name);
    setContextMenu(null);
  };

  const handleRenameSubmit = (id: string) => {
    if (renameValue.trim()) {
      onSessionRename(id, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  };

  const handleDeleteClick = (id: string) => {
    onSessionDelete(id);
    setContextMenu(null);
  };

  const dismissContextMenu = () => setContextMenu(null);

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center py-4 gap-3 border-r"
        style={{
          width: 56,
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border)',
          flexShrink: 0,
        }}
      >
        {/* Drag region at top */}
        <div className="drag-region" style={{ height: 32, width: '100%' }} />

        <button
          className="no-drag gradient-btn flex items-center justify-center"
          style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)' }}
          onClick={onNewChat}
          title="New Chat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        <button
          className="no-drag flex items-center justify-center"
          style={{
            width: 36, height: 36,
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'color 0.15s',
          }}
          onClick={onToggleCollapse}
          title="Expand Sidebar"
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>

        <div className="flex-1" />

        <button
          className="no-drag flex items-center justify-center"
          style={{
            width: 36, height: 36,
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'color 0.15s',
          }}
          onClick={onSettingsOpen}
          title="Settings"
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        className="flex flex-col border-r"
        style={{
          width: 260,
          flexShrink: 0,
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border)',
          userSelect: 'none',
        }}
        onClick={dismissContextMenu}
      >
        {/* Header: drag region + logo + window controls */}
        <div
          className="drag-region flex items-center justify-between px-4"
          style={{
            height: 52,
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="gradient-text font-bold text-lg tracking-tight">✦ Codiente</span>
          </div>
          <div className="no-drag flex items-center gap-1.5">
            {/* Window controls */}
            <button
              className="window-btn"
              style={windowBtnStyle('#ef4444')}
              onClick={() => window.codiente.window.close()}
              title="Close"
            />
            <button
              className="window-btn"
              style={windowBtnStyle('#f59e0b')}
              onClick={() => window.codiente.window.minimize()}
              title="Minimize"
            />
            <button
              className="window-btn"
              style={windowBtnStyle('#10b981')}
              onClick={() => window.codiente.window.maximize()}
              title="Maximize"
            />
          </div>
        </div>

        {/* New Chat button */}
        <div className="px-3 py-3" style={{ flexShrink: 0 }}>
          <button
            className="gradient-btn no-drag w-full flex items-center justify-center gap-2 font-medium"
            style={{ height: 40, borderRadius: 'var(--radius-xl)', fontSize: 14 }}
            onClick={onNewChat}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-muted)' }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No chats yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {sessions.map(session => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={activeSession?.id === session.id}
                  isRenaming={renamingId === session.id}
                  renameValue={renameValue}
                  onRenameChange={setRenameValue}
                  onRenameSubmit={() => handleRenameSubmit(session.id)}
                  onClick={() => onSessionSelect(session)}
                  onContextMenu={(e) => handleContextMenu(e, session.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <button
            className="no-drag flex items-center gap-2 text-sm"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              transition: 'color 0.15s, background 0.15s',
            }}
            onClick={onSettingsOpen}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </button>

          <button
            className="no-drag"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '6px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.15s',
            }}
            onClick={onToggleCollapse}
            title="Collapse Sidebar"
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 1000,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-md)',
            padding: '4px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            minWidth: 160,
          }}
          onClick={e => e.stopPropagation()}
        >
          <ContextMenuItem
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            }
            label="Rename"
            onClick={() => {
              const session = sessions.find(s => s.id === contextMenu.id);
              if (session) handleRenameStart(session);
            }}
          />
          <ContextMenuItem
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4h6v2" />
              </svg>
            }
            label="Delete"
            danger
            onClick={() => handleDeleteClick(contextMenu.id)}
          />
        </div>
      )}
    </>
  );
}

function windowBtnStyle(color: string): React.CSSProperties {
  return {
    width: 12,
    height: 12,
    borderRadius: '50%',
    background: color,
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
    flexShrink: 0,
  };
}

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function SessionItem({
  session,
  isActive,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onClick,
  onContextMenu,
}: SessionItemProps) {
  return (
    <div
      style={{
        borderRadius: 'var(--radius-sm)',
        background: isActive ? 'var(--bg-hover)' : 'transparent',
        border: isActive ? '1px solid var(--border-light)' : '1px solid transparent',
        cursor: 'pointer',
        transition: 'background 0.12s, transform 0.12s',
        padding: '8px 10px',
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={e => {
        if (!isActive) {
          e.currentTarget.style.background = 'var(--bg-card)';
          e.currentTarget.style.transform = 'translateX(2px)';
        }
      }}
      onMouseLeave={e => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.transform = 'translateX(0)';
        }
      }}
    >
      {isRenaming ? (
        <input
          autoFocus
          value={renameValue}
          onChange={e => onRenameChange(e.target.value)}
          onBlur={onRenameSubmit}
          onKeyDown={e => {
            if (e.key === 'Enter') onRenameSubmit();
            if (e.key === 'Escape') onRenameChange('');
          }}
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--accent-1)',
            borderRadius: 4,
            padding: '2px 6px',
            color: 'var(--text-primary)',
            fontSize: 13,
            width: '100%',
            outline: 'none',
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <>
          <div
            style={{
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: '1.4',
            }}
          >
            {session.name}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
            {formatRelativeTime(session.updatedAt)}
          </div>
        </>
      )}
    </div>
  );
}

interface ContextMenuItemProps {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

function ContextMenuItem({ icon, label, danger, onClick }: ContextMenuItemProps) {
  return (
    <button
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '7px 10px',
        background: 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        color: danger ? 'var(--error)' : 'var(--text-primary)',
        fontSize: 13,
        textAlign: 'left',
        transition: 'background 0.12s',
      }}
      onClick={onClick}
      onMouseEnter={e => {
        e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.1)' : 'var(--bg-hover)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {icon}
      {label}
    </button>
  );
}
