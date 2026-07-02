import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import SuggestedPrompts from './SuggestedPrompts';
import SearchingIndicator from './SearchingIndicator';
import ResultsTabs from './ResultsTabs';
import type { ChatMessage, SearchResults } from '../types/travel';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  isSearching: boolean;
  activeSearches: string[];
  currentResults: SearchResults | null;
  onSend: (text: string) => void;
  subscriptionMode: boolean;
  subscriptionAvailable: boolean;
  onToggleSubscription: (on: boolean) => void;
}

export default function ChatInterface({
  messages,
  streamingContent,
  isStreaming,
  isSearching,
  activeSearches,
  currentResults,
  onSend,
  subscriptionMode,
  subscriptionAvailable,
  onToggleSubscription,
}: ChatInterfaceProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, isSearching]);

  const showLiveResults = isStreaming && currentResults && !streamingContent;

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !isStreaming ? (
          <SuggestedPrompts onPick={onSend} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}

            {isSearching && <SearchingIndicator activeSearches={activeSearches} />}

            {showLiveResults && (
              <div className="max-w-[88%]">
                <ResultsTabs results={currentResults} />
              </div>
            )}

            {streamingContent && (
              <div className="flex justify-start">
                <div className="max-w-[88%] animate-fade-in rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-sm text-ink shadow-sm">
                  <div className="markdown leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <ChatInput
        onSend={onSend}
        disabled={isStreaming}
        subscriptionMode={subscriptionMode}
        subscriptionAvailable={subscriptionAvailable}
        onToggleSubscription={onToggleSubscription}
      />
    </div>
  );
}
