import { create } from 'zustand';
import type {
  Activity,
  EventTicket,
  Flight,
  Hotel,
  ItineraryItem,
  ItineraryItemType,
  Listing,
  RentalCar,
} from '../types/travel';

const STORAGE_KEY = 'wayfarer.itinerary.v1';

type SavableData = Flight | Hotel | Listing | RentalCar | Activity | EventTicket;

function load(): ItineraryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ItineraryItem[]) : [];
  } catch {
    return [];
  }
}

function persist(items: ItineraryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota / private mode — ignore */
  }
}

interface ItineraryState {
  items: ItineraryItem[];
  add: (type: ItineraryItemType, data: SavableData) => void;
  remove: (id: string) => void;
  has: (id: string) => boolean;
  clear: () => void;
}

export const useItinerary = create<ItineraryState>((set, get) => ({
  items: load(),

  add: (type, data) =>
    set((state) => {
      if (state.items.some((it) => it.id === data.id)) return state;
      const item: ItineraryItem = {
        id: data.id,
        type,
        data,
        savedAt: new Date().toISOString(),
      };
      const items = [...state.items, item];
      persist(items);
      return { items };
    }),

  remove: (id) =>
    set((state) => {
      const items = state.items.filter((it) => it.id !== id);
      persist(items);
      return { items };
    }),

  has: (id) => get().items.some((it) => it.id === id),

  clear: () => {
    persist([]);
    set({ items: [] });
  },
}));
