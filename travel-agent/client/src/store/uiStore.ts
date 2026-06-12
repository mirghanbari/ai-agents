import { create } from 'zustand';

export type ResultsTab = 'flights' | 'hotels' | 'listings' | 'cars' | 'activities';

interface UiState {
  // Which assistant message's results are currently expanded in the results panel.
  openResultsMessageId: string | null;
  activeTab: ResultsTab;
  itineraryOpen: boolean;

  openResults: (messageId: string, tab?: ResultsTab) => void;
  closeResults: () => void;
  setActiveTab: (tab: ResultsTab) => void;
  toggleItinerary: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  openResultsMessageId: null,
  activeTab: 'flights',
  itineraryOpen: true,

  openResults: (messageId, tab) =>
    set((state) => ({
      openResultsMessageId: messageId,
      activeTab: tab ?? state.activeTab,
    })),
  closeResults: () => set({ openResultsMessageId: null }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleItinerary: () => set((state) => ({ itineraryOpen: !state.itineraryOpen })),
}));
