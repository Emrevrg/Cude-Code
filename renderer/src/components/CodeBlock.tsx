import React, { useRef, useState, useEffect } from 'react';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';

interface CodeBlockProps {
  code: string;
  language?: string;
}

export default function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current) {
      delete codeRef.current.dataset.highlighted;
      if (language && hljs.getLanguage(language)) {
        const result = hljs.highlight(code, { language });
        codeRef.current.innerHTML = result.value;
      } else {
        const result = hljs.highlightAuto(code);
        codeRef.current.innerHTML = result.value;
      }
    }
  }, [code, language]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const displayLang = language || 'code';

  return (
    <div
      style={{
        background: '#0a0a14',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        margin: '0.5em 0',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: 'rgba(255,255,255,0.03)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
          {displayLang}
        </span>
        <button
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'transparent',
            border: '1px solid var(--border-light)',
            borderRadius: 6,
            padding: '2px 8px',
            cursor: 'pointer',
            color: copied ? 'var(--success)' : 'var(--text-muted)',
            fontSize: 11,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            if (!copied) e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={e => {
            if (!copied) e.currentTarget.style.color = 'var(--text-muted)';
          }}
        >
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>

      {/* Code */}
      <div style={{ overflowX: 'auto' }}>
        <pre style={{ margin: 0, padding: '14px 16px' }}>
          <code
            ref={codeRef}
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {code}
          </code>
        </pre>
      </div>
    </div>
  );
}
