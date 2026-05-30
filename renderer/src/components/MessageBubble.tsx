import React, { useMemo } from 'react';
import type { Message } from '../types/ipc';
import CodeBlock from './CodeBlock';

interface MessageBubbleProps {
  message: Message;
}

// Parse markdown-like content into segments
interface TextSegment { type: 'text'; content: string }
interface CodeSegment { type: 'code'; content: string; language?: string }
type Segment = TextSegment | CodeSegment;

function parseContent(content: string): Segment[] {
  const segments: Segment[] = [];
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

// Minimal inline markdown renderer
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  // Process bold, italic, inline code
  const inlineRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = inlineRegex.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push(text.slice(lastIdx, m.index));
    }
    const matched = m[0];
    if (matched.startsWith('`')) {
      parts.push(
        <code key={key++} style={{
          background: 'rgba(124, 58, 237, 0.12)',
          color: '#a78bfa',
          padding: '0.1em 0.35em',
          borderRadius: 4,
          fontSize: '0.88em',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {matched.slice(1, -1)}
        </code>
      );
    } else if (matched.startsWith('**')) {
      parts.push(<strong key={key++}>{matched.slice(2, -2)}</strong>);
    } else if (matched.startsWith('*')) {
      parts.push(<em key={key++}>{matched.slice(1, -1)}</em>);
    }
    lastIdx = m.index + matched.length;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return parts.length ? parts : [text];
}

function renderTextContent(text: string): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines (but preserve spacing)
    if (!line.trim()) {
      elements.push(<br key={key++} />);
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizes: Record<number, string> = { 1: '1.3em', 2: '1.15em', 3: '1.05em', 4: '1em' };
      elements.push(
        <p key={key++} style={{ fontWeight: 600, fontSize: sizes[level] || '1em', marginBottom: '0.4em', marginTop: '0.6em', color: 'var(--text-primary)' }}>
          {renderInlineMarkdown(headingMatch[2])}
        </p>
      );
      i++;
      continue;
    }

    // Bullet list item
    if (/^[-*+]\s/.test(line) || /^\d+\.\s/.test(line)) {
      const listItems: string[] = [];
      const isOrdered = /^\d+\.\s/.test(line);

      while (i < lines.length && ((!isOrdered && /^[-*+]\s/.test(lines[i])) || (isOrdered && /^\d+\.\s/.test(lines[i])))) {
        const listLine = lines[i];
        const content = isOrdered ? listLine.replace(/^\d+\.\s/, '') : listLine.replace(/^[-*+]\s/, '');
        listItems.push(content);
        i++;
      }

      const ListTag = isOrdered ? 'ol' : 'ul';
      elements.push(
        <ListTag key={key++} style={{ margin: '0.4em 0', paddingLeft: '1.5em' }}>
          {listItems.map((item, idx) => (
            <li key={idx} style={{ marginBottom: '0.15em' }}>
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      elements.push(
        <blockquote key={key++} style={{
          borderLeft: '3px solid var(--accent-1)',
          paddingLeft: '0.75em',
          margin: '0.4em 0',
          color: 'var(--text-secondary)',
        }}>
          {renderInlineMarkdown(line.slice(1).trim())}
        </blockquote>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      elements.push(<hr key={key++} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.75em 0' }} />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={key++} style={{ marginBottom: '0.4em' }}>
        {renderInlineMarkdown(line)}
      </p>
    );
    i++;
  }

  return <>{elements}</>;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const segments = useMemo(() => parseContent(message.content), [message.content]);

  if (isUser) {
    return (
      <div className="animate-slide-up flex justify-end mb-4">
        <div
          style={{
            maxWidth: '72%',
            background: 'var(--accent-gradient)',
            borderRadius: '18px 18px 4px 18px',
            padding: '10px 16px',
            color: 'white',
            fontSize: 14,
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-slide-up flex justify-start mb-4">
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
          {segments.map((seg, i) =>
            seg.type === 'code' ? (
              <CodeBlock key={i} code={seg.content} language={seg.language} />
            ) : (
              <React.Fragment key={i}>
                {renderTextContent(seg.content)}
              </React.Fragment>
            )
          )}
        </div>
      </div>
    </div>
  );
}
