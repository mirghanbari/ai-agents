import { useEffect, useState } from 'react';
import { useChat } from './hooks/useChat';
import { useHealth } from './hooks/useHealth';
import { useItinerary } from './hooks/useItinerary';
import { useUiStore } from './store/uiStore';
import ChatInterface from './components/ChatInterface';
import ItineraryPanel from './components/ItineraryPanel';
import ErrorBanner from './components/ErrorBanner';

export default function App() {
  const chat = useChat();
  const health = useHealth();
  const itineraryOpen = useUiStore((s) => s.itineraryOpen);
  const toggleItinerary = useUiStore((s) => s.toggleItinerary);
  const savedCount = useItinerary((s) => s.items.length);

  // Subscription mode routes chat through the Claude Agent SDK (billed to a
  // Claude Pro/Max plan) instead of API credits. Default it on whenever
  // subscription auth is available; the toggle still lets the user switch
  // back to the credits path.
  const [subscriptionMode, setSubscriptionMode] = useState(false);
  useEffect(() => {
    if (health) setSubscriptionMode(health.sources.subscription);
  }, [health]);

  const subscriptionAvailable = health?.sources.subscription ?? false;
  const handleSend = (text: string): void => {
    void chat.sendMessage(text, subscriptionMode);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xl">🧭</span>
          <span className="font-semibold text-ink">Wayfarer</span>
          <span className="hidden text-xs text-slate-400 sm:inline">AI Travel Agent</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={chat.resetChat}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            New trip
          </button>
          <button
            type="button"
            onClick={toggleItinerary}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Itinerary{savedCount > 0 ? ` (${savedCount})` : ''}
          </button>
        </div>
      </header>

      {chat.error && <ErrorBanner message={chat.error} onDismiss={chat.clearError} />}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          <ChatInterface
            messages={chat.messages}
            streamingContent={chat.streamingContent}
            isStreaming={chat.isStreaming}
            isSearching={chat.isSearching}
            activeSearches={chat.activeSearches}
            currentResults={chat.currentResults}
            onSend={handleSend}
            subscriptionMode={subscriptionMode}
            subscriptionAvailable={subscriptionAvailable}
            onToggleSubscription={setSubscriptionMode}
          />
        </main>

        {itineraryOpen && (
          <aside className="hidden w-[400px] shrink-0 lg:block">
            <ItineraryPanel />
          </aside>
        )}
      </div>
    </div>
  );
}
