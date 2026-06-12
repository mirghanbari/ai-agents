import { useMemo, useState } from 'react';
import { useUiStore, type ResultsTab } from '../store/uiStore';
import FlightCard from './cards/FlightCard';
import HotelCard from './cards/HotelCard';
import ListingCard from './cards/ListingCard';
import CarCard from './cards/CarCard';
import ActivityCard from './cards/ActivityCard';
import type { SearchResults } from '../types/travel';

type SortKey = 'price-asc' | 'price-desc' | 'rating-desc';

const TAB_META: { key: ResultsTab; label: string }[] = [
  { key: 'flights', label: '✈️ Flights' },
  { key: 'hotels', label: '🏨 Hotels' },
  { key: 'listings', label: '🏠 Stays' },
  { key: 'cars', label: '🚗 Cars' },
  { key: 'activities', label: '🎯 Activities' },
];

function priceOf(tab: ResultsTab, item: unknown): number {
  const o = item as Record<string, number>;
  if (tab === 'flights' || tab === 'activities') return o.price ?? 0;
  if (tab === 'cars') return o.pricePerDay ?? 0;
  return o.pricePerNight ?? 0;
}

function ratingOf(item: unknown): number {
  return (item as { rating?: number }).rating ?? 0;
}

export default function ResultsTabs({ results }: { results: SearchResults }) {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const [sort, setSort] = useState<SortKey>('price-asc');

  const present = TAB_META.filter(({ key }) => (results[key]?.length ?? 0) > 0);
  const tab = present.some((t) => t.key === activeTab) ? activeTab : present[0]?.key;
  const items = tab ? results[tab] ?? [] : [];

  const sorted = useMemo(() => {
    if (!tab) return [];
    const copy = [...items];
    copy.sort((a, b) => {
      if (sort === 'rating-desc') return ratingOf(b) - ratingOf(a);
      const pa = priceOf(tab, a);
      const pb = priceOf(tab, b);
      return sort === 'price-desc' ? pb - pa : pa - pb;
    });
    return copy;
  }, [items, tab, sort]);

  const errors = results.errors ? Object.entries(results.errors) : [];

  if (present.length === 0 && errors.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2">
      {errors.length > 0 && (
        <ul className="mb-2 space-y-1">
          {errors.map(([source, msg]) => (
            <li key={source} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
              ⚠️ <span className="font-medium capitalize">{source}</span>: {msg}
            </li>
          ))}
        </ul>
      )}

      {present.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex flex-wrap gap-1">
              {present.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={`rounded-lg px-3 py-1.5 text-sm transition ${
                    key === tab ? 'bg-white font-medium text-ink shadow-sm' : 'text-slate-500 hover:text-ink'
                  }`}
                >
                  {label} <span className="text-xs text-slate-400">{results[key]?.length}</span>
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
            >
              <option value="price-asc">Cheapest first</option>
              <option value="price-desc">Most expensive</option>
              <option value="rating-desc">Highest rated</option>
            </select>
          </div>

          <div className="mt-2 space-y-2">
            {tab &&
              sorted.map((item, i) => (
                <ResultCard key={(item as { id?: string }).id ?? i} tab={tab} item={item} />
              ))}
          </div>
        </>
      )}
    </div>
  );
}

function ResultCard({ tab, item }: { tab: ResultsTab; item: unknown }) {
  switch (tab) {
    case 'flights':
      return <FlightCard flight={item as never} />;
    case 'hotels':
      return <HotelCard hotel={item as never} />;
    case 'listings':
      return <ListingCard listing={item as never} />;
    case 'cars':
      return <CarCard car={item as never} />;
    case 'activities':
      return <ActivityCard activity={item as never} />;
  }
}
