import { useChat } from './hooks/useChat';
import { useItinerary } from './hooks/useItinerary';
import { useUiStore } from './store/uiStore';
import ChatInterface from './components/ChatInterface';
import ItineraryPanel from './components/ItineraryPanel';
import ErrorBanner from './components/ErrorBanner';

export default function App() {
  const chat = useChat();
  const itineraryOpen = useUiStore((s) => s.itineraryOpen);
  const toggleItinerary = useUiStore((s) => s.toggleItinerary);
  const savedCount = useItinerary((s) => s.items.length);

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
            onSend={chat.sendMessage}
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
