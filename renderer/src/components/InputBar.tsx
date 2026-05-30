import React, { useRef, useEffect, useCallback, useState } from 'react';

interface InputBarProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export default function InputBar({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder = 'Message Codiente...',
}: InputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxHeight = 6 * 24 + 24; // 6 lines + padding
    ta.style.height = Math.min(ta.scrollHeight, maxHeight) + 'px';
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!streaming && value.trim()) {
        onSend();
      }
    }
  };

  const canSend = !streaming && value.trim().length > 0 && !disabled;

  return (
    <div
      style={{
        padding: '12px 16px 16px',
        background: 'var(--bg-primary)',
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 10,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          padding: '8px 12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          transition: 'border-color 0.15s',
        }}
        onFocusCapture={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-light)';
        }}
        onBlurCapture={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled && !streaming}
          rows={1}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            color: 'var(--text-primary)',
            fontSize: 14,
            lineHeight: '1.6',
            maxHeight: 6 * 24 + 24,
            overflowY: 'auto',
            padding: '4px 0',
            fontFamily: 'inherit',
          }}
        />

        {streaming ? (
          <button
            onClick={onStop}
            title="Stop generating"
            className="animate-pulse-ring"
            style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid var(--error)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--error)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            onClick={canSend ? onSend : undefined}
            disabled={!canSend}
            title="Send message (Enter)"
            className="gradient-btn"
            style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        )}
      </div>

      <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
