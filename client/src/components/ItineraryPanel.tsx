import { useState } from 'react';
import { useItinerary } from '../hooks/useItinerary';
import {
  exportItineraryMarkdown,
  formatMoney,
  itemCost,
  itemTitle,
  typeLabel,
} from '../lib/format';
import type { ItineraryItem } from '../types/travel';

const ORDER: ItineraryItem['type'][] = ['flight', 'hotel', 'listing', 'car', 'activity'];

export default function ItineraryPanel() {
  const items = useItinerary((s) => s.items);
  const remove = useItinerary((s) => s.remove);
  const clear = useItinerary((s) => s.clear);
  const [copied, setCopied] = useState(false);

  const total = items.reduce((sum, it) => sum + itemCost(it).amount, 0);
  const currency = items[0] ? itemCost(items[0]).currency : 'USD';

  const onExport = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(exportItineraryMarkdown(items));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-full flex-col border-l border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold text-ink">Your itinerary</h2>
        <span className="text-sm text-slate-400">{items.length} saved</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {items.length === 0 ? (
          <p className="mt-8 text-center text-sm text-slate-400">
            Save flights, stays, cars, and activities with the ♡ button to build your trip.
          </p>
        ) : (
          ORDER.map((type) => {
            const group = items.filter((it) => it.type === type);
            if (group.length === 0) return null;
            return (
              <section key={type} className="mb-4">
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  {typeLabel(type)}
                </h3>
                <ul className="space-y-1.5">
                  {group.map((it) => {
                    const { amount, currency: c } = itemCost(it);
                    return (
                      <li
                        key={it.id}
                        className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{itemTitle(it)}</span>
                        <span className="shrink-0 text-sm font-medium text-ink">
                          {formatMoney(amount, c)}
                        </span>
                        <button
                          type="button"
                          onClick={() => remove(it.id)}
                          aria-label="Remove"
                          className="shrink-0 text-slate-300 hover:text-rose-500"
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </div>

      <footer className="border-t border-slate-200 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-500">Estimated total</span>
          <span className="text-lg font-semibold text-ink">{formatMoney(total, currency)}</span>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onExport}
            disabled={items.length === 0}
            className="flex-1 rounded-lg bg-wayfarer-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-wayfarer-700 disabled:opacity-40"
          >
            {copied ? 'Copied!' : 'Export'}
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={items.length === 0}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:text-rose-500 disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </footer>
    </div>
  );
}
