import type { SearchResults } from '../types/travel';

export function emptyResults(): SearchResults {
  return { searchedAt: new Date().toISOString(), durationMs: 0 };
}

/** Merge a partial result (from one source) into an accumulator, concatenating arrays. */
export function mergeResults(acc: SearchResults, incoming: Partial<SearchResults>): void {
  if (incoming.flights) acc.flights = [...(acc.flights ?? []), ...incoming.flights];
  if (incoming.hotels) acc.hotels = [...(acc.hotels ?? []), ...incoming.hotels];
  if (incoming.listings) acc.listings = [...(acc.listings ?? []), ...incoming.listings];
  if (incoming.cars) acc.cars = [...(acc.cars ?? []), ...incoming.cars];
  if (incoming.activities) acc.activities = [...(acc.activities ?? []), ...incoming.activities];
  if (incoming.events) acc.events = [...(acc.events ?? []), ...incoming.events];
  if (incoming.errors) acc.errors = { ...(acc.errors ?? {}), ...incoming.errors };
}
