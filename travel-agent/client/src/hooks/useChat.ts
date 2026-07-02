import { useCallback, useRef, useState } from 'react';
import type { ChatMessage, SearchResults } from '../types/travel';

// ── Event types from server (mirror the SSE protocol in routes/chat.ts) ──────

type SSEEvent =
  | { type: 'token'; content: string }
  | { type: 'searching'; tools: { name: string; input: unknown }[] }
  | { type: 'partial_results'; data: SearchResults }
  | { type: 'results'; data: SearchResults }
  | { type: 'error'; message: string }
  | { type: 'done'; durationMs: number };

interface ChatState {
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  isSearching: boolean;
  activeSearches: string[];
  currentResults: SearchResults | null;
  error: string | null;
}

const initialState: ChatState = {
  messages: [],
  streamingContent: '',
  isStreaming: false,
  isSearching: false,
  activeSearches: [],
  currentResults: null,
  error: null,
};

export function useChat() {
  const [state, setState] = useState<ChatState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (userText: string, useSubscription = false) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: userText,
        timestamp: new Date().toISOString(),
      };

      // Snapshot prior history before the optimistic append (server re-adds newMessage).
      let priorMessages: ChatMessage[] = [];
      setState((prev) => {
        priorMessages = prev.messages;
        return {
          ...prev,
          messages: [...prev.messages, userMessage],
          streamingContent: '',
          isStreaming: true,
          isSearching: false,
          activeSearches: [],
          currentResults: null,
          error: null,
        };
      });

      try {
        // Subscription mode routes through the Claude Agent SDK (billed to a
        // Claude Pro/Max plan); default mode uses the API-key endpoint.
        const endpoint = useSubscription ? '/api/chat/subscription' : '/api/chat';
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortRef.current.signal,
          body: JSON.stringify({
            messages: priorMessages.map((m) => ({ role: m.role, content: m.content })),
            newMessage: userText,
          }),
        });

        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        if (!response.body) throw new Error('No response body');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResults: SearchResults | null = null;
        let accumulatedText = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const event = parseSSEMessage(part);
            if (!event) continue;

            switch (event.type) {
              case 'token':
                accumulatedText += event.content;
                setState((prev) => ({ ...prev, streamingContent: accumulatedText }));
                break;
              case 'searching':
                setState((prev) => ({
                  ...prev,
                  isSearching: true,
                  activeSearches: event.tools.map((t) => t.name),
                }));
                break;
              case 'partial_results':
                setState((prev) => ({ ...prev, currentResults: event.data }));
                break;
              case 'results':
                finalResults = event.data;
                setState((prev) => ({
                  ...prev,
                  isSearching: false,
                  activeSearches: [],
                  currentResults: event.data,
                }));
                break;
              case 'error':
                setState((prev) => ({
                  ...prev,
                  isStreaming: false,
                  isSearching: false,
                  error: event.message,
                }));
                return;
              case 'done': {
                const assistantMessage: ChatMessage = {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: accumulatedText,
                  results: hasAnyResults(finalResults) ? finalResults! : undefined,
                  timestamp: new Date().toISOString(),
                };
                setState((prev) => ({
                  ...prev,
                  messages: [...prev.messages, assistantMessage],
                  streamingContent: '',
                  isStreaming: false,
                  isSearching: false,
                  activeSearches: [],
                }));
                break;
              }
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          isSearching: false,
          error: err instanceof Error ? err.message : 'Something went wrong',
        }));
      }
    },
    [],
  );

  const clearError = useCallback(() => setState((prev) => ({ ...prev, error: null })), []);
  const resetChat = useCallback(() => {
    abortRef.current?.abort();
    setState(initialState);
  }, []);

  return { ...state, sendMessage, clearError, resetChat };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hasAnyResults(r: SearchResults | null): boolean {
  if (!r) return false;
  return Boolean(
    r.flights?.length ||
      r.hotels?.length ||
      r.listings?.length ||
      r.cars?.length ||
      r.activities?.length ||
      (r.errors && Object.keys(r.errors).length),
  );
}

function parseSSEMessage(raw: string): SSEEvent | null {
  let eventType = '';
  let dataStr = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) eventType = line.slice(7).trim();
    else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
  }
  if (!eventType || !dataStr) return null;
  try {
    return { type: eventType, ...JSON.parse(dataStr) } as SSEEvent;
  } catch {
    return null;
  }
}
