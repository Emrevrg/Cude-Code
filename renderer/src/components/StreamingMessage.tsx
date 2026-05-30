import React, { useMemo } from 'react';
import CodeBlock from './CodeBlock';

interface StreamingMessageProps {
  content: string;
}

// Reuse same segment parser
interface TextSegment { type: 'text'; content: string }
interface CodeSegment { type: 'code'; content: string; language?: string }
type Segment = TextSegment | CodeSegment;

function parseStreamingContent(content: string): Segment[] {
  const segments: Segment[] = [];
  // Only parse completed code blocks; the last one may be incomplete
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'code',
      language: match[1] || undefined,
      content: match[2].trimEnd(),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) });
  }

  return segments;
}

export default function StreamingMessage({ content }: StreamingMessageProps) {
  const segments = useMemo(() => parseStreamingContent(content), [content]);

  return (
    <div className="flex justify-start mb-4">
      <div
        style={{
          maxWidth: '82%',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '18px 18px 18px 4px',
          padding: '12px 16px',
          color: 'var(--text-primary)',
          fontSize: 14,
          lineHeight: '1.7',
          wordBreak: 'break-word',
        }}
      >
        <div className="prose-codiente">
          {segments.map((seg, i) => {
            if (seg.type === 'code') {
              return <CodeBlock key={i} code={seg.content} language={seg.language} />;
            }
            return (
              <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
                {seg.content}
              </span>
            );
          })}
          <span
            className="animate-blink"
            style={{
              display: 'inline-block',
              width: 2,
              height: '1em',
              background: 'var(--accent-1)',
              marginLeft: 2,
              verticalAlign: 'text-bottom',
              borderRadius: 1,
            }}
          />
        </div>
      </div>
    </div>
  );
}
