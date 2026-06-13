import { executeToolCall } from './tools';
import { emptyResults, mergeResults } from '../lib/results';
import type { SearchParams, SearchResults, SearchSource } from '../types/travel';

export { toolDefinitions, executeToolCall } from './tools';
export { agentSystemPrompt } from './synthesizer';

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Translate a direct SearchParams + source into the matching tool name + input. */
function toToolCall(
  source: SearchSource,
  p: SearchParams,
): { name: string; input: unknown } {
  const checkOut = p.returnDate ?? addDays(p.departDate, 1);
  const guests = p.adults + (p.children ?? 0);

  switch (source) {
    case 'flights':
      return {
        name: 'search_flights',
        input: {
          origin: p.origin,
          destination: p.destination,
          departDate: p.departDate,
          returnDate: p.returnDate,
          adults: p.adults,
          cabin: p.cabin,
        },
      };
    case 'hotels':
      return {
        name: 'search_hotels',
        input: {
          destination: p.destination,
          checkIn: p.departDate,
          checkOut,
          adults: p.adults,
          maxPricePerNight: p.maxPricePerNight,
          minStars: p.minStars,
        },
      };
    case 'airbnb':
      return {
        name: 'search_airbnb',
        input: {
          location: p.destination,
          checkIn: p.departDate,
          checkOut,
          guests,
          maxPricePerNight: p.maxPricePerNight,
        },
      };
    case 'vrbo':
      return {
        name: 'search_vrbo',
        input: {
          location: p.destination,
          checkIn: p.departDate,
          checkOut,
          guests,
          maxPricePerNight: p.maxPricePerNight,
        },
      };
    case 'cars':
      return {
        name: 'search_rental_cars',
        input: {
          pickupLocation: p.origin ?? p.destination,
          pickupDate: p.departDate,
          dropoffDate: checkOut,
          carCategory: p.carCategory,
        },
      };
    case 'activities':
      return {
        name: 'search_activities',
        input: {
          destination: p.destination,
          date: p.departDate,
          category: p.activityCategory,
          adults: p.adults,
        },
      };
    case 'events':
      return {
        name: 'search_event_tickets',
        input: {
          query: p.eventQuery ?? p.destination,
          city: p.destination,
          dateFrom: p.departDate,
          dateTo: p.returnDate,
          quantity: p.ticketQuantity ?? p.adults,
          maxPrice: p.maxTicketPrice,
        },
      };
  }
}

/**
 * Fan out a direct (non-AI) search to the requested sources in parallel and
 * merge the results. One failing source never blocks the others.
 */
export async function runDirectSearch(params: SearchParams): Promise<SearchResults> {
  const start = Date.now();
  const acc = emptyResults();

  const settled = await Promise.allSettled(
    params.sources.map((source) => {
      const { name, input } = toToolCall(source, params);
      return executeToolCall(name, input);
    }),
  );

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      mergeResults(acc, result.value);
    } else {
      mergeResults(acc, { errors: { unknown: String(result.reason) } });
    }
  }

  acc.searchedAt = new Date().toISOString();
  acc.durationMs = Date.now() - start;
  return acc;
}
