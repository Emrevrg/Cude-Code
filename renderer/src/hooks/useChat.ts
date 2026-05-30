import { useState, useCallback, useRef } from 'react';
import type { Message, Session, ChatResponse } from '../types/ipc';

interface UseChatOptions {
  session: Session;
  onSessionUpdate: (session: Session) => void;
}

export function useChat({ session, onSessionUpdate }: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>(session.messages);
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const streamChannelRef = useRef<string | null>(null);

  // Keep messages in sync when session changes
  const syncMessages = useCallback((newSession: Session) => {
    setMessages(newSession.messages);
  }, []);

  const sendMessage = useCallback(async (
    userContent: string,
    provider: string,
    model: string,
    systemPrompt?: string
  ) => {
    if (streaming || !userContent.trim()) return;

    const userMessage: Message = { role: 'user', content: userContent.trim() };
    const nextMessages: Message[] = [...messages, userMessage];

    setMessages(nextMessages);
    setStreaming(true);
    setStreamingContent('');
    setError(null);

    let accumulated = '';

    return new Promise<ChatResponse | null>((resolve) => {
      const channelId = window.codiente.chat.stream(
        session.id,
        nextMessages,
        { provider, model, systemPrompt },
        (chunk) => {
          if (!chunk.done) {
            accumulated += chunk.text;
            setStreamingContent(accumulated);
          }
        },
        (response) => {
          // Done
          const assistantMessage: Message = { role: 'assistant', content: response.content };
          const finalMessages = [...nextMessages, assistantMessage];
          setMessages(finalMessages);
          setStreamingContent('');
          setStreaming(false);
          streamChannelRef.current = null;

          // Update session object
          const updatedSession: Session = {
            ...session,
            messages: finalMessages,
            totalCost: session.totalCost + response.cost,
            totalInputTokens: session.totalInputTokens + response.inputTokens,
            totalOutputTokens: session.totalOutputTokens + response.outputTokens,
            updatedAt: new Date().toISOString(),
            provider,
            model,
          };
          onSessionUpdate(updatedSession);
          resolve(response);
        },
        (err) => {
          setError(err.message);
          setStreaming(false);
          setStreamingContent('');
          streamChannelRef.current = null;
          // Remove the user message on error? No — keep it so user can retry
          resolve(null);
        }
      );
      streamChannelRef.current = channelId;
    });
  }, [messages, session, streaming, onSessionUpdate]);

  const stopStreaming = useCallback(async () => {
    await window.codiente.chat.stop();
    setStreaming(false);
    if (streamingContent) {
      const assistantMessage: Message = { role: 'assistant', content: streamingContent + ' [stopped]' };
      setMessages(prev => [...prev, assistantMessage]);
    }
    setStreamingContent('');
    streamChannelRef.current = null;
  }, [streamingContent]);

  const clearError = useCallback(() => setError(null), []);

  return {
    messages,
    streaming,
    streamingContent,
    error,
    sendMessage,
    stopStreaming,
    clearError,
    syncMessages,
  };
}
