import React from 'react';

const EXAMPLE_PROMPTS = [
  { icon: '⚡', text: 'Explain async/await in TypeScript with examples' },
  { icon: '🔧', text: 'Write a React hook for debouncing user input' },
  { icon: '🐛', text: 'Help me debug this function and explain the issue' },
  { icon: '📝', text: 'Create a REST API with Express and TypeScript' },
  { icon: '🔍', text: 'Review my code for performance improvements' },
  { icon: '💡', text: 'Design a database schema for a blog platform' },
];

interface WelcomeScreenProps {
  onNewChat?: (prompt?: string) => void;
  onSetupClick?: () => void;
}

export default function WelcomeScreen({ onNewChat, onSetupClick }: WelcomeScreenProps) {
  return (
    <div
      className="flex flex-col items-center justify-center flex-1 animate-fade-in"
      style={{
        padding: '40px 32px',
        background: 'var(--bg-primary)',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div
          className="gradient-text"
          style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, letterSpacing: '-2px', marginBottom: 16 }}
        >
          ✦ Codiente
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 16, maxWidth: 420, lineHeight: 1.6 }}>
          Your intelligent coding companion. Powered by the world's best AI models.
        </p>
      </div>

      {/* Setup notice if no provider */}
      {onSetupClick && !onNewChat && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px 28px',
            marginBottom: 32,
            textAlign: 'center',
            maxWidth: 480,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔑</div>
          <p style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: 8 }}>
            No AI provider configured
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
            Add your API keys to start chatting. Codiente supports Anthropic, OpenAI, Gemini, Groq, and more.
          </p>
          <button
            className="gradient-btn"
            onClick={onSetupClick}
            style={{ borderRadius: 'var(--radius-xl)', padding: '10px 24px', fontWeight: 500 }}
          >
            Configure API Keys
          </button>
        </div>
      )}

      {/* Example prompts */}
      {onNewChat && (
        <div style={{ width: '100%', maxWidth: 640 }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Try asking...
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 10,
            }}
          >
            {EXAMPLE_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                onClick={() => onNewChat(prompt.text)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  lineHeight: 1.5,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                  e.currentTarget.style.borderColor = 'var(--border-light)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'var(--bg-card)';
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{prompt.icon}</span>
                <span>{prompt.text}</span>
              </button>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <button
              className="gradient-btn"
              onClick={() => onNewChat()}
              style={{ borderRadius: 'var(--radius-xl)', padding: '10px 32px', fontWeight: 500, fontSize: 14 }}
            >
              Start a New Chat
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 48, color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>
        Codiente Desktop · Powered by Claude, GPT-4, Gemini & more
      </div>
    </div>
  );
}
